# Session handoff

Updated 2026-10-12. Refresh with `/handoff` at the end of every working session.
`docs/PLAN-migration.md` says what is planned for Phase F; this says what happened.

## Now

**Continue F5** on `feature/migration`. Committed and simulator-tested, not yet on the board: the socket
(`src-tauri/src/api/server.rs`, plain TCP JSON lines on `127.0.0.1:8765`), the Python client/CLI and the
read-only MCP server (`clients/python/jasper/`, `python -m jasper.mcp`, self-check
`python3 clients/python/test_mcp.py`). A `capture-saved` event now brings script captures into the Captures panel (verified on the board 2026-10-12). Next: `subscribe`
for live spectra, the confirmation flow, Stage-2 MCP tools. Or finish F6. See `docs/PLAN-migration.md`.
Adding a sensor: `src-tauri/src/instrument/mod.rs` explains the steps; nothing else names one.

## State

**Phase F (Toolbox design adoption) is on `feature/migration`: F1–F4 done, F5 and F6 partly done.** Phase E stays at 9 of 12 (`feature_list.json`; it has no Phase F entries).

**Everything committed on `feature/migration` was verified on the real board by the user, 2026-10-12**
(serial `380B1C3537323731`):
- `86f439f` F1 light/dark theme switch.
- `25f5009` F3 single screen with a menu bar (the workspace rail is gone).
- `9c15e29` F2 every capture saved as a SQLite row plus a `.jdx` file in its workspace folder.
- `dd52567` F4 the GUI goes through one Device API (`src-tauri/src/api/mod.rs`) on protocol v1.
- `e1a3dcf` Live is the first toolbar button (`src/workspaces/acquire/ModeStrip.tsx`), shortcut **L**
  (was P). The sample tag lives in `acqStore.sampleTag`, so Space and menu captures keep it too.
  Capture stays in the left column (`ActionShelf.tsx`). The user tried moving it into the toolbar as the
  mockup has it, then asked for it back.
- F6 commit: a saturation banner at ≥98% of full scale (`SATURATION_WARN`,
  `src/components/layout/StatusBar.tsx:8`). `SpectrumFrame.peak` is the brightest raw pixel / `max_intensity`,
  and 1.0 if any raw sample hits the ADC limit. A stale-dark banner (`reference.dark_stale`) shows for
  5 s each time the dark goes stale (the user asked for that). The status bar shows fps and a peak meter.
- Compound `.jdx` commit: a capture's file is a JCAMP-DX compound file (`##DATA TYPE=LINK`). Block 1
  is the processed spectrum with `##$UNITS` (counts / counts_d / ratio / abs), then the raw sample
  (only when processing changed it), dark and reference, each with integration and averages
  (`src-tauri/src/storage/files.rs`, `save_capture` in `api/mod.rs`). With nothing extra it is a plain
  single-block file. The user picked this over separate dark/reference files.

**Half-built:**
- F2 gaps: the data folder has no in-app setting (`~/JASPER` or `JASPER_DATA_DIR`), and Export does not copy
  `.jdx` files. Dark/reference live in memory only (lost on restart) and carry no timestamp.
- F4 gaps: no `subscribe` (live frames still use the `spectrum-frame` event); firmware update and x-cal
  have their own Tauri commands outside the API.
- `process()` still applies a dark taken at another integration. The banner warns, but the maths does not refuse.
- X-axis calibration has no backend: `calibrate_xcal` returns `Err`, and `xs` is the pixel index (#7, #13).
- `eslint` does not run: `hermes-parser` fails to load (`Cannot find module './generated/ParserVisitorKeys'`).

**Untouched:** Analyze and Chemometrics (compiled but unreachable), the Python sidecar. The sidecar's
`write_jcamp_multi` (`python-sidecar/jasper/jcamp.py:52`) omits `##BLOCK_ID`. It is unused, so it is not fixed.

## Uncommitted work

Clean.

## Learned this session

- **Saturation is measured against the device's `max_intensity`, not 65 535.** The video is inverted
  (`to_intensity = max_intensity - raw`), so the processed full scale is `max_intensity` (32 767 from
  METADATA).
- **Compare a dark with the requested integration, not the applied one.** The first stale-dark check
  compared `frame.integration_ms` (what the device applied) with the setting (what was asked for), so on
  the board the banner never cleared. `CalFrame.requested_ms` fixes that.
- **Nothing documents whether SpectraGryph reads JCAMP compound files.** Its changelog is silent. The
  user chose compound files anyway and confirmed the result works on the board.
- The CSV `# key: value` header listed under F6 already shipped with F2.

## Blocked / needs a human

- **A neon or mercury-argon lamp** for #7 (wavelength calibration).
- **Anything behind a Connect click needs someone at the machine.** Nothing here drives the Tauri
  WebKitGTK window.
- **The GitHub token is read-only** (`403 Resource not accessible by personal access token` on issues
  and PRs) and `gh` is not installed, so issues and PRs are created by hand.
