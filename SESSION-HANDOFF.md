# Session handoff

Updated 2026-10-12. Refresh with `/handoff` at the end of every working session.
`docs/PLAN-migration.md` says what is planned for Phase F. The **PRD tracker** shows every requirement's
status: https://claude.ai/artifact/DhQJxj99bYngZ8g4FPYtZq. This file says what happened.

## Now

**Finish F5 on `feature/migration`.** Two parts are left. One is `subscribe`, so live spectra reach socket
clients. The other is the human-confirmation flow for privileged actions (PRD MHS-07 / S4-17); firmware
upgrade is the first user. Ask the user which comes first. Also try the MCP server with the real app once
(`claude mcp add jasper -- env PYTHONPATH=<repo>/clients/python python3 -m jasper.mcp`). After F5: the rest
of F6 (settings profiles, recent workspaces, burst capture, auto-reconnect). When a requirement changes
status, update its row in the PRD tracker.

## State

**Phase F (Toolbox design adoption) is on `feature/migration`, pushed and level with origin.** F1–F4 are
done. F5 and F6 are part done. Phase E stays at 9 of 12 (`feature_list.json` has no Phase F entries). The PRD
tracker counts 17 done, 20 in progress, 26 not started, 11 blocked, 5 open questions and 1 deferred.

**Verified on the board by the user, 2026-10-12** (serial `380B1C3537323731`):
- F1–F4 (`86f439f`, `25f5009`, `9c15e29`, `dd52567`).
- `e1a3dcf`: Live is the first toolbar button, on key **L**. Capture stays in the left column; the user
  tried it in the toolbar and asked for it back.
- `148d9c4` (F6): the saturation banner at ≥98% of the device's full scale (`SATURATION_WARN`,
  `src/components/layout/StatusBar.tsx:8`). The stale-dark banner shows for 5 s each time the dark goes
  stale. The status bar shows fps and a peak meter.
- `2fc88ca`: each capture's `.jdx` is a JCAMP-DX compound file. Block 1 is the processed spectrum, then
  the raw sample, dark and reference.
- `1547b35` + `f2d764b` (F5): plain TCP JSON lines on `127.0.0.1:8765` (`src-tauri/src/api/server.rs`), the
  Python client and CLI (`clients/python/jasper`, `python -m jasper`). A script's capture appears in the
  Captures panel through the `capture-saved` event.
- `e6d1865`: captures are named `spectra_NNN` per workspace, or from the Name field (`ActionShelf.tsx`). The
  `.jdx` file takes the capture's name.

**Committed, not run on the board:**
- `4cece85`: `src-tauri/src/instrument/mod.rs` is the only code outside a driver that names a sensor. Its
  header lists the steps for adding one. The dark warning now fires at 15% of full scale and the reference
  warning at 98%. The old reference threshold of 55 000 counts could never fire on a TCD1304.
- `1fc7dfb`: the read-only MCP server (`clients/python/jasper/mcp.py`). It has the `jasper_read` tool and
  serves `jasper://reference` (`reference.yaml` plus the live `device.info`). Its self-check passes against a
  stand-in app: `python3 clients/python/test_mcp.py`.

**Half-built:**
- F5: there is no `subscribe` and no confirmation flow. The MCP server has only `jasper_read`; Stage-2 tools
  such as `jasper_capture` are not built. The audit log has no client name.
- F2: the data folder has no in-app setting (`~/JASPER` or `JASPER_DATA_DIR`). Export does not copy `.jdx`
  files. Dark and reference live in memory only, so they are lost on restart, and carry no timestamp.
- F4: firmware update and x-cal still have their own Tauri commands, outside the API.
- `process()` still applies a dark taken at a different integration. The banner warns, but the maths does not refuse.
- X-axis calibration has no backend (`calibrate_xcal` returns `Err`), so `xs` is the pixel index (#7, #13).
- `eslint` does not run: `hermes-parser` fails with `Cannot find module './generated/ParserVisitorKeys'`.

**Untouched:** Analyze and Chemometrics, which are compiled but unreachable, and the Python sidecar.
The sidecar's `write_jcamp_multi` (`python-sidecar/jasper/jcamp.py:52`) omits `##BLOCK_ID`. It is unused.

## Uncommitted work

Clean. `feature/migration` is pushed. No PR to `master` yet.

## Learned this session

- **Saturation is measured against the device's `max_intensity` (32 767), not 65 535.** The video is inverted
  (`to_intensity = max_intensity - raw`). Every threshold is a fraction of full scale.
- **Compare a dark with the requested integration, not the applied one.** The device applies a slightly
  different value, so the first stale check never cleared. `CalFrame.requested_ms` fixes that.
- **The user chose plain TCP over WebSocket for F5,** so neither side needs a new dependency. An outside
  client is never treated as `gui`: out-of-range values get `LIMIT_EXCEEDED` instead of a clamp.
- **Nothing documents whether SpectraGryph reads JCAMP compound files.** The user tried it and it works.
- **Restart the app after changing a Zustand store's shape.** Vite hot reload kept the old `acqStore`
  without `captureName`. Capture then failed in the app, before it reached the API, so there was no audit entry.
- **`docs/` is gitignored, but `docs/PLAN-migration.md` is tracked.** A new file under `docs/` needs
  `git add -f`. The `/commit` skill says otherwise and is wrong.
- **The PRD tracker gets its data from the page's database, not its HTML.** Change rows in the page, or with
  `ArtifactData` on the URL above. Republishing the page does not reset them.

## Blocked / needs a human

- **A neon or mercury-argon lamp** for #7. It blocks the nm axis and everything that depends on it.
- **The board has no light source.** S1-07 stays blocked.
- **Device-stored calibration needs a firmware decision:** data flash or EEPROM (PRD OQ-03).
- **Anything behind a Connect click needs someone at the machine.** Nothing here drives the Tauri window.
- **The GitHub token is read-only** and `gh` is not installed, so PRs are opened by hand.
- **Sharing the PRD tracker** is done from its Share menu. People need Contributor access to edit statuses.
