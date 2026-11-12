// The coin's wasm is built into the factory, so no admin method can ever swap the coin code.
// Build the coin first: `cargo near build non-reproducible-wasm --manifest-path contracts/coin/Cargo.toml`.
fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let path = std::env::var("COIN_WASM").unwrap_or_else(|_| format!("{dir}/../../target/near/coin/coin.wasm"));
    println!("cargo:rustc-env=COIN_WASM_PATH={path}");
    println!("cargo:rerun-if-changed={path}");
    println!("cargo:rerun-if-env-changed=COIN_WASM");
}
