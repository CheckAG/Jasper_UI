# Session handoff

Updated 2026-09-06. Refresh with `/handoff` at the end of every working session.
`PLAN.md` says what is planned; this says what happened.

## Now

Three issues are unblocked and independent of each other — take any:

- **#5 · E3** probe-based discovery + real connect/disconnect (P1)
- **#6 · E4** honest params + the backpressure gate (P1)
- **#9 · E7a** replace the fake telemetry tiles (P1) — mostly frontend now, because
  `Tcd1304Driver::device_metadata()` already returns everything the panel needs

**#2 · E1** (hide Analyze/Chemometrics) touches nothing else and can go any time.
**#7 · E5** (the calibration port) is the big one and wants the axis work in **#13 · E8**
thought about alongside it.

`/new-branch <issue>` off `origin/master`.

## State

**Phase E, done and merged:** #3 frame codec, #8 pty simulator, #4 the driver.
`serial.rs` is gone. `JASPER_PORT` selects `Tcd1304Driver`; unset falls back to `mock.rs`.

**Verified on real hardware** (2026-09-06, serial `380B1C3537323731`, firmware `0.1`):
handshake, metadata, integration clamping, and captures at 8/25/100 ms. Round-trip is
about 2x integration plus ~40 ms, matching the firmware's discard-one-frame behaviour.
Run it with `JASPER_PORT=/dev/ttyACM0 cargo test --test tcd1304_sim -- --ignored --nocapture`
(`#[ignore]`d so `cargo test` stays green without a board).

**Still fake, despite appearances** — the UI has not caught up with the driver yet:
`ipc.getDiagnostics` is a hardcoded 4-entry array (`ipc.ts:104`); `ipc.connectDevice` is
never called, so Connect only sets local React state (`InstrumentWorkspace.tsx:193`); the
Acquire dark/reference chips toggle `refState` without calling any calibration IPC
(`ModeStrip.tsx:45`); `light_on` / `light_power` cross the IPC boundary and no driver reads
them. The telemetry tiles no longer show fabricated zeros — `telemetry()` now returns an
error — so **the Instrument panel will surface that error until #9 lands.**

**Untouched:** E1, E3, E4, E5, E7a/b/c, E8, E9.

## Uncommitted work

Clean. The doc catch-up after #4 merged is committed on `master` (`8f8fbb0`), not yet pushed.

## Learned this session

- **Polarity is settled: the video IS inverted, and the host applies `max_intensity - raw`.**
  With a light source attached, comparing the masked `DARK` window against the illuminated
  `ACTIVE` window *within a single frame*: masked pixels stay pinned near 29300 at every
  integration time, while illuminated pixels read 28099 / 20866 / 16100 at 8 / 50 / 200 ms.
  Light pulls the value down.
  **This overturned an earlier call in the same session.** An unlit probe had read ~2500 across
  the whole array and I took that as "bright is high". Masked pixels cannot respond to
  illumination, so a whole-array shift was never an illumination effect — something in the
  detector's power or clocking state differed between sessions, and the unlit number said
  nothing about polarity. Compare regions within one frame, never frames across sessions.
- **`DARK=16:28` is confirmed real.** The same measurement: the masked window holds the dark
  level while `ACTIVE` responds to light. That is exactly the check the hardware repo asked for.
- **A pty must be set raw at both ends.** In cooked mode `ONLCR` rewrites every `0x0A` as
  `CR LF`, and `integ_ms = 10` puts a `0x0A` in the header of most replies — frames arrive
  one byte long and the reader desyncs. Cost an hour.
- **Do not measure device timing through a `pyserial` read loop.** A `timeout=0.2` read makes
  every capture look like it took 200 ms. The Rust test measures it properly.
- **Branch from the dependency, not from `master`.** #4 was cut from `master` while #8 was
  still unmerged, so the simulator was absent and `cat >>` silently created a stub test file
  instead of appending to one. Check `depends_on` in `feature_list.json` before branching.
- The GitHub MCP token is read-only: `POST`/`PATCH` on issues and PRs return
  `403 Resource not accessible by personal access token`. Branches get pushed from here;
  PRs are opened by hand.

## Blocked / needs a human

- **PRs are opened by hand** (no `gh`, read-only token). Push happens from here.
- **A neon or mercury-argon lamp** will be needed for #7 — the calibration fit has nothing to
  match against without known emission lines.
