# Session handoff

Updated 2026-10-13. Refresh with `/handoff` at the end of every working session.
`docs/PLAN-migration.md` says what is planned for Phase F. The **PRD tracker** shows every requirement's
status: https://claude.ai/artifact/DhQJxj99bYngZ8g4FPYtZq. This file says what happened.

## Now

**Phase F up to `e4f60c9` is merged to `master`** (PR #39, 2026-10-13). Start the next work on a new branch
from `master` (`/new-branch`): F5's Stage-2 MCP tools (`jasper_capture` etc.), then the rest of F6 (settings
profiles, recent workspaces, burst capture, auto-reconnect). Ask the user which first. When a requirement
changes status, update its row in the PRD tracker.

## State

**Phase F is merged to `master` (PR #39).** F1–F4 done; F5 done except Stage-2 MCP
tools; F6 part done. Phase E stays at 9 of 12 (`feature_list.json` has no Phase F entries, so nothing there
changed). The PRD tracker counts 19 done, 20 in progress, 24 not started, 11 blocked, 5 open questions, 1 deferred.

**Built 2026-10-13, all verified on the board by the user** (serial `380B1C3537323731`):
- `342faa3` `subscribe`: a client sends `{"method":"subscribe","params":{"events":[..]}}` and gets JSON-RPC
  notifications (no `id`) between replies. Empty list stops them. Allowed events:
  `src-tauri/src/api/server.rs:36`. Each connection has one writer thread and an 8-line queue
  (`server.rs:40`); a full queue drops the event, never blocks the live loop. `Events for AppHandle`
  (`src-tauri/src/api/mod.rs`) publishes every emit to the hub in `AppState.subscribers`, so a GUI-started
  stream reaches scripts. Python: `Client.subscribe()` / `Client.events()`; CLI `python -m jasper watch <events>`.
- `1240853` confirmation flow (PRD MHS-07, S4-17 half): `PRIVILEGED` (`mod.rs:52`) holds `update_firmware`.
  From any caller but the GUI, `confirmed()` (`mod.rs:146`) emits `confirm-request`, blocks up to 120 s, and
  returns `DENIED` (4030) or `CONFIRM_TIMEOUT` (4031). `confirm` (`mod.rs:309`) answers it and is GUI-only
  (`GUI_ONLY` 4032). Dialog: `src/components/overlays/ConfirmRequests.tsx`, mounted in `src/App.tsx`.
  Firmware upgrade moved into the API (`mod.rs:286`, args `srec` or `path`, `device_id` defaults to the
  connected board); `cmd_update_firmware` is gone. The audit log shows a firmware image as `<N bytes>`.
- `e4f60c9`: MCP `jasper_read` refuses a call without `names` instead of returning `{}`.
- Checks owed from 2026-10-12, now done on the board: dark/reference warnings at 15% / 98% of full scale
  (`4cece85`), and the MCP server reading `device.info` from the running app (`1fc7dfb`).

**Half-built:**
- F5: MCP server has only `jasper_read`. The audit log has no client name. Calibration writes are not privileged
  yet because they have no backend (#7); add them to `PRIVILEGED` when they do.
- A script-started firmware upgrade shows no progress in the GUI's firmware panel (scripts can subscribe to
  `firmware-progress`).
- Slow subscribers lose frames silently: no gap counter (`ponytail:` comment in `server.rs`).
- Live frames to scripts are paced by the GUI's render gate (`cmd_frame_consumed`, 1 s fallback).
- F2: no in-app data-folder setting (`~/JASPER` or `JASPER_DATA_DIR`). Export does not copy `.jdx` files.
  Dark and reference are in memory only, lost on restart, no timestamp.
- F4: x-cal still has its own Tauri command (`cmd_calibrate_xcal` returns `Err`, so `xs` is the pixel index, #7, #13).
- `process()` still applies a dark taken at a different integration. The banner warns; the maths does not refuse.
- `eslint` does not run: `hermes-parser` fails with `Cannot find module './generated/ParserVisitorKeys'`.

**Untouched:** Analyze and Chemometrics (compiled, unreachable) and the Python sidecar. The sidecar's
`write_jcamp_multi` (`python-sidecar/jasper/jcamp.py:52`) omits `##BLOCK_ID`; it is unused.

## Uncommitted work

Clean once this handoff and the `docs/PLAN-migration.md` F5 note are committed.

## Learned this session

- **Events go out through two `Events` objects** (`cmd_api` builds one per call, `lib.rs` one for the socket).
  Fan-out to socket clients therefore lives in `impl Events for AppHandle`, which reaches `AppState` via
  `try_state`. Wrapping either object alone would miss streams started by the other.
- **A subscriber's writer thread only exits when every sender is dropped**, and the hub holds one. The reader
  removes its hub entry on disconnect (`hub.set(id, vec![], tx)`) or the writer leaks.
- **The firmware install parses the S-record before touching the port**, so a garbage image fails fast. The
  confirmation test relies on that; a header-only image made it wait ~15 s on the port instead.
- **`git add docs/PLAN-migration.md` stages the file but exits 1** with the "ignored by .gitignore" hint,
  because `docs/` is ignored even though the file is tracked. It breaks `git add ... && git commit` chains.
  Use `git add -f`.
- **`jasper_read` takes `names` (a list), not `name`.** Easy to get wrong by hand.
- **The PRD tracker rows are `items/<ID>` in the page's database**, fields `status` (`done`/`partial`/`todo`/
  `blocked`/`deferred`/`question`), `notes`, `blockers`, `deps`. Write with `ArtifactData` and `if_version`.

## Blocked / needs a human

- **Opening PRs:** the GitHub token gets `403 Resource not accessible by personal access token` on create, and
  `gh` is not installed. Needs Pull requests: write on `CheckAG/Jasper_UI`, or the user opens them.
- **A neon or mercury-argon lamp** for #7. It blocks the nm axis, calibration writes and everything after.
- **The board has no light source.** S1-07 stays blocked.
- **Device-stored calibration needs a firmware decision:** data flash or EEPROM (PRD OQ-03).
- **Anything behind a click in the app needs someone at the machine** (Connect, the approval dialog).
- **Sharing the PRD tracker** is done from its Share menu. People need Contributor access to edit statuses.
