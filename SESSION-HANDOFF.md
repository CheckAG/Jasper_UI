# Session handoff

Updated 2026-09-27. Refresh with `/handoff` at the end of every working session.
`PLAN.md` says what is planned; this says what happened.

## Now

**Verify the live-view fix on the board.** `80a7769` is committed but was never seen running —
the app was still compiling when the session ended. `./run.sh` with no `JASPER_PORT` (that is
the bug path: start with nothing connected), then Instrument → Connect → Acquire, and confirm
a trace appears without touching the Live button.

After that, Phase E has three issues left. Two need no hardware:

- **#14 · E9** CI — `tsc -b`, eslint, `cargo test`, clippy. Nothing catches a broken build
  today; one sat on `master` unnoticed until it blocked frontend work on 2026-09-06.
- **#13 · E8** generate the x-axis from stored calibration instead of baking it into frames
  in the driver. `depends_on: E5`.
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
- `src/workspaces/instrument/InstrumentWorkspace.tsx:36` restarts the acquisition stream after
  a dark/reference capture without checking `paused`, so calibrating from a frozen plot leaves
  the device scanning. Same shape as the bug fixed in `80a7769`. One-line guard, not done.
- `src/workspaces/chemometrics/ChemometricsWorkspace.tsx:258` still holds a hardcoded
  Maize/Wheat/Soil confusion matrix. It sits behind the disabled workspace flag; removing it
  means gutting that component's layout for a screen nobody can reach.
- `eslint` does not run at all — `hermes-parser` fails to load. Untouched, and #14 should
  decide whether to fix or drop it.

**Untouched:** Analyze and Chemometrics (hidden behind `ENABLED_WORKSPACES` in
`src/lib/features.ts`), and everything in the Python sidecar.

## Uncommitted work

Clean. Three commits sit on branch `enhancement`, **unpushed**, three ahead of `origin/master`:

- `80a7769` — the live-view fix, `src/App.tsx:71`. **Unverified on hardware.**
- `0a0c19d` — startup always opens the default session, `src/store/sessionStore.ts:60`.
- this handoff.

`enhancement` does not follow the repo's `feature/xxx_shortname` convention; it was named by
hand. Rename before opening a PR if that matters.

Three stale local branches exist that the previous handoff claimed were gone: `UI-enhancement`
(its remote is deleted), `UI_theming`, `protocol_simulation`.

## Learned this session

- **A stream start keyed on a UI flag is the sixth instance of the same bug.** `App.tsx` started
  acquisition from an effect depending on `paused` alone. `paused` is `false` at mount, so the
  effect ran once at launch with no instrument, `startAcquisition` rejected into a swallowed
  `.catch(() => {})`, and connecting a device afterwards changed no dependency — nothing ever
  re-ran it. The button read `● Live` throughout, so the first click *paused* a stream that had
  never started and the second one was what actually started it. The fix depends on the
  backend-reported serial. **Depend on `deviceMeta?.serial`, never on `deviceMeta` itself** — the
  poller in `acqStore.refreshInstrument` returns a fresh object every 2 s, and an effect keyed on
  the object restarts the stream on a timer.
- **A swallowed `.catch` turns a startup ordering bug into a silent one.** Nothing was logged at
  any layer; the only symptom was an empty canvas under a control that claimed to be running.
- **`cmd_start_acquisition` is idempotent** — `acq_generation.fetch_add` makes any previous thread
  exit on its next iteration, so re-running the start effect is safe and needs no stop first.
- The previous handoff said `PLAN.md`/`feature_list.json` were uncommitted; they had already
  landed in `d563344`, which is on `origin/master`. Trust `git status`, not the last handoff.

## Blocked / needs a human

- **A neon or mercury-argon lamp** for #7. Nothing else in the phase is blocked.
- **Confirming `80a7769` needs someone at the machine** — it is a frontend fix behind a Connect
  click in a Tauri WebKitGTK window, which no automation in this repo can drive.
- **The GitHub token is read-only.** `POST /issues`, `PATCH /issues/<n>` and `POST /pulls` all
  return `403 Resource not accessible by personal access token`, and `gh` is not installed, so
  every issue and PR is created by hand from a prepared body. Granting the token `Issues: write`
  + `Pull requests: write`, or installing `gh`, removes a manual step each time.
- **Two database backups** from 2026-09-27 sat in that session's scratchpad
  (`jasper-backup-*.db`, `jasper-snap-backup-*.db`) holding the 3 seeded sessions and 52
  mock-era captures. Scratchpads are session-local, so they are **gone** unless they were moved
  somewhere durable at the time.
