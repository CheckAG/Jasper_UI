#!/usr/bin/env python3
"""A TCD1304 spectrometer on a pty, for developing against protocol v1 without a board.

Speaks the firmware's side of TCD1304_Timer_ADC/PROTOCOL.md: ASCII commands in,
framed binary replies out. The command dispatch and frame encoding are ported
from Python_User_Code/tcd1304.py (_FakeDevice and build_frame); the scene
generator is new, because the reference fake only ever emits zeros.

Prints the pty path on stdout as the first line, then serves until killed:

    $ python3 tools/tcd1304-sim.py --scene lines
    /dev/pts/7

Point the app at it with JASPER_PORT, or let the integration test drive it.
A pty carries no VID/PID, so port enumeration will not find it — that is what
the JASPER_PORT override exists for.
"""

import argparse
import math
import os
import pty
import struct
import sys
import termios
import time
import tty

MAGIC = b"TC"
VERSION = 0x01
HDR_LEN = 16
CRC_LEN = 2

TYPE_SPECTRUM = 0x01
TYPE_IDN = 0x02
TYPE_ACK = 0x03
TYPE_ERR = 0x04
TYPE_METADATA = 0x05

PIXELS = 3694
SPECTRUM_BYTES = PIXELS * 2
INTEG_MS_MIN = 8
INTEG_MS_MAX = 10000
MAX_INTENSITY = 32767

IDN = b"Jasper,TCD1304,0011223344556677,0.1"
METADATA = (
    b"PIXELS=3694;ACTIVE=32:3679;DARK=16:28;INTEG_MIN_MS=8;INTEG_MAX_MS=10000;"
    b"MAX_INTENSITY=32767;PIXEL_RATE_HZ=500000;READOUT_US=7388;SENSOR=TCD1304AP;"
)

# Neon emission lines, as pixel positions on a notional 200-1000 nm dispersion.
# Only their existence matters here — the wavelength fit is the host's problem.
_LINES = [(585.2, 0.9), (614.3, 0.6), (640.2, 1.0), (650.7, 0.7),
          (692.9, 0.5), (717.4, 0.8), (743.9, 0.4)]


def crc16_ccitt(data):
    """CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final xor."""
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def build_frame(type_, payload=b"", seq=0, integ_ms=10, status=0):
    """Encode a frame exactly as the firmware does."""
    head = struct.pack("<2sBBHHIHH", MAGIC, VERSION, type_, seq,
                       len(payload), integ_ms, status, 0) + payload
    return head + struct.pack("<H", crc16_ccitt(head))


# Masked-pixel dark level. This video is inverted: an unilluminated pixel reads
# HIGH and light pulls the value down. Measured on the real board — the masked
# DARK window sits near 29300 whatever the integration time.
DARK_LEVEL = 29300
dlo, dhi = 16, 28   # the masked DARK window this sim advertises in METADATA


def spectrum(scene, integ_ms, tick):
    """Raw counts as the device sends them: signed 16-bit little-endian.

    Inverted video, so a scene builds by SUBTRACTING signal from DARK_LEVEL.
    The DARK window (pixels 16-28) is masked on the real sensor, so it is left
    at the dark level here no matter what the scene does — that is what makes
    it usable as a dark reference, and what the host checks against.
    """
    baseline = DARK_LEVEL + 12 * math.sin(tick / 3.0)
    gain = min(integ_ms / 100.0, 1.0)
    ys = [baseline] * PIXELS

    if scene in ("lines", "saturated"):
        for nm, strength in _LINES:
            centre = (nm - 200.0) / 800.0 * PIXELS
            amp = 13000 * strength * gain
            width = 3.0
            lo, hi = max(0, int(centre - 6 * width)), min(PIXELS, int(centre + 6 * width))
            for i in range(lo, hi):
                ys[i] -= amp * math.exp(-0.5 * ((i - centre) / width) ** 2)

    if scene == "saturated":
        # PROTOCOL.md: a saturated pixel rolls past 0x7FFF and reads negative.
        # Drive a band past the limit so the host's saturation path has
        # something to detect.
        centre = int((640.2 - 200.0) / 800.0 * PIXELS)
        for i in range(centre - 12, centre + 12):
            ys[i] = 40000

    out = bytearray()
    for i, v in enumerate(ys):
        # Deterministic pseudo-noise: no RNG, so a failing test reproduces.
        v += ((i * 2654435761 + int(tick * 1000)) % 97) - 48
        if dlo <= i <= dhi and scene != "saturated":
            v = baseline + (((i * 40503) % 61) - 30)   # masked: dark level only
        v = max(-32768, min(65535, int(v)))
        out += struct.pack("<H" if v > 32767 else "<h", v)
    return bytes(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", default="lines", choices=("flat", "lines", "saturated"),
                    help="what the sensor is looking at (default: lines)")
    ap.add_argument("--no-delay", action="store_true",
                    help="reply to ACQUIRE instantly instead of taking 2x the integration time")
    ap.add_argument("--mute", action="store_true",
                    help="hold the pty open but never reply, for testing the host's timeout path")
    args = ap.parse_args()

    master, slave = pty.openpty()
    # Raw on both ends. In cooked mode ONLCR rewrites every 0x0A in a binary
    # frame as CR LF — and integ_ms = 10 puts a 0x0A in the header of most
    # replies, which shifts the whole frame and desyncs the reader.
    for fd in (master, slave):
        tty.setraw(fd, termios.TCSANOW)
    print(os.ttyname(slave), flush=True)

    seq = 0
    integ_ms = 10
    pending = b""

    while True:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            break
        if not chunk:
            break

        pending += chunk
        # '\0' is accepted alongside '\n' for the pre-protocol firmware.
        pending = pending.replace(b"\0", b"\n")
        while b"\n" in pending:
            line, _, pending = pending.partition(b"\n")
            line = line.strip()
            if not line:
                continue  # an empty transfer is ignored and produces no reply

            if args.mute:
                continue
            cmd = line[:1].upper()
            if cmd in (b"?", b"*"):
                reply = build_frame(TYPE_IDN, IDN, seq, integ_ms)
            elif cmd == b"M":
                reply = build_frame(TYPE_METADATA, METADATA, seq, integ_ms)
            elif cmd == b"I":
                digits = b""
                for ch in line[1:]:
                    if not chr(ch).isdigit():
                        break  # atoi stops at the first non-digit
                    digits += bytes([ch])
                if digits:
                    integ_ms = max(INTEG_MS_MIN, min(INTEG_MS_MAX, int(digits)))
                reply = build_frame(TYPE_ACK, b"I%d" % integ_ms, seq, integ_ms)
            elif cmd == b"A":
                if not args.no_delay:
                    # The firmware discards one frame and sends the next.
                    time.sleep(2 * integ_ms / 1000.0)
                seq = (seq + 2) & 0xFFFF
                reply = build_frame(TYPE_SPECTRUM,
                                    spectrum(args.scene, integ_ms, time.monotonic()),
                                    seq, integ_ms)
            elif cmd == b"X":
                reply = build_frame(TYPE_ACK, b"X", seq, integ_ms)
            else:
                reply = build_frame(TYPE_ERR, b"unknown command", seq, integ_ms)

            try:
                os.write(master, reply)
            except OSError:
                return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
