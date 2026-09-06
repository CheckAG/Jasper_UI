# Session handoff

Written 2026-09-06. Update this with `/handoff` at the end of every working session.
It is what the next agent inherits — `PLAN.md` says what is planned, this says what happened.

## Now

Phase E has not started. The first thing to build is **E2a — the TCD1304 frame codec**
(`src-tauri/src/instrument/tcd1304/frame.rs`), because E2b, E3, E4, E5 and E7 all sit on top of it.
E6 (the pty simulator) only needs E2a, so those two can go in parallel and E6 is what makes E2b
testable without hardware.

Branch off `origin/master` with `/new-branch` once the issue numbers exist.

## State

**Works and shipped** — phases 0 through D, archived in `docs/PLAN-archive-phases-A-D.md`:
four workspaces, SQLite persistence, the Rust acquisition thread emitting `spectrum-frame`,
the Python sidecar (pre-processing + chemometrics + JCAMP), export, plugin discovery.

**Built against the wrong device** — `src-tauri/src/instrument/serial.rs` speaks specbench
PROTOCOL.md v1.0: `ACQUIRE`, `OK BIN <n>`, STX `0x02`, 1024 × u16, 2064-byte frames. The hardware
that actually got built (`/home/muttu/Desktop/TCD1304_Timer_ADC`) speaks something else entirely:
magic `TC` + 16-byte header, 3694 × **signed** i16, 7406-byte frames, CRC over header *and* payload.
Only `crc16_ccitt` (`serial.rs:25`) survives the rewrite — same CCITT-FALSE algorithm.
`src-tauri/tests/serial_sim.rs` tests the old protocol against a simulator that is not in this repo,
and passes silently when it is missing.

**Untouched** — everything in Phase E. Nothing has been written yet.

**Not real, despite appearances** — worth knowing before trusting the UI:
`telemetry()` on serial returns all zeros and the Instrument panel renders them as readings
(`InstrumentWorkspace.tsx:90`); `ipc.getDiagnostics` is a hardcoded 4-entry array (`ipc.ts:104`);
`ipc.connectDevice` is never called, so Connect only sets local React state
(`InstrumentWorkspace.tsx:193`); the Acquire dark/reference chips toggle `refState` without calling
any calibration IPC (`ModeStrip.tsx:45`); `light_on` / `light_power` cross the IPC boundary and no
driver reads them.

## Uncommitted work

On branch `protocol_simulation`, all new this session, none committed:

| Path | What |
|---|---|
| `CLAUDE.md` | Project overview + tech stack (created this session, then amended with a Phase E pointer) |
| `PLAN.md` | Rewritten as Phase E only — **gitignored**, so it will not commit |
| `docs/PLAN-archive-phases-A-D.md` | The old 725-line plan, moved here with an archive header |
| `feature_list.json` | The 10 Phase E features, with files, notes and acceptance criteria |
| `SESSION-HANDOFF.md` | This file |
| `tools/create-issues.sh` | Creates the 10 GitHub issues via `gh` |
| `.claude/skills/{commit,new-branch,handoff}/SKILL.md` | Repo conventions as skills |

Also changed, not a file: `origin` was switched from HTTPS to `git@github.com:CheckAG/Jasper_UI.git`.

## Learned this session

- **The protocol lives in the hardware repo and is trustworthy.** `TCD1304_Timer_ADC/PROTOCOL.md`
  was verified line-by-line against the firmware with no discrepancies found. Port it as written;
  do not re-derive anything from the C. `Python_User_Code/tcd1304.py` is the reference host to
  transliterate. Ignore `main_gui.py` and `RA2A1_USB_Read.py` — DAC-era, they do not work.
- **VID/PID discovery is impossible here, twice over.** `serialport` is built
  `default-features = false` (`Cargo.toml:29`) and `libudev-dev` is not installed, so
  `available_ports()` cannot report VID/PID at all. And the device ships the stock Renesas
  `045B:5310` pair with a USB serial string hardcoded identically on every board. Probe with
  `*IDN?` and match the model field — that is what the reference host does.
- **"Version 1" is the protocol version byte, not the firmware string.** The device reports
  firmware `0.1` in its IDN and `0x01` in the frame header. Gate behaviour on the header byte and
  treat the IDN version as an opaque display string.
- **A capture costs ~2× the integration time.** The firmware discards one frame and sends the next.
  The current acquisition loop floor of `max(integration, 16)` (`commands/instrument.rs:112`) is
  therefore too fast and will starve the driver mutex.
- **Samples are signed on purpose.** Saturated pixels roll negative rather than wrapping to a
  plausible-looking positive value. Do not "fix" this to unsigned.
- **`DARK=16:28` in the metadata is unconfirmed against hardware** — the hardware repo flags it.
  Wrong indices raise no error, they silently bias every dark-corrected spectrum.
- The GitHub MCP token can read `CheckAG/Jasper_UI` but not write: `POST /issues` returns
  `403 Resource not accessible by personal access token`. Hence `tools/create-issues.sh`.

## Blocked / needs a human

- **Issues do not exist yet.** `gh` is not installed on this machine. Install it, `gh auth login`,
  run `./tools/create-issues.sh`, then write the returned numbers into the `issue` fields in
  `feature_list.json`. Until that happens `/new-branch` has no number to use.
- **No hardware has been connected in this session.** `/dev/ttyACM0` exists but nothing has been
  read from it. Every protocol claim here comes from the spec and the firmware source, not from a
  live board. E6's simulator is what unblocks development; a real board is still needed to confirm
  the `DARK` window and the inversion convention.
- **Two Phase E calls were made without the user weighing in**, both recorded in `PLAN.md`:
  x-calibration ships manual coefficient entry (neon auto-fit deferred), and `xs` defaults to pixel
  index rather than faking nm.
