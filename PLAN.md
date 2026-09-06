# JASPER — Phase E: real TCD1304 hardware

Phases 0–D are done and archived in [`docs/PLAN-archive-phases-A-D.md`](docs/PLAN-archive-phases-A-D.md).
That document still defines the layer architecture, IPC contracts and SQLite schema — read it
for anything this plan does not restate.

---

## Status

**Done:** E2a (#3) frame codec · E6 (#8) pty simulator · E2b (#4) driver — verified
against real hardware, serial `380B1C3537323731`.
**Next:** E3 (#5), E4 (#6) and E7a (#9) are unblocked and independent of each other.

---

## Context

The instrument protocol was unknown when JASPER was built, so `src-tauri/src/instrument/serial.rs`
was written against a speculative spec (`claude_hw_design/PROTOCOL.md` "specbench v1.0"). The
hardware that actually got built is a different device: the TCD1304 linear-CCD spectrometer at
`/home/muttu/Desktop/TCD1304_Timer_ADC`, running protocol **version 1** over USB CDC-ACM. Its
`PROTOCOL.md` is canonical and was verified line-by-line against the firmware — port it as written.

Phase E narrows the product to the two workspaces that talk to hardware — **Instrument** and
**Acquire** — and makes them drive the real device.

### Scope decisions

| Decision | Rationale |
|---|---|
| Analyze + Chemometrics hidden behind one feature flag | No deletion, no lost work; flip a boolean when they come back. Note `ExportDialog` imports `analyzeStore`, so that store must stay. |
| Python sidecar left in place, not exercised | It costs nothing dormant. No sidecar work this phase. |
| `serial.rs` replaced, not extended | Its wire format is a different device's. Nothing in it survives except the CRC-16/CCITT routine. |
| Discovery is probe-based, not VID/PID | The device ships the stock Renesas CDC VID:PID (`045B:5310`) shared by other RA demos, and the USB serial string is a constant. Worse, `serialport` is built with `default-features = false` and `libudev-dev` is not installed on this machine, so `available_ports()` cannot report VID/PID at all. Probing with `*IDN?` and matching the model field is what the reference host does anyway. |
| Wavelength calibration is host-side | The device stores none and the roadmap keeps it that way (a reserved `E` command would only store an opaque blob). Key the calibration record on the IDN serial. |

---

## The device, in one screen

- **Transport**: USB CDC-ACM, `/dev/ttyACM*`. Baud is accepted and ignored.
- **Commands** (ASCII, `\n`-terminated, first character only, case-insensitive):
  `?` / `*IDN?` → IDN · `M` → METADATA · `I<ms>` → ACK `I<applied>` · `A` → one SPECTRUM ·
  `X` → ACK `X` · anything else → ERR `unknown command`.
- **Every reply is the same envelope**, all little-endian, **no STX/ETX**:

  | Offset | Size | Field |
  |---:|---:|---|
  | 0 | 2 | magic `'T','C'` (`0x54 0x43`) |
  | 2 | 1 | version `0x01` |
  | 3 | 1 | type: 1 SPECTRUM · 2 IDN · 3 ACK · 4 ERR · 5 METADATA |
  | 4 | 2 | seq — completed CCD frames, free-running, wraps |
  | 6 | 2 | payload_len |
  | 8 | 4 | integ_ms in force for this frame |
  | 12 | 2 | status — bit 0 `DROPPED`, rest reserved |
  | 14 | 2 | reserved |
  | 16 | N | payload |
  | 16+N | 2 | CRC-16/CCITT-FALSE over bytes `[0 .. 16+N-1]`, stored LE |

- **SPECTRUM payload**: 3694 × **signed** `i16` LE = 7388 bytes; frame total 7406.
  Signed is deliberate — a saturated pixel rolls negative rather than wrapping to a plausible value.
- **METADATA**: `PIXELS=3694;ACTIVE=32:3679;DARK=16:28;INTEG_MIN_MS=8;INTEG_MAX_MS=10000;MAX_INTENSITY=32767;PIXEL_RATE_HZ=500000;READOUT_US=7388;SENSOR=TCD1304AP;`
  Unknown keys **must be ignored** — new ones arrive without a version bump.
- **IDN**: `Jasper,TCD1304,<16 uppercase hex>,0.1` — SCPI field order. Gate on the header's
  `version` byte, never on the `0.1` firmware string.
- **Timing**: `A` discards one frame and sends the next, so a capture is ≈ 2 × integration + a few ms.
  Timeout `3 × integ_ms + 500 ms` for `A`, 1 s for everything else; clear the whole RX buffer on timeout.
- **No streaming mode.** Continuous view is a loop of `A`. None is planned.
- **CRC-16/CCITT-FALSE**: poly `0x1021`, init `0xFFFF`, no reflection, no final XOR.
  Check value for `"123456789"` is `0x29B1`.

Reference implementation to transliterate: `TCD1304_Timer_ADC/Python_User_Code/tcd1304.py`
(`_parse_frame:143`, `_read_frame:292`, `capture:269`).

---

## What has to change

### E1 — Hide Analyze + Chemometrics

Single exported flag, e.g. `export const WORKSPACES_ENABLED` in `src/lib/features.ts`.

- `src/components/layout/WorkspaceRail.tsx:6` and `src/components/overlays/CommandPalette.tsx:6`
  hold two hardcoded copies of the same `WS_ITEMS` array — filter both through the flag
  (better: move `WS_ITEMS` into `features.ts` and import it in both places, killing the duplicate).
- `src/App.tsx:71-72` render branches stay; they become unreachable.
- Leave `store/analyzeStore.ts` alone — `ExportDialog.tsx:4` depends on it.

### E2 — Replace the driver: `src-tauri/src/instrument/serial.rs` → `tcd1304.rs`

Delete `serial.rs`. New module implementing the same `SpectrumDriver` trait (`driver.rs:91`),
so nothing above it changes shape.

- **Framing** — a content-addressed reader, never position-based: scan for `'T','C'`; need
  16 bytes to read the header; reject `version != 0x01`, `type ∉ 1..=5`, `payload_len > 7388`;
  on any rejection **discard one byte and rescan**; verify CRC before emitting. A false `TC`
  inside spectrum data is a real occurrence, not a hypothetical.
- **Read a frame of a wanted type**; skip and drop frames of other types (a late `ACK` after a
  timeout must not be mistaken for the next capture). Any `ERR` frame becomes an `Err` regardless
  of what was awaited.
- **Handshake** on connect: `X\n`, 50 ms, flush input, `*IDN?\n`, require 4 comma fields and
  `fields[1] == "TCD1304"`, then `M\n` and cache the parsed metadata.
- **`scan()`**: push `I<ms>` only when the value changed (keep the existing lazy-push idea from
  `serial.rs:199`), then `A\n`, then read one SPECTRUM with the `3×T+500 ms` timeout.
- **Samples**: `i16::from_le_bytes`, **not inverted**. The plan originally said to apply
  `max_intensity - raw`, copying the reference GUI's default-on "Invert" (raw CCD video reads
  high in the dark). Measurement overruled it: an unilluminated frame on serial
  `380B1C3537323731` sat between 1982 and 2921 of a 32767 range — near the floor, not the
  ceiling — so inverting would render darkness as ~30,267. Saturation still comes from metadata
  `MAX_INTENSITY`, never a hardcoded constant. Unproven without a controlled light/dark pair;
  `to_intensity()` is the single place to flip.
- **`status` bit 0** = dropped frame: surface it, do not discard the frame — it is valid, just one
  integration period late. Mask bit 0 specifically; bits 4–6 are earmarked for a future state machine.
- Keep `crc16_ccitt` from the old `serial.rs:25` verbatim — same algorithm, and it is already tested.

### E3 — Discovery and connect

Today the port comes from the `JASPER_PORT` env var at `state.rs:47` and there is no runtime switch.

- `device_list()` enumerates `serialport::available_ports()`, keeps names matching
  `ttyACM* | ttyUSB* | cu.usbmodem* | COM*`, probes each with the E2 handshake, and returns a
  `DeviceInfo` per device that answers `TCD1304` — `id` = port path, `name` = `TCD1304 · <serial tail>`.
- `JASPER_PORT` stays as a manual override, and is the only way to reach the pty simulator (E6),
  since a pty does not appear in `available_ports()`.
- Wire up `connect_device` / `disconnect_device` for real: `InstrumentWorkspace.tsx:193` currently
  only calls `setActiveDevice` locally, so `ipc.connectDevice` (`ipc.ts:127`) is dead code today.
  Make the driver box swappable at runtime — `AppState.driver` is already
  `Arc<Mutex<Box<dyn SpectrumDriver + Send>>>` (`state.rs:8`), so connect can replace its contents.

### E4 — Params the device accepts, and a backpressure gate

`AcqParams` (`driver.rs:6`, mirrored at `src/lib/types.ts:14`) carries fields the hardware has no
command for. Make the UI honest:

- **Integration**: clamp the `ActionShelf.tsx:40` slider to the metadata range (8–10000 ms), not
  the current 5–500. The device clamps anyway and reports the applied value in the ACK — echo that
  back into the store so the slider shows what the device is really doing.
- **Averaging**: no device support; keep it host-side. `process::average_scans` (`process.rs:27`)
  already does exactly this and is already called by the calibration commands.
- **Light on / power**: no lamp command exists on this hardware. Hide both controls
  (`ActionShelf.tsx:67-71`) behind the same features flag; leave the fields in `AcqParams`.
- **Acquisition loop**: `commands/instrument.rs:112` sets the interval floor from `integration`.
  A capture costs ≈ 2 × integration, so the floor must be `2 × integ_ms`, not `max(integ, 16)`,
  or every iteration blocks and starves the driver mutex.
- **Backpressure**: the loop emits `spectrum-frame` unconditionally (`commands/instrument.rs:143`).
  Each frame is 3694 points; at short integration times the webview falls progressively behind
  instead of tracking the newest data. Port the gate from the PyQt6 reference
  (`pipeline/worker.py`): an `AtomicBool` set before emit, cleared by a `frame_consumed` command
  the frontend invokes after rendering. Continuous drops frames while the gate is set;
  **single-shot never drops** — every frame must reach the averaging accumulator.

### E5 — Wavelength calibration (host-owned)

`xs` is currently built at port open from a `GET CAL` polynomial the new device does not have,
falling back to pixel index. The device stores no calibration and the firmware roadmap keeps it
that way, so JASPER owns pixel→nm.

**Port `math/calibration.py` from the PyQt6 reference rather than hand-entering coefficients.**
It is a complete, working auto-calibration — a transliteration, not research:

1. `detect_peaks()` — scipy `find_peaks`, height as a fraction of max, minimum pixel distance,
   then sub-pixel refinement by 3-point quadratic fit.
2. `_best_anchor_map()` — RANSAC over ordered pairs of (tallest peaks) × (reference lines).
   Scored on **distinct** lines hit, which is what rejects degenerate near-flat maps.
3. `_match_peaks_to_lines()` — greedy nearest-neighbour in ascending error order, each peak and
   each line consumed at most once, so one blurred peak cannot claim two lines.
4. `legfit` degree 2 or 3, then R² and RMS.
5. Neon (43 lines, already extended past the C++ original against real hardware) and
   mercury-argon (22 lines) tables, verbatim.

**Legendre basis, not raw polynomial.** Map pixel to `[-1, 1]` as `2i/(n−1) − 1` before evaluating.
The dead `serial.rs:132` used raw Horner on the pixel index; at 3694 pixels `p⁵ ≈ 6.8e17`, which is
ill-conditioned exactly where this sensor lives.

Storage: new `instrument_cal` table in `src-tauri/src/storage/schema.sql` — serial, coefficients
JSON, fitted_at, note — **keyed on the IDN serial number**, the only unique ID the device has.
Forward-compatible with the firmware's reserved `E` command, which would store an opaque blob.

With no calibration loaded, fall back to the pixel axis **regardless of the configured axis
setting** (`x_unit = 'px'`, already supported at `types.ts:11`). `XCalResult` (`driver.rs:81`)
already carries `coefficients` / `rms` / `peaks_found`, and `ipc.ts:170` already delivers them to
the UI, where they are discarded today.

`_best_anchor_map` is O(candidates² × lines²) — ≈120k inner iterations. One-shot behind a Fit
button with an abort path, as the reference wires it (`_FitThread`). Never run it per frame.

### E6 — Simulator

`src-tauri/tests/serial_sim.rs` drives a `claude_hw_design/tools/protocol-sim/sim.py` that belongs
to the old protocol, and silently passes when it is missing. The hardware repo has no pty simulator
either — only an in-process `_FakeDevice` (`tcd1304.py:366`) that Rust cannot reach.

Write `tools/tcd1304-sim.py` in this repo: `pty.openpty()`, print the slave path on stdout, then
the `_FakeDevice` command dispatch and `build_frame()` (`tcd1304.py:135`) verbatim. ~40 lines.
Rewrite `serial_sim.rs` against it, and make a missing simulator **fail** rather than pass silently.

### E7 — Instrument workspace: show real device state

The panel currently renders fabricated numbers as if they were readings.

- **TelemetryPanel** (`InstrumentWorkspace.tsx:90`): the device has no telemetry. Replace the four
  tiles with what it does report — firmware version, protocol version, serial, pixel count,
  integration range, last `seq`, dropped-frame count, last capture round-trip in ms. This needs
  either a widened `TelemetryData` (`driver.rs:54`) or a new `DeviceMetadata` type; a new type is
  cleaner since none of the existing fields apply.
- **DiagnosticsLog** (`:140`): `ipc.getDiagnostics` returns a hardcoded 4-entry array
  (`ipc.ts:104`). Feed it real events — connect, handshake, ERR frames, CRC resyncs, dropped frames.
- **CalibrationPanel** (`:10`) drops the `warn` string into `console.warn` (`:25`). Toast it.
- **Acquire `ModeStrip` dark/reference chips** (`ModeStrip.tsx:45`) are cosmetic toggles that call
  no IPC. Either wire them to `ipc.calibrateDark` / `ipc.calibrateReference` or make them read-only
  indicators of `refState`.

### E8 — Generate the x-axis from stored calibration, not inside the driver

`xs` is built once in the driver at port open and shipped in every `SpectrumFrame` (`driver.rs:45`),
so the wavelength axis is baked in by the layer furthest from the display and changing a calibration
means reconnecting. The PyQt6 reference does the opposite: `AxisGenerator.generate(n_pixels)`
returns `(x, label, x_min, x_max)` on demand from the stored calibration plus the sample count, and
the driver only ever produces counts. Frames should carry `ys` and `n_pixels`; drop `xs` from the
hot path. Keep the `XUnit` union (`types.ts:11`) — `LiveSpectrum.tsx:7-24` already converts nm→µm
and nm→cm⁻¹, and its `px` branch (`:19`) currently fakes a fractional index that would become real.
Do this after E5, when there is a calibration worth switching between.

### E9 — CI

There is none; nothing checks that a PR compiles. On push to `master`/`feature/**`/`fix/**` and on
PRs to `master`: `npx tsc -b`, `npx eslint .`, `cargo test`, `cargo clippy -- -D warnings`.
The Ubuntu runner needs the Tauri system deps first (`libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev
librsvg2-dev libayatana-appindicator3-dev libsoup-3.0-dev`) and a cache on `~/.cargo` +
`src-tauri/target`, or the Rust job costs minutes every run. `cargo test` includes the E6 simulator
test, so the runner needs `python3` — and that test must **fail** when the simulator is missing,
which is the whole point of running it in CI. Packaging can wait; compiling and testing cannot.

---

## Verification

| Step | Done when |
|---|---|
| E1 | Rail and ⌘K palette show only Acquire + Instrument; Export dialog still opens. |
| E2 | `cargo test -p jasper` — CRC check value `0x29B1` for `"123456789"`; resync test feeds a frame prefixed with garbage containing a false `TC` and still parses it. |
| E3 | With the sim running, `device_list()` returns exactly one `TCD1304`; connect/disconnect from the UI actually opens and closes the port. |
| E4 | Set integration to 3 ms in the UI → ACK reports 8 → slider snaps to 8. With a deliberately slow renderer, continuous drops frames and the trace stays current; a single-shot 8-frame average still receives all 8. |
| E5 | Fit against a neon capture → RMS < 1 nm, R² and matched-line count reported. Save, restart, reconnect the same serial → x-axis comes back in nm. |
| E6 | `python3 tools/tcd1304-sim.py` prints a pty path; `SPECBENCH_SIM=… cargo test` passes against it; deleting the sim makes the test fail. |
| E7 | Instrument panel shows the sim's IDN serial and firmware `0.1`; unplugging mid-capture puts a real entry in the diagnostics log. |
| E8 | Applying a calibration updates the axis without reconnecting; switching x unit does not round-trip to Rust. |
| E9 | A PR that breaks the TS build or a Rust test fails CI, and the simulator test runs there. |
| End-to-end | `./run.sh` with the real board on `/dev/ttyACM0`: live trace, a capture lands in the session, kill and reopen the app and the capture is still there. |

---

## Reference implementations

- **`~/Desktop/TCD1304_Timer_ADC`** — our hardware. `PROTOCOL.md` is canonical and was verified
  line-by-line against the firmware; `Python_User_Code/tcd1304.py` is the reference host to
  transliterate. Ignore `main_gui.py` and `RA2A1_USB_Read.py` — DAC-era, they do not work.
- **`~/Desktop/Spectrum Analyzer python`** — a PyQt6 spectrum analyser for camera-based sensors,
  same layering as ours (`ICamera` ≈ `SpectrumDriver`, `AcquisitionWorker` ≈ our acquisition thread,
  `SpectrumProcessor` ≈ `process.rs`, plus an `AxisGenerator` we lack).
  **Take**: `math/calibration.py` (E5), the backpressure gate in `pipeline/worker.py` (E4), the
  axis-on-demand model (E8), the CI shape (E9).
  **Do not take**: the C++-fidelity DSP chain ordering, anything 2D-sensor (column summation, ROI
  rows, exposure/gain scaling, median filter), the `saturation`/`roi` channels in `SpectrumData`,
  or the Raman axis. Those exist to collapse an image into a spectrum; our device hands us 1D.

---

## Deferred

- Analyze, Chemometrics, and everything in the Python sidecar.
- `DARK=16:28` from metadata is **unconfirmed against hardware** — the hardware repo flags it, and
  wrong indices silently bias every dark-corrected spectrum. Confirm with a capped sensor before
  using the dark window for per-frame correction.
- Dark/reference frames are in-memory only (`state.rs:19`) and lost on restart; `CalFrame.integration_ms`
  is recorded but never checked at apply time (`process.rs:65`).
- Firmware roadmap items that will move the wire without a version bump: new `M` keys
  (`SAMPLE_FMT`, `FRONTEND`, `INTENSITY_MIN/MAX`, `ADC_BITS`), `U<µs>` integration, `F<n>` flush,
  capture countdown 2 → 1. Do not hardcode "negative means saturated" or a `seq` delta of exactly 2.
