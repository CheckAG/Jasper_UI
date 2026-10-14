# Session handoff

Updated 2026-10-14. Refresh with `/handoff` at the end of every working session.
`docs/PLAN-migration.md` says what is planned for Phase F. The **PRD tracker** shows every requirement's
status: https://claude.ai/artifact/DhQJxj99bYngZ8g4FPYtZq. This file says what happened.

## Now

**F6 is merged to `master`** (PR #40, `017d6ef`, 2026-10-14). Nothing is in flight. Start the next work on a
new branch from `master` (`/new-branch`). Candidates, ask the user which: F5's Stage-2 MCP tools
(`jasper_capture` etc., PRD MHS-05), the remaining Stage-1 rows (S1-08 axis lock, S1-13 two plot panes,
NFR-03 performance measurement, FIO-01 data-folder setting), or the Windows build (#14). When a requirement
changes status, update its row in the PRD tracker.

## State

**Phase F F1–F4 and F6 done; F5 done except Stage-2 MCP tools.** Phase E stays at 9 of 12
(`feature_list.json` has no Phase F entries). PRD tracker rows S1-02, S1-06, S1-15, S1-16 set to done this
session; NFR-04 stays partial (a cable pull during a capture is untested).

**Built 2026-10-13/14 on `feature/f6-stage1-gaps`, all verified on the board by the user:**
- `e613489` auto-reconnect: `AppState.wanted` holds the board's serial (set by connect, cleared by
  disconnect). A watcher thread in `src-tauri/src/lib.rs` calls `watch_tick` (`src-tauri/src/api/mod.rs:550`)
  every second: port gone or driver dropped marks it lost (`device.state` = `reconnecting`, `device-state`
  event); `find_serial` (`src-tauri/src/instrument/mod.rs:37`) probes every port for that serial, reconnects,
  resumes Live if it ran. Dark/reference/settings kept. UI: red pill, toasts, "Stop waiting" in Instruments.
- `b8e4034` burst: `invoke burst {count 1–1000, interval_ms 0–3 600 000, label, tag}` (`mod.rs:430`); each
  shot is `shoot()` (`mod.rs:467`), the same path as `capture`, saved as `label_001…` or `spectra_NNN`.
  Needs a workspace. Stopped by anything that bumps `acq_generation` (`stop_live`, start_live, connect).
  Event `burst-progress`. UI: toolbar **Burst…** and Acquire menu, `BurstDialog`
  (`src/components/overlays/InstrumentDialogs.tsx:443`); `9ed053f` adds a fill + `.shot-flash` ring per shot.
- `7cc400c` plot behaviour: after a capture the plot shows only that capture; after a burst, all its shots
  (`showOnPlot`, `src/store/acqStore.ts:65`). Freezing Live clears the selection, so the plot is empty.
- `8338417` the left controls card stretches to the full column height (`toolbox.css`).
- `d87cb1b` settings: integration/averaging saved to `settings.json` on every write and loaded at start
  (`Settings::load`, `mod.rs:45`). Profiles (integration, averaging, burst fields) in `profiles.json`,
  Acquire ▸ Settings profiles… (`ProfilesDialog`, `InstrumentDialogs.tsx:490`). Burst fields live in
  `acqStore.burstSettings` so profiles can carry them.
- `5d8130b` recent: `recent.json` holds last-opened time per workspace and the last 10 exports
  (`src/store/recentStore.ts`). Start reopens the last workspace; switcher sorted by last opened; File menu
  lists 5 recent workspaces and 5 recent exports (click = `cmd_reveal`, opens the folder).
- All three JSON files are in the app data folder (`~/.local/share/com.checkag.jasper/` on Linux), read and
  written by `cmd_load_store` / `cmd_save_store` (`src-tauri/src/commands/storage.rs:25`), whitelist
  `profiles`, `recent`. `settings.json` is written by the API itself.

**Half-built:**
- F5: MCP server has only `jasper_read`. Audit log has no client name. Calibration writes not privileged
  (no backend, #7); add them to `PRIVILEGED` when they exist.
- A script-started firmware upgrade or burst shows no progress in the GUI (the GUI listens only while it
  started them). Script captures are not auto-plotted.
- Slow subscribers lose frames silently (`ponytail:` in `server.rs`). Live frames to scripts are paced by
  the GUI's render gate.
- While the board is lost, every serial port is probed each second (as Rescan does).
- F2: no in-app data-folder setting. Export does not copy `.jdx` files. Dark and reference are in memory only.
- F4: x-cal still has its own Tauri command (`cmd_calibrate_xcal`, #7, #13).
- `process()` still applies a dark taken at another integration; the banner warns only.
- `eslint` does not run: `hermes-parser` fails with `Cannot find module './generated/ParserVisitorKeys'`.

**Untouched:** Analyze and Chemometrics (compiled, unreachable) and the Python sidecar.

## Uncommitted work

This handoff and the F6 line in `docs/PLAN-migration.md`, on `master`.

## Learned this session

- **`with_io` drops the driver's port on any I/O error**, so `is_connected()` turns false after a pull
  during Live; while idle only the vanished port path shows it. `watch_tick` checks both.
- **The simulator's pty never appears in `available_ports`/discovery**, so reconnect is tested by
  injecting `find` into `watch_tick`. The kernel may reuse the same `/dev/pts/N` for a new simulator.
- **Lock order:** never hold `driver` while taking `wanted` (`watch_tick` takes `wanted` then `driver`).
- **The plot hides the live trace whenever Live is off**; only selected captures draw. That is why a new
  capture looked missing until it was auto-selected.
- **`AppState::new(data_dir, …)` now reads `settings.json`**: tests share nothing because each uses a tempdir.
- **The menu has no heading style**: "Recent workspaces" / "Recent exports" are disabled items.

## Blocked / needs a human

- **Opening PRs:** the GitHub token gets 403 on create and `gh` is not installed. The user opens them.
- **A neon or mercury-argon lamp** for #7: nm axis, calibration writes and everything after.
- **The board has no light source.** S1-07 stays blocked.
- **Device-stored calibration needs a firmware decision:** data flash or EEPROM (PRD OQ-03).
- **Anything behind a click in the app needs someone at the machine** (Connect, approval dialog, cable pulls).
- **Old local branches** (`feature/migration`, `fix/28_…`, `UI_theming`, …) are still present; delete only
  if the user says so.
