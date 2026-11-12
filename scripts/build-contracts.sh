#!/usr/bin/env bash
# Build the four contracts to target/near/<name>/<name>.wasm.
# Same flags cargo-near uses (strip + --cfg near); the coin must be built before the factory embeds it.
set -euo pipefail
cd "$(dirname "$0")/.."
export RUSTFLAGS='-C link-arg=-s --cfg near'
cargo build --target wasm32-unknown-unknown --release -p coin -p mock-intents -p mock-swapper
# Optional size pass (what cargo-near runs). Uses wasm-opt from PATH, or the binaryen npm package via npx.
opt() {
  local flags="-Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals"
  if command -v wasm-opt >/dev/null; then wasm-opt $flags "$1" -o "$1"
  elif [ "${WASM_OPT_NPX:-1}" = 1 ]; then npx -y -p binaryen@132.0.0 wasm-opt $flags "$1" -o "$1" >/dev/null 2>&1 || true
  fi
}
for n in coin mock_intents mock_swapper; do
  mkdir -p target/near/$n && cp target/wasm32-unknown-unknown/release/$n.wasm target/near/$n/$n.wasm && opt target/near/$n/$n.wasm
done
cargo build --target wasm32-unknown-unknown --release -p factory
mkdir -p target/near/factory && cp target/wasm32-unknown-unknown/release/factory.wasm target/near/factory/factory.wasm && opt target/near/factory/factory.wasm
ls -l target/near/*/*.wasm
