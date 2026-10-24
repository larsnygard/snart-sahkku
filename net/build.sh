#!/usr/bin/env bash
# Build the snart-sahkku-net WASM module.
# Requires: rustup with wasm32-unknown-unknown target, wasm-pack (~/.cargo/bin).
set -euo pipefail
cd "$(dirname "$0")"

# Fast typecheck (useful during iteration):
# cargo check --target wasm32-unknown-unknown --release

~/.cargo/bin/wasm-pack build --target web --release --out-dir pkg

echo "Built:"
ls -la pkg/
du -b pkg/snart_sahkku_net_bg.wasm
