//! `cargo run -p sim --release` writes `web/public/sim.json` and `docs/simulation.md`.
//! `cargo run -p sim --release -- --check` exits non-zero if either differs from a fresh run.

use sim::report::{generate, stale, write, SEEDS};
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let check = std::env::args().skip(1).any(|a| a == "--check");
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("sim/ sits in the repo root");
    let out = match generate(SEEDS) {
        Ok(out) => out,
        Err(e) => {
            eprintln!("sim: {e}");
            return ExitCode::FAILURE;
        }
    };
    if check {
        let drift = stale(root, &out);
        if drift.is_empty() {
            println!("sim: outputs match a fresh run");
            return ExitCode::SUCCESS;
        }
        for path in drift {
            eprintln!("sim: {path} differs from a fresh run; run `cargo run -p sim --release`");
        }
        return ExitCode::FAILURE;
    }
    if let Err(e) = write(root, &out) {
        eprintln!("sim: writing outputs: {e}");
        return ExitCode::FAILURE;
    }
    println!("sim: wrote {} and {}", sim::report::JSON_PATH, sim::report::MD_PATH);
    ExitCode::SUCCESS
}
