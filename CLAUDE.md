# JASPER — Spectral Data Platform (CheckAg)

Desktop app for running a NIR/UV-Vis spectrometer: acquire spectra, manage
sessions, pre-process, run chemometrics, export.

## Tech stack

- **Shell**: Tauri 2 (Rust, edition 2021) — `src-tauri/`
- **UI**: React 19 + TypeScript + Vite 5 (Vite 8 crashes on this machine)
- **State**: Zustand + Immer (`src/store/`) · routing: wouter · charts: d3
- **Persistence**: SQLite via rusqlite (`src-tauri/src/storage/`) + tauri-plugin-sql
- **Compute**: Python sidecar (`python-sidecar/`), JSON-RPC over stdin/stdout, numpy/scipy/
  scikit-learn, lazy-spawned from `src-tauri/src/commands/sidecar.rs`
- **Instrument I/O**: `serialport` (USB-CDC) · **Lint**: eslint 10 + typescript-eslint

## Layout

- `src/workspaces/` — Acquire, Instrument, Analyze, Chemometrics (the 4 screens)
- `src/components/` — `layout/` shell, `design/` primitives, `overlays/` dialogs
- `src/spectrum/` — LiveSpectrum (streaming), StaticChart (d3 canvas)
- `src/lib/` — types, DTOs, `ipc.ts` (Tauri invoke wrappers), exporters
- `src-tauri/src/commands/` — instrument, storage, sidecar, export
- `src-tauri/src/instrument/` — `driver.rs` trait, `tcd1304/`, `mock.rs`, `process.rs`
- `python-sidecar/jasper/` — `nodes/` pre-processing, `chemometrics/`, `jcamp.py`

## Instrument protocol

`tcd1304/` speaks protocol v1 over USB CDC-ACM: ASCII commands (`?`/`M`/`I<ms>`/`A`/`X`);
replies are magic `TC` + 16-byte header + payload + CRC-16/CCITT-FALSE, spectra 3694
signed i16. `TCD1304_Timer_ADC/PROTOCOL.md` is canonical. `JASPER_PORT` picks a real port
or the `tools/tcd1304-sim.py` pty; unset falls back to `mock.rs`.

## Running

`./run.sh` — frees port 5173, sources cargo env, sets `GTK_EXE_PREFIX=/usr` and
`LD_PRELOAD=/lib/x86_64-linux-gnu/libpthread.so.0`. Both are required: VS Code's
snap otherwise injects an incompatible libpthread.

## Agent harness

- `SESSION-HANDOFF.md` — read this first. What the last session did, what is half-built, what is blocked.
- `PLAN.md` — current phase. `docs/PLAN-archive-phases-A-D.md` — shipped phases, still-binding contracts.
- `feature_list.json` — the work items, with files, notes, dependencies and acceptance criteria.
- `.claude/skills/` — `/commit`, `/new-branch`, `/handoff` carry this repo's conventions.

## Conventions

- Light theme only. Do not add dark mode or lab/alternate themes.
- No roles, personas, permissions, or sign-off. `Session.operator` is free-text metadata.
- Rust types in `driver.rs` are mirrored by hand in `src/lib/types.ts` — change both.
