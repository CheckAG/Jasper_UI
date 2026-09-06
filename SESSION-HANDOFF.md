# Session handoff

Written 2026-09-06. Update this with `/handoff` at the end of every working session.
It is what the next agent inherits — `PLAN.md` says what is planned, this says what happened.

## Now

Phase E has not started. The first thing to build is **E2a — the TCD1304 frame codec** (#3,
`src-tauri/src/instrument/tcd1304/frame.rs`), because E2b, E3, E4, E5 and E7 all sit on top of it.
E6 (#8, the pty simulator) only needs E2a, so those two go in parallel and E6 is what makes E2b
testable without hardware.

Branch off `origin/master` with `/new-branch 3`.

**Before starting E4, E5, E8 or E9, read `~/Desktop/Spectrum Analyzer python`** — a PyQt6 spectrum
analyser for camera sensors with the same layering as ours. Four pieces of it are being ported, not
reinvented; `PLAN.md` → Reference implementations says what to take and what to leave.

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

**Untouched** — everything in Phase E. Nothing has been written yet. Twelve features: #2–#11 exist
on GitHub; E8 and E9 sit in `feature_list.json` with `issue: null` until they are filed.

**Not real, despite appearances** — worth knowing before trusting the UI:
`telemetry()` on serial returns all zeros and the Instrument panel renders them as readings
(`InstrumentWorkspace.tsx:90`); `ipc.getDiagnostics` is a hardcoded 4-entry array (`ipc.ts:104`);
`ipc.connectDevice` is never called, so Connect only sets local React state
(`InstrumentWorkspace.tsx:193`); the Acquire dark/reference chips toggle `refState` without calling
any calibration IPC (`ModeStrip.tsx:45`); `light_on` / `light_power` cross the IPC boundary and no
driver reads them.

## Uncommitted work

Clean. Everything from the planning session was merged to `master` as PR #12
(`c78eeeb` — plan, feature list, handoff, three skills, CLAUDE.md).

Uncommitted after the reference-implementation review: `PLAN.md`, `feature_list.json` and this file,
carrying the E4/E5 rescope and the new E8/E9.

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
- **The PyQt6 reference at `~/Desktop/Spectrum Analyzer python` already solves four of our problems.**
  Same layering, different sensor. `math/calibration.py` is a complete neon auto-calibration
  (adaptive peak detect → RANSAC anchor bootstrap → greedy one-to-one line matching → Legendre fit
  with R²/RMS) — the TCD1304 firmware repo lists this as *not done*, but it is done here, so E5 (#7)
  became a port instead of "manual coefficients first". `pipeline/worker.py` has the frame-drop
  backpressure gate our acquisition loop lacks (added to E4, #6). `pipeline/axis.py` generates the
  axis on demand rather than baking it into frames (new E8). Its `.github/workflows/ci.yml` is the
  CI shape we have none of (new E9).
- **Use the Legendre basis over a normalised index, never a raw polynomial.** At 3694 pixels
  `p⁵ ≈ 6.8e17`; the dead `serial.rs:132` did raw Horner on the pixel index.
- The GitHub MCP token can read `CheckAG/Jasper_UI` but not write: `POST /issues` and
  `PATCH /issues/<n>` both return `403 Resource not accessible by personal access token`. Hence
  the one-shot scripts; the current one is `/tmp/claude-1000/-home-muttu-Desktop-Jasper-ui/740fb8ba-05bd-48f2-baac-19f44039e9da/scratchpad/update-issues.sh`.

## Blocked / needs a human

- **`gh` is not installed, and the GitHub MCP token is read-only.** #2–#11 were filed by hand.
  The amendments to #6 and #7 and the two new issues (E8, E9) are still pending: install `gh`,
  `gh auth login`, run `/tmp/claude-1000/-home-muttu-Desktop-Jasper-ui/740fb8ba-05bd-48f2-baac-19f44039e9da/scratchpad/update-issues.sh`,
  then write the two returned numbers into `feature_list.json`. That script lives in the session
  scratchpad, not the repo — `tools/` was deleted once its create-issues script had been used.
- **No hardware has been connected in this session.** `/dev/ttyACM0` exists but nothing has been
  read from it. Every protocol claim here comes from the spec and the firmware source, not from a
  live board. E6's simulator is what unblocks development; a real board is still needed to confirm
  the `DARK` window and the inversion convention.
- **One Phase E call was made without the user weighing in**, recorded in `PLAN.md`: `xs` defaults
  to pixel index rather than faking nm. (The other — manual x-cal coefficients — was overturned
  after reading the PyQt6 reference; E5 now ports the auto-fit.)
