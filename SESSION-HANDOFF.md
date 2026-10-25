# Session handoff

Updated 2026-10-25. Refresh with `/handoff` at the end of every working session.
`docs/PLAN-migration.md` says what is planned for Phase F. The **PRD tracker** shows every requirement's
status: https://claude.ai/artifact/DhQJxj99bYngZ8g4FPYtZq. This file says what happened.

## Now

**`feature/43_mcp-stage2-tools` is pushed** (`3ee53c7`, issue #43, closes on merge). The user opens the
PR (token cannot); PR text was drafted in the 2026-10-25 session. After the merge, start the next work on
a new branch from `master` (`/new-branch`). Candidates, ask the user which: S1-08 axis lock, S1-13 two
plot panes, NFR-03 performance measurement, FIO-01 data-folder setting, the Windows build (#14). When a
requirement changes status, update its row in the PRD tracker.

## State

**Phase F F1–F6 done** (F5 Stage-2 MCP tools on the open branch). Phase E stays at 9 of 12.
`feature_list.json` has no entries for Phase F or the UI work, so no status changed there.
PRD tracker: **MHS-05 set to done 2026-10-25**.

**Built 2026-10-25 on `feature/43_mcp-stage2-tools`, verified on the board:**
- `clients/python/jasper/mcp.py`: tools `jasper_write` (`WRITABLE`, `mcp.py:29`: integration time,
  averages) and `jasper_invoke` (`COMMANDS`, `mcp.py:32`: capture, burst, start/stop_live,
  capture/clear dark and reference). Both go through `call_tool` (`mcp.py:86`) as caller `agent`.
  `summarise` (`mcp.py:99`) drops a frame's `xs`/`ys` and adds `points` and `max`. Invoke has no
  timeout (long averages, bursts). Not offered: connect, disconnect, `workspace.active` (agent cannot
  list workspaces), `update_firmware`, `confirm`. Server version 0.2.
- `reference.yaml` usage notes describe the tools; `python3 clients/python/test_mcp.py` covers write, the
  `LIMIT_EXCEEDED` error, a capture summary and a refused command.
- On the board: 50 ms × 10 averages, label `MCP_spectra` → `MCP_spectra_001` in workspace `session3`
  (`~/JASPER/session3/mcp_spectra_001_20261025-160211.jdx`), peak 19.7%. Averages 500 refused with 1–64.
  The run used the new code over stdio, **not** through Claude Code's MCP connection, which still had
  the old server loaded (needs `/mcp` reconnect).

**On `master` since the last handoff, not reviewed in this session:** `a1d956e` (hardware-inverted video
taken as-is, only the 3648 effective pixels returned; a capture now reports `points: 3648`, while
`device.info.pixels` still says 3694) and `a2db449` (Y autoscale toggle pinned to full scale).

**Earlier (PR #42, 2026-10-14, verified by the user):** Captures panel cards and burst grouping
(`src/workspaces/acquire/CaptureContextPanel.tsx:14`); names numbered per workspace by
`next_label_number` (`src-tauri/src/storage/db.rs:184`), so `label: "Leaf A"` saves `Leaf A_001`;
Geist fonts and `--text-*` tokens; density Lab/Standard/Comfort.

**Half-built:**
- Density does not reach: column widths (288/300 px, user declined widening), icon sizes, plot paddings
  (`X_PAD` etc. in `src/spectrum/LiveSpectrum.tsx:62`), most dialog paddings, Analyze/Chemometrics controls.
- MCP: no event tools (an agent cannot watch capture or burst progress); the audit log has no client name.
  Calibration writes not privileged (no backend, #7).
- A script- or agent-started firmware upgrade or burst shows no progress in the GUI. Script captures are
  not auto-plotted.
- Slow subscribers lose frames silently (`ponytail:` in `server.rs`).
- F2: no in-app data-folder setting. Export does not copy `.jdx` files. Dark and reference are memory only.
- F4: x-cal still has its own Tauri command (`cmd_calibrate_xcal`, #7, #13).
- `process()` still applies a dark taken at another integration; the banner warns only.
- Saved capture `params` say `x_unit: "nm"` although there is no wavelength calibration (seen
  2026-10-25, not investigated).
- The menu has no heading style: "Recent workspaces" / "Recent exports" are disabled items.

**Untouched:** Analyze and Chemometrics (compiled, unreachable) and the Python sidecar.

## Uncommitted work

This handoff only, on `feature/43_mcp-stage2-tools`.

## Learned this session

- **`docs/` is gitignored, but `docs/PLAN-migration.md` is tracked.** `git add docs/PLAN-migration.md`
  fails and aborts the whole `git add`; use `git add -u docs/PLAN-migration.md`.
- **`git checkout -b X origin/master` sets the upstream to `origin/master`.** Run
  `git branch --unset-upstream` before the first push, or push with `-u origin X`.
- **The GitHub token also gets 403 on issue create**, not only on PRs. Draft the issue text for the user.
- **Claude Code keeps the MCP server process it started.** Code changes to `jasper/mcp.py` reach it only
  after `/mcp` reconnect; test new tools by piping JSON-RPC into `python3 -m jasper.mcp`.
- **`(jasper): Gdk-CRITICAL … gdk_x11_window_get_xid` on every start is harmless** (Wayland session).
- **`eslint` does not run:** `hermes-parser` fails with `Cannot find module './generated/ParserVisitorKeys'`.
  `rm -rf node_modules && npm i` likely fixes it; not tried.
- **No Claude trailers in commits, PRs or issues, ever** (user, 2026-10-14). `~/.claude/settings.json`
  sets `"attribution": {"commit": "", "pr": ""}`.

## Blocked / needs a human

- **Opening PRs and issues:** the GitHub token gets 403 on create and `gh` is not installed. The user opens them.
- **A neon or mercury-argon lamp** for #7: nm axis, calibration writes and everything after.
- **The board has no light source.** S1-07 stays blocked.
- **Device-stored calibration needs a firmware decision:** data flash or EEPROM (PRD OQ-03).
- **Anything behind a click in the app needs someone at the machine** (Connect, approval dialog, cable pulls,
  opening a workspace before an agent captures).
- **Old local branches** (`feature/migration`, `fix/28_…`, `UI_theming`, …) are still present; delete only
  if the user says so.
