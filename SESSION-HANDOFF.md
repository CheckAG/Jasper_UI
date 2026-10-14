# Session handoff

Updated 2026-10-14. Refresh with `/handoff` at the end of every working session.
`docs/PLAN-migration.md` says what is planned for Phase F. The **PRD tracker** shows every requirement's
status: https://claude.ai/artifact/DhQJxj99bYngZ8g4FPYtZq. This file says what happened.

## Now

**`UI_improvements` is merged to `master`** (PR #42, `76baf24`, 2026-10-14; remote branch deleted, local
deleted). Nothing is in flight. Start the next work on a new branch from `master` (`/new-branch`).
Candidates, ask the user which: F5 Stage-2 MCP tools (PRD MHS-05), S1-08 axis lock, S1-13 two plot
panes, NFR-03 performance measurement, FIO-01 data-folder setting, the Windows build (#14). When a
requirement changes status, update its row in the PRD tracker.

## State

**Phase F F1–F4 and F6 done (F6 merged as PR #40); F5 done except Stage-2 MCP tools.** Phase E stays
at 9 of 12. `feature_list.json` has no entries for Phase F or the UI work, so no status changed.
PRD tracker: no status changed by the UI work; notes on S1-06, S1-12, NFR-05, APP-01 updated 2026-10-14.

**Built 2026-10-14 on `UI_improvements` (merged as PR #42), all verified on the board by the user:**
- `e65ce9e` Captures panel redesign (design canvas: https://claude.ai/artifact/9ip4iiLEsR7rnephnmZFKG,
  option "A cards + B grouping"): spectrum cards with a sparkline, search, "N on the plot · Clear", burst
  shots folded into one group with Show all / Hide all. No eye button (user removed it). Grouping in
  `burstKeys` (`src/workspaces/acquire/CaptureContextPanel.tsx:14`): new ids `burst-<startms>-<NNN>`
  share a stem; old `cap-<ms>-<n>` ids are grouped by consecutive n. Keys come from the full list, so a
  search cannot split a group. The backend now gives every shot of one burst the same stem.
- `17f37b8` the toolbar's Export… button removed; the Captures panel's Export stays (both opened the
  same dialog).
- `862584f` capture name stays after a capture; only the Tag clears (`src/store/acqStore.ts:158`). Every
  name is numbered per workspace by `next_label_number` (`src-tauri/src/storage/db.rs:184`), called
  in `save_capture` (`src-tauri/src/api/mod.rs:491`): `Leaf A_001`, `Leaf A_002`, else `spectra_NNN`.
  A burst passes its base name and gets the same numbering, so a second `leaf` burst continues at
  `leaf_004`. **Behaviour change for scripts:** `label: "Leaf A"` now saves `Leaf A_001`.
- `83dd68b` fonts: Geist + Geist Mono (400/500/600) bundled via `@fontsource` in `src/main.tsx`; the
  Google Fonts link and Instrument Serif are gone. Global `button, input, select, textarea
  { font: inherit; }` in `tokens.css`, so per-component `fontFamily: var(--font-sans)` was removed.
  Every font size is a token: `--text-xs/sm/md/base/lg/xl/display` = 10/11/12/13/16/20/40 px
  × `--text-scale`. The canvas reads font names and scale from the tokens (a canvas cannot parse `var()`).
- `7c35739` density: Lab / Standard / Comfort set `--text-scale` 0.85/1/1.15, `--row-h` 28/32/40,
  `--row-h-sm` 24/28/34, `--pad` 10/14/20, `--gap` 6/10/16. Buttons, chips, menu bar and items, status
  bar, Captures panel controls, plot zoom buttons, dialogs and panel padding use them. LiveSpectrum and
  StaticChart redraw on a density change.

**Half-built:**
- Density does not reach: column widths (288/300 px, user declined widening), icon sizes, plot paddings
  (`X_PAD` etc. in `src/spectrum/LiveSpectrum.tsx:62`), most dialog paddings, Analyze/Chemometrics controls.
- F5: MCP server has only `jasper_read`. Audit log has no client name. Calibration writes not privileged
  (no backend, #7).
- A script-started firmware upgrade or burst shows no progress in the GUI. Script captures are not
  auto-plotted.
- Slow subscribers lose frames silently (`ponytail:` in `server.rs`).
- F2: no in-app data-folder setting. Export does not copy `.jdx` files. Dark and reference are memory only.
- F4: x-cal still has its own Tauri command (`cmd_calibrate_xcal`, #7, #13).
- `process()` still applies a dark taken at another integration; the banner warns only.
- The menu has no heading style: "Recent workspaces" / "Recent exports" are disabled items.

**Untouched:** Analyze and Chemometrics (compiled, unreachable) and the Python sidecar.

## Uncommitted work

This handoff only, on `master`.

## Learned this session

- **Old shots in the database have `cap-<ms>-<n>` ids**, not `burst-…`; grouping that read only the new
  format showed nothing on existing workspaces.
- **The user assumed custom names were already numbered.** They were not (only bursts and `spectra_NNN`
  were); keeping the name without numbering would have saved duplicates. Check the backend before
  agreeing to a premise.
- **`ctx.font = '13px var(--font-sans)'` is silently ignored** — the canvas falls back to 10px sans-serif.
- **The old `--font-body`/`--font-small` density tokens were used by nothing**, so density looked inert.
- **`(jasper): Gdk-CRITICAL … gdk_x11_window_get_xid` on every start is harmless**: the session is Wayland
  and tao asks for an X11 id. `GDK_BACKEND=x11` silences it; the user chose to ignore it.
- **`eslint` does not run:** `hermes-parser` fails with `Cannot find module './generated/ParserVisitorKeys'`
  (install dated 2026-06, not from this session). `rm -rf node_modules && npm i` likely fixes it; not tried.

- **No Claude trailers in commits or PRs, ever** (user, 2026-10-14): no `Co-Authored-By: Claude …`, no
  `Claude-Session:`, no "Generated with Claude Code" footer, including PR text drafted for the user.
  Removed from `.claude/skills/commit/SKILL.md:40`; `~/.claude/settings.json` sets
  `"attribution": {"commit": "", "pr": ""}`. Commits before this date still carry the co-author line.

## Blocked / needs a human

- **Opening PRs:** the GitHub token gets 403 on create and `gh` is not installed. The user opens them.
- **A neon or mercury-argon lamp** for #7: nm axis, calibration writes and everything after.
- **The board has no light source.** S1-07 stays blocked.
- **Device-stored calibration needs a firmware decision:** data flash or EEPROM (PRD OQ-03).
- **Anything behind a click in the app needs someone at the machine** (Connect, approval dialog, cable pulls).
- **Old local branches** (`feature/migration`, `fix/28_…`, `UI_theming`, …) are still present; delete only
  if the user says so.
