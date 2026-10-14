# JASPER — Phase F: adopt the Toolbox design

Branch `feature/migration`, rebased on `origin/master` at `1ca38db` (includes Excel export, PR #38) on 2026-10-11.
Sources: `~/Downloads/design upgrade/` (requirements + staged plan, Device API, `mock.html`), dated 2026-10-10.
Adopted mockup: [`docs/design/jasper-toolbox.html`](design/jasper-toolbox.html).

## Decisions (user, 2026-10-11)

| Decision | Consequence |
|---|---|
| Keep Tauri 2 + React. No PySide6. | All existing code carries over. The design docs' "Python stack" line does not apply. |
| Light **and** dark theme, user switch | Replaces the "light theme only" rule. Light stays the default. |
| No personas — every feature visible in one UI | Density (comfort / standard / lab) stays as a View-menu display size only. |
| "Workspace" = the named container you work in | The four screen-workspaces go away. Today's `Session` is renamed **Workspace** in the UI; its name is always shown in the menu bar. |
| Every capture saved twice | A row in SQLite **and** a `.jdx` file in `<data folder>/<workspace-slug>/`. |
| One screen with menus | Instrument + Acquire merge into one screen. Analyze and Chemometrics stay hidden behind `ENABLED_WORKSPACES`, untouched. |
| Keep protocol v1, make the app API-first on top of it | No firmware change for this phase. `jasperd` maps API variables onto `?`/`M`/`I<ms>`/`A`/`X`. |
| No light-source control | The board has none. Remove the dead toggle in `ActionShelf.tsx:88`. |

## Where every existing feature lands

| Today | In the single screen |
|---|---|
| `WorkspaceRail`, `TopBar` | Menu bar (File · Device · Acquire · Process · Calibrate · View · Help) + workspace switcher + theme toggle |
| `ModeStrip` (live/freeze, dark, reference, overlay/stack) | Toolbar |
| `ActionShelf` (integration, averaging, sample tag) | Left column: Acquisition, Sample. Light-source block deleted |
| Instrument: device card | Left column: Instrument card. Toolbar connection chip |
| Instrument: discover/connect list | Device ▸ Instruments… dialog |
| Instrument: firmware update (.srec) | Device ▸ Firmware update… dialog |
| Instrument: diagnostics log | Device ▸ Diagnostics |
| Instrument: calibration rows (dark/ref/X-cal) | References card + toolbar; X-cal under Calibrate menu, disabled until #7 |
| `LiveSpectrum` with zoom/box/pan (#30) | Centre. Unchanged component, theme-aware colours |
| `CaptureContextPanel`, export button | Right column: Captures |
| `ExportDialog` (+ xlsx from #32 once merged) | File ▸ Export… and toolbar Export |
| `StatusBar` | Status bar: connection, fps, peak % of swing, cursor x/y, session |
| `CommandPalette`, `NewSessionDialog`, `Toaster` | Kept. Every menu item is also a palette command |
| `WorkspaceRail` sessions list, `NewSessionDialog` | Workspace switcher in the menu bar; File ▸ New / Open workspace |
| — (new) | Right column: Device API log |

## Steps

Each step is one commit (or a few) on `feature/migration`, app working after each.

### F1 · Theme switch
**Done 2026-10-11** (`86f439f`).
- `src/styles/tokens.css`: add a `:root[data-theme="dark"]` block redefining every colour token (palette in the mockup). Drop the "light only" header.
- `uiStore`: `theme: 'light' | 'dark'`, persisted next to `density`; `App.tsx` sets `data-theme` on `<html>`.
- `LiveSpectrum` / `StaticChart`: read colours from CSS variables at draw time instead of the `theme="light"` prop; redraw on theme change.
- Accept: toggle flips every surface including the canvas; choice survives restart.

### F2 · Workspaces with a folder, and dual save
- UI copy: Session → **Workspace** everywhere the user reads it. Code type `Session` stays (no DB migration).
- Menu bar shows the open workspace name + spectrum count; click to switch. Window title = workspace name.
- Data folder setting, default `~/JASPER/`. Each workspace gets `<data folder>/<slug(name)>/`, created on New.
  Store the folder path on the session row (one new nullable column).
- Capture writes **both** in one backend call: the SQLite row (as today) and
  `<slug(label)>_<HHMMSS>.jdx`. Native Rust JCAMP-DX 5.01 writer (`##XYDATA=(X++(Y..Y))`, metadata in
  `##TITLE`, `##OWNER`, `##LONGDATE`, `##$INTEGRATION TIME`, `##$AVERAGES`, `##$SERIAL`) — no sidecar spawn per
  capture. Dark and reference frames saved the same way (`dark_…jdx`, `reference_…jdx`).
- If the file write fails the DB row still lands and the UI says which file failed; never lose the capture.
- Delete capture: removes the row; the file moves to `<folder>/.trash/`, not deleted.
- Export (File ▸ Export…, toolbar, captures panel) offers **CSV, XLSX, TXT** and JCAMP-DX:
  - CSV: `# key: value` metadata header, then x column + one column per selected spectrum.
  - TXT: same layout, tab-separated.
  - XLSX: existing `cmd_save_xlsx` from #32 (Spectra + Metadata sheets).
  - JCAMP-DX: copies the selected `.jdx` files to the chosen folder.
  - SVG / PDF / CSV-matrix leave the dialog (code kept). Legacy `.xls` is not offered: no maintained writer, and
    every Excel since 2007 opens `.xlsx`.
- Accept: capture N spectra → N rows + N `.jdx` files; each `.jdx` opens in SpectraGryph; a round-trip read of the file
  matches the stored arrays.

**Built 2026-10-11 (not yet run on the board).** Deviations: the spectra root is `~/JASPER` or
`JASPER_DATA_DIR` (no in-app setting yet); the folder is derived from the workspace name, not stored;
dark/reference frames are not written as separate files; instead (2026-10-12, user's choice) each capture's
`.jdx` is a JCAMP-DX compound file — processed spectrum as block 1, then the raw sample, dark and reference
held at capture time; the export dialog offers CSV/XLSX/TXT and points at the folder instead of copying `.jdx`
files; the x column is labelled `pixel` everywhere until wavelength calibration exists.

### F3 · Single-screen shell
**Done 2026-10-11** (`25f5009`, not yet run on the board).
- New `layout/MenuBar.tsx`, `layout/Toolbar.tsx`, `layout/ToolboxScreen.tsx`. Reuse existing components; move Instrument pieces into `overlays/InstrumentsDialog`, `FirmwareDialog`, `DiagnosticsDialog`.
- `features.ts`: the rail goes; Analyze/Chemometrics stay compiled but unreachable.
- Responsive: three columns ≥1180 px; captures/API log drop below the plot under 1180; one column under 760 (plot first).
- Delete light-source UI (`ActionShelf.tsx:88`) and `lightOn`/`lightPower` from `driver.rs` + `types.ts` (mirrored pair).
- Remove `WorkspaceRail`; workspace switching lives in the menu bar.
- Keep the stream-restart rule: anything that restarts acquisition respects `paused`.
- Accept: everything in the table above works from one screen with the board connected; nothing from Phase E regressed.

### F4 · Device API core (`jasperd`, in-process first)
**Built 2026-10-11** (verified against the simulator, not the board). `src-tauri/src/api/`: `read` (one
name or `names`), `write`, `invoke`; variables `device.state|info|diagnostics`,
`acquisition.integration_time_ms|averages|live`, `reference.dark|white`, `processing.mode`,
`workspace.active`; commands `discover`, `connect`, `disconnect`, `start_live`, `stop_live`, `capture`,
`capture_dark|reference`, `clear_dark|reference`. The backend now owns integration, averaging and Live;
the GUI mirrors them. `capture` files the spectrum itself (row + `.jdx`), so a script's capture lands
like the GUI's. Audit log: `<app data>/api-audit.jsonl`, writes and commands only (reads are polled every
2 s). Still outside the API: firmware update and x-cal (own Tauri commands), frame backpressure.
- `src-tauri/src/api/`: JSON-RPC 2.0 dispatcher with `read` / `write` / `invoke` / `subscribe`; variable catalogue for what exists today (`device.*`, `acquisition.integration_time_ms`, `acquisition.averages`, `reference.dark`, `reference.white`, `processing.mode`, `spectrum.live`, `spectrum.last`).
- Limits from device METADATA (`integMinMs`–`integMaxMs`). Script/agent callers get `LIMIT_EXCEEDED`; the GUI may clamp its own input.
- GUI routes through it: one Tauri command `cmd_api` → dispatcher. Per-feature commands in `commands/instrument.rs` become thin calls, then go (S1-17).
- Audit log: JSON Lines, every call with time, caller (`gui`/`cli`/`script`/`agent`), method, args, result.
- Accept: every GUI action shows up in the audit log; a test drives the dispatcher with the simulator.

### F5 · External transport + clients
**Partly built 2026-10-12** (simulator-tested, not yet on the board). User chose **plain TCP, one JSON object
per line** on `127.0.0.1:8765` over WebSocket: no new dependencies on either side. `src-tauri/src/api/server.rs`
hands each line to `dispatch`; a client names itself `script`/`cli`/`agent` (never `gui`, so it gets
`LIMIT_EXCEEDED` instead of clamping). `clients/python/jasper`: `Client.read/write/invoke`, and
`python -m jasper` as the CLI. Read-only MCP server `python -m jasper.mcp` (stdio, stdlib only): tool
`jasper_read`, resource `jasper://reference` (`clients/python/jasper/reference.yaml`, the API doc's layout with
this board's values: 3694 pixels, full scale 32 767, averages ≤ 64, no light source, pixel x-axis). Self-check:
`python3 clients/python/test_mcp.py`. **Added 2026-10-13, verified on the board:** `subscribe` (events as JSON-RPC notifications; a slow client
drops frames), `python -m jasper watch`; the confirmation flow — privileged commands (`update_firmware`, now in the
API) from outside the app wait up to 120 s for Approve/Decline in a GUI dialog, `confirm` is GUI-only. Not yet:
Stage-2 MCP tools (`jasper_capture` etc.), calibration writes as privileged commands (no backend, #7).
- WebSocket listener on `127.0.0.1:8765`, localhost only (new dep: `tokio-tungstenite`). Spectra as binary frames.
- `clients/python/jasper`: thin client (`read`, `write`, `invoke`). CLI on top of it.
- Read-only MCP server exposing `jasper_read` + the reference file.
- Privileged-action confirmation flow: framework only (firmware upgrade is the first user — it already exists).
- Accept: a Python script captures the same spectrum the GUI shows; both appear in the audit log with different callers.

### F6 · Stage-1 gaps
**Partly built, verified on the board 2026-10-12:** saturation banner + peak meter (`peak` on every
frame, fraction of the device's full scale on the raw frame; 1.0 when a pixel hits the ADC limit), stale-dark
banner (`reference.dark_stale`, shown 5 s each time the dark goes stale), fps + peak in the status bar (cursor readout already there). The CSV header
shipped with F2. **Rest done 2026-10-14 (PR #40), verified on the board:** auto-reconnect, burst capture,
settings profiles (+ last settings restored on start), recent workspaces and exports.
- Saturation flag **on the processed scale** (`max - raw`, video is inverted): peak % of the measured swing, banner at ≥98%. The docs' "98% of 65 535" does not apply to this board.
- Stale-dark warning when integration or averaging changed since the dark.
- Status bar fps + peak meter + cursor readout.
- CSV `# key: value` metadata header; settings profiles; recent sessions; burst capture; auto-reconnect on replug.

## Not in this phase
- Light source (no hardware).
- Device-stored calibration (needs firmware); #13 stays host-side until then.
- MHS alignment beyond naming — the public spec is not available to verify against.
- Binary firmware protocol from the Device API doc.
- Windows build + CI (#14) — next after this phase.
