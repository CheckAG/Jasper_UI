#!/usr/bin/env bash
#
# Create one GitHub issue per Phase E feature in feature_list.json.
#
# The MCP GitHub token in the agent session is read-only (403 on POST /issues),
# so these are created from your own gh credentials instead.
#
# Prerequisites:
#   sudo apt install gh   (or: https://cli.github.com)
#   gh auth login
#
# Usage:
#   ./tools/create-issues.sh          # create them
#   ./tools/create-issues.sh --dry    # print titles only
#
# Idempotency: re-running creates duplicates. Check `gh issue list` first.
# After creating, write the issue numbers back into feature_list.json.
#
set -euo pipefail

REPO="CheckAG/Jasper_UI"
DRY=${1:-}

new_issue() {
  local title="$1" labels="$2" body="$3"
  if [ "$DRY" = "--dry" ]; then
    echo "would create: $title  [$labels]"
    return
  fi
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body "$body"
}

# Labels must exist first; ignore failures if they already do.
if [ "$DRY" != "--dry" ]; then
  for l in "phase-e:Phase E — real TCD1304 hardware" \
           "P0:blocks everything downstream" \
           "P1:needed for the phase to ship" \
           "P2:wanted, not blocking"; do
    gh label create "${l%%:*}" --repo "$REPO" --description "${l#*:}" 2>/dev/null || true
  done
fi

new_issue "[E1] Hide Analyze and Chemometrics behind a feature flag" "phase-e,P1" \
'Phase E · `feature_list.json` id **E1** · priority **P1** · depends on: none

Narrow the product to Acquire + Instrument without deleting any code. One exported flag gates the rail, the command palette and the render branches.

## Files
- `src/lib/features.ts` (new)
- `src/components/layout/WorkspaceRail.tsx`
- `src/components/overlays/CommandPalette.tsx`
- `src/App.tsx`

## Notes
`WS_ITEMS` is duplicated in `WorkspaceRail.tsx:6` and `CommandPalette.tsx:6` — move it into `features.ts` and import it in both, killing the duplicate.

**Do NOT delete `store/analyzeStore.ts`** — `ExportDialog.tsx:4` imports it, so the Export dialog breaks if the store goes.

## Acceptance
- [ ] Rail and Cmd-K palette list only Acquire and Instrument
- [ ] Export dialog still opens and exports
- [ ] Flipping the flag restores both workspaces with no other edit'

new_issue "[E2a] TCD1304 frame codec: envelope, CRC-16/CCITT, resyncing reader" "phase-e,P0" \
'Phase E · `feature_list.json` id **E2a** · priority **P0** · depends on: none

Pure parsing/encoding layer for TCD1304 protocol v1. Content-addressed framing, no position-based reads.

## Wire format
16-byte header, all little-endian, **no STX/ETX**:

| Offset | Size | Field |
|---:|---:|---|
| 0 | 2 | magic `T`,`C` (`0x54 0x43`) |
| 2 | 1 | version `0x01` |
| 3 | 1 | type: 1 SPECTRUM · 2 IDN · 3 ACK · 4 ERR · 5 METADATA |
| 4 | 2 | seq — completed CCD frames, free-running, wraps |
| 6 | 2 | payload_len |
| 8 | 4 | integ_ms in force for this frame |
| 12 | 2 | status — bit 0 DROPPED, rest reserved |
| 14 | 2 | reserved |
| 16 | N | payload |
| 16+N | 2 | CRC-16/CCITT-FALSE over bytes `[0 .. 16+N-1]`, stored LE |

CRC: poly `0x1021`, init `0xFFFF`, no reflection, no final XOR.

## Resync algorithm
Scan for `TC`. Need 16 bytes to read the header. Reject `version != 0x01`, `type` outside `1..=5`, `payload_len > 7388`. **On any rejection, discard one byte and rescan** — a false `TC` inside spectrum data is a real occurrence, not a hypothetical. Verify the CRC before emitting.

## Files
- `src-tauri/src/instrument/tcd1304/frame.rs` (new)

Keep `crc16_ccitt` from the old `serial.rs:25` verbatim — same algorithm, already tested.

## Acceptance
- [ ] CRC check value for `"123456789"` is `0x29B1`
- [ ] A frame prefixed with garbage containing a false `TC` still parses
- [ ] A one-byte-truncated frame does not desync the reader permanently

Reference to transliterate: `TCD1304_Timer_ADC/Python_User_Code/tcd1304.py` `_parse_frame:143`.'

new_issue "[E2b] Replace serial.rs with a TCD1304 SpectrumDriver" "phase-e,P0" \
'Phase E · `feature_list.json` id **E2b** · priority **P0** · depends on: **E2a**

Delete the specbench driver and implement the same `SpectrumDriver` trait (`driver.rs:91`) against the real protocol, so nothing above it changes shape.

## Protocol
Commands are ASCII, `\n`-terminated, dispatched on the first character only, case-insensitive:
`?` / `*IDN?` → IDN · `M` → METADATA · `I<ms>` → ACK `I<applied>` · `A` → one SPECTRUM · `X` → ACK `X` · anything else → ERR `unknown command`.

**Handshake on connect:** `X\n`, 50 ms, flush input, `*IDN?\n` (require 4 comma fields, `fields[1] == "TCD1304"`), then `M\n` and cache the parsed metadata. IDN is `Jasper,TCD1304,<16 uppercase hex>,0.1` in SCPI field order — gate on the header `version` byte, never on the `0.1` firmware string.

**METADATA:** `PIXELS=3694;ACTIVE=32:3679;DARK=16:28;INTEG_MIN_MS=8;INTEG_MAX_MS=10000;MAX_INTENSITY=32767;PIXEL_RATE_HZ=500000;READOUT_US=7388;SENSOR=TCD1304AP;` — unknown keys **must be ignored**, new ones arrive without a version bump.

**scan():** push `I<ms>` only when the value changed, then `A\n`, then read one SPECTRUM. Timeout `3 * integ_ms + 500 ms` for `A`, 1 s for everything else; clear the whole RX buffer on timeout. A capture costs about 2x integration because the firmware discards one frame and sends the next.

**Samples:** signed `i16` LE, 3694 of them (7388 bytes, frame total 7406). Signed is deliberate — a saturated pixel rolls negative rather than wrapping to a plausible value. Invert for display as `max_intensity - raw`; CCD video reads high in the dark. Saturation comes from metadata `MAX_INTENSITY`, never a hardcoded constant.

**status bit 0 (DROPPED):** surface it, do not discard the frame — it is valid, just one integration period late. Mask bit 0 specifically; bits 4-6 are earmarked for a future device state machine.

An `ERR` frame becomes an `Err` regardless of what frame type was awaited, so an unknown command can never be silently mistaken for data.

## Files
- `src-tauri/src/instrument/tcd1304/mod.rs` (new)
- `src-tauri/src/instrument/serial.rs` (delete)
- `src-tauri/src/instrument/mod.rs`

## Acceptance
- [ ] `cargo test` passes against the simulator from E6
- [ ] Unknown METADATA keys do not break the parse
- [ ] A saturated pixel is reported as saturated, not as a large positive value'

new_issue "[E3] Probe-based device discovery and runtime connect/disconnect" "phase-e,P1" \
'Phase E · `feature_list.json` id **E3** · priority **P1** · depends on: **E2b**

Find the spectrometer by asking it who it is, and make the UI Connect button actually open the port.

## Why not VID/PID
`serialport` is built with `default-features = false` (`Cargo.toml:29`) and `libudev-dev` is not installed, so `available_ports()` cannot report VID/PID at all. The device also ships the stock Renesas `045B:5310` pair shared by other RA demo firmware, with a USB serial string descriptor hardcoded to the same value on every board — so VID/PID would not identify it even if we could read it. Probing with `*IDN?` and matching the model field is what the reference host does.

## Approach
Enumerate `available_ports()`, keep names matching `ttyACM* | ttyUSB* | cu.usbmodem* | COM*`, probe each with the E2b handshake, return a `DeviceInfo` for every device answering `TCD1304`.

`JASPER_PORT` stays as a manual override and is the only way to reach the pty simulator, since a pty does not appear in `available_ports()`.

`AppState.driver` is already `Arc<Mutex<Box<dyn SpectrumDriver + Send>>>` (`state.rs:8`), so connect can swap its contents at runtime.

## Files
- `src-tauri/src/instrument/tcd1304/mod.rs`
- `src-tauri/src/state.rs`
- `src-tauri/src/commands/instrument.rs`
- `src/workspaces/instrument/InstrumentWorkspace.tsx`

`ipc.connectDevice` (`ipc.ts:127`) is dead code today — `InstrumentWorkspace.tsx:193` only calls `setActiveDevice` locally.

## Acceptance
- [ ] `device_list()` returns exactly one TCD1304 with the simulator running
- [ ] Connect/Disconnect in the UI opens and closes the port for real
- [ ] A non-spectrometer serial device on the machine is not disturbed beyond one probe'

new_issue "[E4] Make acquisition params honest about what the device accepts" "phase-e,P1" \
'Phase E · `feature_list.json` id **E4** · priority **P1** · depends on: **E2b**

The UI exposes controls the hardware has no command for, and the acquisition loop runs faster than a capture can complete.

## Four changes

**Integration range.** Slider is 5-500 step 5 (`ActionShelf.tsx:40`); the device clamps to 8-10000 ms and reports the applied value in the ACK. Clamp to the metadata range and echo the ACK value back into the store so the slider shows what the device is really doing.

**Averaging** has no device support. Keep it host-side — `process::average_scans` (`process.rs:27`) already does exactly this and is already called by the calibration commands.

**Lamp controls.** `light_on` / `light_power` cross the IPC boundary in `AcqParams` but no driver reads them, and this hardware has no lamp command. Hide both controls (`ActionShelf.tsx:67-71`) behind the E1 feature flag; leave the fields in `AcqParams`.

**Acquisition loop interval.** `commands/instrument.rs:112` sets the floor to `max(integration, 16)`. A capture costs about 2x integration because the firmware discards one frame, so the floor must be `2 * integ_ms` — otherwise every iteration blocks and starves the driver mutex.

## Files
- `src/workspaces/acquire/ActionShelf.tsx`
- `src/store/acqStore.ts`
- `src-tauri/src/commands/instrument.rs`

## Acceptance
- [ ] Setting integration to 3 ms yields an ACK of 8 and the slider snaps to 8
- [ ] The acquisition loop does not starve other commands of the driver mutex
- [ ] No lamp controls are visible'

new_issue "[E5] Host-side wavelength calibration keyed on the IDN serial" "phase-e,P2" \
'Phase E · `feature_list.json` id **E5** · priority **P2** · depends on: **E2b**

The device stores no calibration, and the firmware roadmap keeps it that way — a reserved `E` command would only ever store an opaque blob. JASPER owns pixel-to-nm.

## Approach
Default `xs[i] = i` with `x_unit: "px"` until a calibration exists. `px` is already a supported unit (`types.ts:11`). Honest beats faking nm.

New `instrument_cal` table in `src-tauri/src/storage/schema.sql`: serial, coefficients JSON, fitted_at, note. **Key on the IDN serial number** (the MCU unique ID) — the only unique identifier the device has; the USB serial string descriptor is a constant on every board. This is forward-compatible with the reserved `E` command.

`calibrate_xcal` becomes a real least-squares fit of a low-order polynomial to known line positions (a neon lamp is the intended source). `XCalResult` (`driver.rs:81`) already carries `coefficients`, `rms` and `peaks_found`, and `ipc.ts:170` already delivers them to the UI, where they are currently discarded.

Ship manual coefficient entry first. Automatic neon peak-finding is a follow-on.

## Files
- `src-tauri/src/storage/schema.sql`
- `src-tauri/src/commands/instrument.rs`
- `src/workspaces/instrument/InstrumentWorkspace.tsx`

## Acceptance
- [ ] Save coefficients, restart the app, reconnect the same serial — the x-axis returns in nm
- [ ] A different instrument serial does not pick up another unit calibration
- [ ] With no calibration, the axis reads pixel index and says so'

new_issue "[E6] pty simulator for the TCD1304 protocol, and rewrite the integration test" "phase-e,P0" \
'Phase E · `feature_list.json` id **E6** · priority **P0** · depends on: **E2a**

There is no simulator for this protocol in either repo, and the existing test passes silently when its simulator is missing.

## What exists
The hardware repo has only an in-process `_FakeDevice` (`tcd1304.py:366`) — a pyserial stand-in that Rust cannot reach. `src-tauri/tests/serial_sim.rs` drives `claude_hw_design/tools/protocol-sim/sim.py`, which belongs to the **old** protocol, and skips silently if it is absent (`serial_sim.rs:36`).

## What to build
`tools/tcd1304-sim.py`: `pty.openpty()`, print the slave path on stdout as the first line, then port the `_FakeDevice` command dispatch and `build_frame()` (`tcd1304.py:135`) verbatim. About 40 lines.

Then rewrite `serial_sim.rs` against it. **A missing simulator must fail the test, not pass it.**

## Files
- `tools/tcd1304-sim.py` (new)
- `src-tauri/tests/serial_sim.rs`

## Acceptance
- [ ] `python3 tools/tcd1304-sim.py` prints a pty path
- [ ] `cargo test` passes against it end to end
- [ ] Deleting the simulator makes the test fail rather than pass'

new_issue "[E7a] Instrument panel: report real device metadata instead of fake telemetry" "phase-e,P1" \
'Phase E · `feature_list.json` id **E7a** · priority **P1** · depends on: **E2b**

The four telemetry tiles render fabricated zeros as if they were readings. This hardware has no telemetry at all — the serial `telemetry()` returns all zeros and `TelemetryPanel` (`InstrumentWorkspace.tsx:90`) prints them.

## Approach
Replace the tiles with what the device does report: firmware version, protocol version, serial, pixel count, integration range, last `seq`, dropped-frame count, last capture round-trip in ms.

Add a `DeviceMetadata` type rather than widening `TelemetryData` (`driver.rs:54`) — none of `tempC` / `lampHours` / `driftSigma` / `headroom` applies to this hardware.

Rust types in `driver.rs` are mirrored by hand in `src/lib/types.ts` and `src/lib/dto.ts`. Change all of them.

## Files
- `src-tauri/src/instrument/driver.rs`
- `src/workspaces/instrument/InstrumentWorkspace.tsx`
- `src/lib/types.ts`
- `src/lib/dto.ts`

## Acceptance
- [ ] The panel shows the simulator IDN serial and firmware `0.1`
- [ ] No tile displays a number the device did not send'

new_issue "[E7b] Real diagnostics log" "phase-e,P2" \
'Phase E · `feature_list.json` id **E7b** · priority **P2** · depends on: **E2b**

`ipc.getDiagnostics` returns a hardcoded four-entry array (`ipc.ts:104`), rendered by `DiagnosticsLog` at `InstrumentWorkspace.tsx:140`. The log is decoration.

Feed it real events: connect, handshake result, ERR frames, CRC resyncs, dropped frames, timeouts.

## Files
- `src/lib/ipc.ts`
- `src-tauri/src/commands/instrument.rs`
- `src/workspaces/instrument/InstrumentWorkspace.tsx`

## Acceptance
- [ ] Unplugging the device mid-capture puts a real entry in the log
- [ ] A CRC resync is visible in the log'

new_issue "[E7c] Surface calibration warnings and wire up the Acquire dark/reference chips" "phase-e,P2" \
'Phase E · `feature_list.json` id **E7c** · priority **P2** · depends on: **E2b**

Two places where the UI says something happened and nothing did.

**Calibration warnings are swallowed.** `CalibrationPanel` drops the `warn` string into `console.warn` (`InstrumentWorkspace.tsx:25`). The backend already computes useful warnings — "is the light off?", "near saturation", "signal low" (`commands/instrument.rs:193-239`). Toast them.

**Acquire dark/reference chips are cosmetic.** `ModeStrip.tsx:45` toggles `refState` directly without calling any calibration IPC, so the chips claim a calibration the backend never ran. Either wire them to `ipc.calibrateDark` / `ipc.calibrateReference`, or make them read-only indicators of `refState`.

## Files
- `src/workspaces/instrument/InstrumentWorkspace.tsx`
- `src/workspaces/acquire/ModeStrip.tsx`

## Acceptance
- [ ] Calibrating with the light on raises a visible toast, not a console line
- [ ] The dark/reference chips reflect real calibration state'

echo
echo "Done. Now write the issue numbers back into feature_list.json (the 'issue' field)."
