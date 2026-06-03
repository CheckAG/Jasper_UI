#!/usr/bin/env bash
#
# JASPER — desktop app launcher
# Handles the three things that commonly break `npm run tauri dev` on this machine:
#   1. a leftover dev server still holding port 5173
#   2. Rust not being on PATH in a fresh shell
#   3. the snap/GTK libpthread conflict (when run from a VS Code terminal)
#
# Usage:  ./run.sh
#
set -e

# 1. Free the dev port if a previous run is still holding it
if command -v fuser >/dev/null 2>&1; then
  fuser -k 5173/tcp >/dev/null 2>&1 || true
  sleep 1
fi

# 2. Make sure Rust/cargo is on PATH
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

# 3. Launch with the env vars this machine needs
#    GTK_EXE_PREFIX=/usr        → override the snap GTK prefix VS Code injects
#    LD_PRELOAD=.../libpthread  → force the system libpthread, not snap's
echo "Starting JASPER…  (first run compiles Rust — ~30-45s; later runs are instant)"
exec env \
  GTK_EXE_PREFIX=/usr \
  LD_PRELOAD=/lib/x86_64-linux-gnu/libpthread.so.0 \
  npm run tauri dev
