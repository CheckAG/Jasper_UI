# JASPER — Spectral Data Platform (CheckAg)

Desktop app for running a NIR/UV-Vis spectrometer: acquire spectra, manage
sessions, pre-process, run chemometrics, export.

## Tech stack

- **Shell**: Tauri 2 (Rust, edition 2021) — `src-tauri/`
- **UI**: React 19 + TypeScript + Vite 5 (Vite 8 crashes on this machine)
- **State**: Zustand + Immer (`src/store/`) · routing: wouter · charts: d3
- **Persistence**: SQLite via rusqlite (`src-tauri/src/storage/`) + tauri-plugin-sql
- **Compute**: Python sidecar (`python-sidecar/`), JSON-RPC over stdin/stdout,
  numpy/scipy/scikit-learn. Lazy-spawned from `src-tauri/src/commands/sidecar.rs`
- **Instrument I/O**: `serialport` (USB-CDC), driver trait in `src-tauri/src/instrument/`
- **Lint**: eslint 10 + typescript-eslint

## Layout

- `src/workspaces/` — Acquire, Instrument, Analyze, Chemometrics (the 4 screens)
- `src/components/` — `layout/` shell, `design/` primitives, `overlays/` dialogs
- `src/spectrum/` — LiveSpectrum (streaming) and StaticChart (d3 canvas)
- `src/lib/` — types, DTOs, `ipc.ts` (Tauri invoke wrappers), exporters, mockDriver
- `src-tauri/src/commands/` — instrument, storage, sidecar, export
- `src-tauri/src/instrument/` — `driver.rs` trait, `mock.rs`, `serial.rs`, `process.rs`
- `python-sidecar/jasper/` — `nodes/` pre-processing, `chemometrics/`, `jcamp.py`

## Instrument protocol

`serial.rs` speaks specbench PROTOCOL.md v1.0 over USB-CDC: ASCII commands
`\n`-terminated, replies `OK ...` / `ERR <code> <msg>`; ACQUIRE returns a
2064-byte binary frame (STX, header, 1024 x uint16 LE, CRC-16/CCITT).
`mock.rs` is the fallback driver for dev without hardware.

## Running

```bash
./run.sh      # frees port 5173, sources cargo env, sets the GTK/LD_PRELOAD vars
```
`GTK_EXE_PREFIX=/usr` and `LD_PRELOAD=/lib/x86_64-linux-gnu/libpthread.so.0` are
required — VS Code's snap otherwise injects an incompatible libpthread.

## Conventions

- Light theme only. Do not add dark mode or lab/alternate themes.
- No roles, personas, permissions, or sign-off. `Session.operator` is free-text metadata.
- Rust types in `driver.rs` are mirrored by hand in `src/lib/types.ts` — change both.
