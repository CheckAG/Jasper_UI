# Session handoff

Updated 2026-09-27. Refresh with `/handoff` at the end of every working session.
`PLAN.md` says what is planned; this says what happened.

## Now

Three issues left in Phase E. Two need no hardware:

- **#14 · E9** CI — `tsc -b`, eslint, `cargo test`, clippy. Nothing catches a broken build
  today; one sat on `master` unnoticed until it blocked frontend work on 2026-09-06.
- **#13 · E8** generate the x-axis from stored calibration instead of baking it into frames
  in the driver. Pairs with #7 — doing them together avoids touching the same code twice.
- **#7 · E5** port the Legendre neon calibration. **Blocked on a neon or mercury-argon lamp.**
  The fit matches detected peaks against known emission lines; a broadband source gives it
  nothing to match. This is the one that gets the x-axis into nm instead of pixel index.

`/new-branch <issue>` off `origin/master`.

## State

**Phase E is 9 of 12.** The app drives the real board end to end: discover by probing, connect,
stream, freeze, capture with averaging, tag a dark and a reference, see absorbance.

Verified repeatedly on serial `380B1C3537323731`, firmware `0.1`, most recently 2026-09-27.
Hardware tests are `#[ignore]`d:
`JASPER_PORT=/dev/ttyACM0 cargo test --test tcd1304_sim -- --ignored --nocapture`

**Every synthetic data path is gone** — the Rust mock driver, `mockDriver.ts`, the three seeded
sessions, the invented trained models, `mockPCA`/`mockRegression`. `tools/tcd1304-sim.py` stays:
it speaks the real protocol byte-for-byte and is the no-hardware path now, so **UI work without
the board needs the simulator running**, not just `npm run tauri dev`.

**Half-built:**
- X-axis calibration has no backend at all. `calibrate_xcal` returns `Err`, the Instrument
  panel's X-cal row can never reach "done", and `xs` is the pixel index. That is #7.
- `src/workspaces/chemometrics/ChemometricsWorkspace.tsx:258` still holds a hardcoded
  Maize/Wheat/Soil confusion matrix. It sits behind the disabled workspace flag; removing it
  means gutting that component's layout for a screen nobody can reach.
- `eslint` does not run at all — `hermes-parser` fails to load. Untouched, and #14 should
  decide whether to fix or drop it.

**Untouched:** Analyze and Chemometrics (hidden behind `ENABLED_WORKSPACES` in
`src/lib/features.ts`), and everything in the Python sidecar.

## Uncommitted work

`PLAN.md`, `feature_list.json` and this file — the status catch-up after PR #24. Everything
else is on `origin/master` (`e34e862`). No local branches; merged ones are deleted.

## Learned this session

- **There are two databases, and which one you get depends on how the app was launched.** From
  a snap-confined terminal (VS Code) `XDG_DATA_HOME` points inside the snap, so the app opens
  `~/snap/code/<rev>/.local/share/com.checkag.jasper/jasper.db` rather than `~/.local/share/...`.
  Seeded sessions surviving a wipe is this, not a failed delete — it cost an hour of assuming
  the frontend was broken. `AppState` now logs the path it opened at startup; read that first.
- **The same bug shape appeared five times: a control or readout asserting something it never
  checked.** The Dark/Reference chips called no calibration IPC (#11); `refState` defaulted to
  `'ok'` so a fresh install showed three green calibration lights; the top bar showed
  `session.device` beside a hardcoded `42.1 °C` and a permanently green LED; `params.averaging`
  restarted the stream and changed no data; `Space` took captures by a second route that skipped
  averaging entirely. **None were type errors or test failures**, so #14 would not have caught
  any of them. UI state that mirrors hardware has to come from a backend query, never a local
  default — that is now a convention in `CLAUDE.md`.
- **Polarity was settled, then overturned, then settled again.** An unlit probe read ~2500
  across the whole array and looked like "a dark frame near the floor, so bright must be high".
  Masked pixels cannot respond to light, so a whole-array shift between two sessions was never
  an illumination effect and said nothing about polarity. With a lamp attached the in-frame
  comparison is decisive: masked window ~29300 at every integration time, illuminated down to
  16100 at 200 ms. **Compare regions within one frame, never frames across sessions.**
- **React invokes mount effects twice in development.** `init()` created two "Default session"
  rows because `hydrated` was only set at the end and both calls saw an empty database. Guard
  on entry, not on completion.
- Do not measure device timing through a `pyserial` read loop — a `timeout=0.2` read makes
  every capture look like it took 200 ms. The Rust test measures it properly: round-trip is
  ~2x integration + ~40 ms.
- Branch from the dependency, not from `master`, when `depends_on` in `feature_list.json` names
  an unmerged issue. `cat >>` onto a missing file silently creates a stub instead of appending.

## Blocked / needs a human

- **A neon or mercury-argon lamp** for #7. Nothing else in the phase is blocked.
- **The GitHub token is read-only.** `POST /issues`, `PATCH /issues/<n>` and `POST /pulls` all
  return `403 Resource not accessible by personal access token`, and `gh` is not installed, so
  every issue and PR this session was created by hand from a prepared body. Granting the token
  `Issues: write` + `Pull requests: write`, or installing `gh`, removes a manual step each time.
- **Two database backups** sit in the session scratchpad (`jasper-backup-*.db`,
  `jasper-snap-backup-*.db`) holding the 3 seeded sessions and 52 mock-era captures that were
  cleared on 2026-09-27. All were dated 2026-06-10, before the hardware existed. The scratchpad
  is session-local — move them somewhere durable if any of it is wanted.
