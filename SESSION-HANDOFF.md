# Session handoff

Updated 2026-10-06. Refresh with `/handoff` at the end of every working session.
`PLAN.md` says what is planned; this says what happened.

## Now

**Guard the stream restart in `src/workspaces/instrument/InstrumentWorkspace.tsx:36`.** After a
dark/reference capture it calls `ipc.startAcquisition(params)` without checking `paused`. Since
`6647bdd` Live is off by default, so this is now the *normal* path, not an edge case: tag a dark
right after connecting and the device starts scanning while the button still reads `⏸ Paused`.
`App.tsx:44` drops the frames, so nothing shows — the device just runs unseen. One-line guard
(`if (key !== 'xcal' && !useAcqStore.getState().paused)`), then verify on the board.

After that, Phase E has three issues left (see `feature_list.json`): **#14 · E9** CI and
**#13 · E8** x-axis from stored calibration need no hardware; **#7 · E5** Legendre neon
calibration is blocked on a lamp. `/new-branch <issue>` off `origin/master`.

## State

**Phase E is 9 of 12.** The app drives the real board end to end: discover by probing, connect,
stream, freeze, capture with averaging, tag a dark and a reference, see absorbance.

Verified on serial `380B1C3537323731`, firmware `0.1`, most recently 2026-10-06. Hardware tests
are `#[ignore]`d: `JASPER_PORT=/dev/ttyACM0 cargo test --test tcd1304_sim -- --ignored --nocapture`

Done and verified on the board by the user, 2026-10-06:
- `80a7769` — the stream now starts when a device connects (previously unverified). Confirmed by
  observation: on first connect Live started on its own — which is what prompted the next change.
- `01809f6` — Integration Time is a number input in ms (`src/workspaces/acquire/ActionShelf.tsx:57`),
  not a slider. Commits on blur/Enter, clamped to the device's `integMinMs`–`integMaxMs`. Keyed on
  `params.integration`, so a device-side clamp written back by `App.tsx:57` re-renders the field.
- `6647bdd` — Live is off until the user turns it on. `paused` defaults to `true`
  (`src/store/acqStore.ts:52`) and `refreshInstrument` sets it back to `true` whenever the
  connected serial changes (`src/store/acqStore.ts:107`) — connect, disconnect, or replug.

**Every synthetic data path is gone.** `tools/tcd1304-sim.py` is the no-hardware path, so UI work
without the board needs the simulator running, not just `npm run tauri dev`.

**Half-built:**
- The `paused` guard above.
- X-axis calibration has no backend. `calibrate_xcal` returns `Err`, the Instrument panel's X-cal
  row can never reach "done", and `xs` is the pixel index. That is #7.
- `src/workspaces/chemometrics/ChemometricsWorkspace.tsx:258` still holds a hardcoded
  Maize/Wheat/Soil confusion matrix, behind the disabled workspace flag.
- `eslint` does not run — `hermes-parser` fails to load. #14 should fix or drop it.

**Untouched:** Analyze and Chemometrics (hidden behind `ENABLED_WORKSPACES` in
`src/lib/features.ts`), and everything in the Python sidecar.

## Uncommitted work

Clean. Branch `fix/11_live-view-start` (renamed from `enhancement`, tracks issue #11) is pushed,
six commits ahead of `origin/master`: `80a7769`, `0a0c19d`, `53549d6`, `01809f6`, `6647bdd`, and
this handoff. **No PR yet** — open it by hand (read-only token).

Stale local branches: `UI-enhancement` (remote deleted), `UI_theming`, `protocol_simulation`.

`01809f6` and `6647bdd` lack the `Claude-Session:` trailer the `/commit` skill asks for (the
session URL was not available) and say "Claude Opus 5.5" in the co-author line.

## Learned this session

- **Any control that restarts the stream must not fire per keystroke.** `App.tsx:82` re-runs
  `startAcquisition` on every `params.integration` change, so a controlled `<input type=number>`
  would send 1, 10, 100 on the way to typing 1000 — each below the device floor. Hence the
  uncontrolled input committing on blur.
- **Auto-starting Live on connect was the wrong default, not just a fixed bug.** `80a7769` made the
  stream start correctly on connect; the user then decided streaming should be opt-in. Any code
  that restarts acquisition must now respect `paused`, because "connected" no longer implies "live".
- `run.sh` exiting with code 0 and no log lines means the window was closed — there is no
  shutdown logging, so that is indistinguishable from a silent quit. Ask before assuming either.
- The GLib `GTlsClientConnectionGnutls ... invalid property id` warnings at startup are noise.

## Blocked / needs a human

- **A neon or mercury-argon lamp** for #7. Nothing else in the phase is blocked.
- **Frontend changes behind a Connect click need someone at the machine** — no automation here
  drives the Tauri WebKitGTK window.
- **The GitHub token is read-only** (`403 Resource not accessible by personal access token` on
  issues and PRs) and `gh` is not installed, so issues and PRs are created by hand.
