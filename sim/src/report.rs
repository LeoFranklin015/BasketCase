//! Percentile bands across seeds, `web/public/sim.json`, writing both outputs, and the drift check.
//! The prose of `docs/simulation.md` lives in `doc.rs`.
//!
//! Bands are taken per metric per day across seeds (so a median line is not one seed's path):
//! p10 and p90 by nearest rank, the median as the mean of the two middle values when the count
//! is even. All of it on integers; floats appear only in the written files, rounded to 6
//! significant digits through Rust's exact decimal formatting so the bytes are portable.

use crate::coin::{mul_div, Mode, Result};
use crate::params::Params;
use crate::scenario::{
    run, DaySnap, Run, Scenario, ARB_CHUNK_BPS, ARB_MAX_ROUNDS, BASKET_DAILY_VOL_PPM,
    CHALLENGE_BUDGET_BPS, CHALLENGE_MARGIN_PCT, CHALLENGE_PARTS, DAYS,
    DEFEND_DELAY_HOURS, DEFEND_PPM, DEFEND_SIZE_PCT, EPOCH_BURN_CAP_BPS, RETAIL_SIZES_BU,
    SEAT_WEIGHT_BPS, SOLVER_CUT_BPS, TAKE_PROFIT_PCT, TAKE_PROFIT_PPM, WHALE_DUMP_HOURS,
};
use curve_math::{BPS, E18};
use serde::Serialize;
use std::fmt::Write as _;
use std::path::Path;

pub const JSON_PATH: &str = "web/public/sim.json";
pub const MD_PATH: &str = "docs/simulation.md";
pub const SEEDS: u64 = 20;

pub struct Outputs {
    pub json: String,
    pub markdown: String,
}

/// Six significant digits, via exact decimal formatting (portable, unlike libm).
fn sig6(x: f64) -> f64 {
    format!("{x:.5e}").parse().expect("formatted float parses")
}

pub(crate) fn whole_units(raw: u128) -> f64 {
    sig6(raw as f64 / E18 as f64)
}

fn count(n: u128) -> f64 {
    n as f64
}

/// Basis points to percent.
fn pct(bps: u128) -> f64 {
    sig6(bps as f64 / 100.0)
}

/// Parts per million to percent.
pub(crate) fn ppm_pct(ppm: u32) -> f64 {
    sig6(ppm as f64 / 10_000.0)
}

#[derive(Serialize, Clone, Copy)]
pub(crate) struct Band {
    pub p10: f64,
    pub median: f64,
    pub p90: f64,
}

struct RawBand {
    p10: u128,
    median: u128,
    p90: u128,
}

fn raw_band(mut v: Vec<u128>) -> RawBand {
    assert!(!v.is_empty(), "band of nothing");
    v.sort_unstable();
    let n = v.len();
    let median = if n % 2 == 0 { (v[n / 2 - 1] + v[n / 2]) / 2 } else { v[n / 2] };
    RawBand { p10: v[(n + 9) / 10 - 1], median, p90: v[(9 * n + 9) / 10 - 1] }
}

fn band(v: Vec<u128>, to: fn(u128) -> f64) -> Band {
    let b = raw_band(v);
    Band { p10: to(b.p10), median: to(b.median), p90: to(b.p90) }
}

#[derive(Serialize)]
pub(crate) struct DayOut {
    pub(crate) day: u32,
    pub(crate) supply: Band,
    pub(crate) circulating: Band,
    pub(crate) price_bu: Band,
    pub(crate) floor_bu: Band,
    pub(crate) surplus_per_token: Band,
    pub(crate) vault_bu: Band,
    pub(crate) burned_total: Band,
    pub(crate) redeemed_total: Band,
    pub(crate) holders_avg_cost_bu: Band,
    pub(crate) floor_pct_of_price: Band,
    pub(crate) bu_usd: Band,
    pub(crate) price_usd: Band,
    pub(crate) floor_usd: Band,
    pub(crate) mode: &'static str,
    pub(crate) graduated_share: f64,
}

fn floor_bps_of_price(d: &DaySnap) -> u128 {
    if d.price == 0 { 0 } else { mul_div(d.floor, BPS, d.price) }
}

fn day_out(runs: &[Run], i: usize) -> DayOut {
    let col = |f: fn(&DaySnap) -> u128| runs.iter().map(|r| f(&r.days[i])).collect::<Vec<_>>();
    let graduated = runs.iter().filter(|r| r.days[i].mode == Mode::Index).count();
    DayOut {
        day: runs[0].days[i].day,
        supply: band(col(|d| d.supply), whole_units),
        circulating: band(col(|d| d.circulating), whole_units),
        price_bu: band(col(|d| d.price), whole_units),
        floor_bu: band(col(|d| d.floor), whole_units),
        surplus_per_token: band(col(|d| d.surplus_per_token), whole_units),
        vault_bu: band(col(|d| d.vault), whole_units),
        burned_total: band(col(|d| d.burned), whole_units),
        redeemed_total: band(col(|d| d.redeemed), whole_units),
        holders_avg_cost_bu: band(col(|d| d.avg_cost), whole_units),
        floor_pct_of_price: band(col(floor_bps_of_price), pct),
        bu_usd: band(col(|d| d.bu_usd), whole_units),
        price_usd: band(col(|d| mul_div(d.price, d.bu_usd, E18)), whole_units),
        floor_usd: band(col(|d| mul_div(d.floor, d.bu_usd, E18)), whole_units),
        mode: if graduated * 2 > runs.len() { "index" } else { "curve" },
        graduated_share: sig6(graduated as f64 / runs.len() as f64),
    }
}

#[derive(Serialize)]
pub(crate) struct StatsOut {
    pub(crate) seeds: u64,
    pub(crate) graduated_runs: usize,
    /// Over graduated runs only.
    pub(crate) graduation_day: Option<Band>,
    pub(crate) epochs_closed_per_run: u32,
    pub(crate) swaps_per_run: Band,
    /// Over every closed epoch of every run: challenge + defense burns, % of circulating.
    pub(crate) epoch_burn_pct_of_supply: Option<Band>,
    /// Over every closed epoch of every run: the challenge minimum in tokens, % of circulating.
    pub(crate) epoch_min_challenge_pct_of_supply: Option<Band>,
    pub(crate) buys_per_run: Band,
    pub(crate) sells_per_run: Band,
    pub(crate) redeem_sells_per_run: Band,
    pub(crate) arb_redeems_per_run: Band,
}

fn stats_out(runs: &[Run]) -> StatsOut {
    let per = |f: fn(&Run) -> u128| band(runs.iter().map(f).collect(), count);
    let grad: Vec<u128> = runs.iter().filter_map(|r| r.stats.graduation_day).map(u128::from).collect();
    let burns: Vec<u128> = runs.iter().flat_map(|r| r.stats.epoch_burn_bps.iter().copied()).collect();
    let mins: Vec<u128> =
        runs.iter().flat_map(|r| r.stats.epoch_min_challenge_bps.iter().copied()).collect();
    StatsOut {
        seeds: runs.len() as u64,
        graduated_runs: grad.len(),
        graduation_day: (!grad.is_empty()).then(|| band(grad, count)),
        epochs_closed_per_run: runs.iter().map(|r| r.stats.epochs_closed).max().unwrap_or(0),
        swaps_per_run: per(|r| r.stats.swaps.into()),
        epoch_burn_pct_of_supply: (!burns.is_empty()).then(|| band(burns, pct)),
        epoch_min_challenge_pct_of_supply: (!mins.is_empty()).then(|| band(mins, pct)),
        buys_per_run: per(|r| r.stats.buys.into()),
        sells_per_run: per(|r| r.stats.sells.into()),
        redeem_sells_per_run: per(|r| r.stats.redeem_sells.into()),
        arb_redeems_per_run: per(|r| r.stats.arb_redeems.into()),
    }
}

#[derive(Serialize)]
pub(crate) struct AgentsOut {
    pub(crate) launch_retail_deposits: u32,
    pub(crate) early_holders: u32,
    pub(crate) early_holder_bu: u128,
    pub(crate) whales: u32,
    pub(crate) whale_bu: [u32; 2],
    pub(crate) whale_dump_days: [u32; 2],
    pub(crate) arrivals_per_day: Vec<u32>,
    pub(crate) churn_pct_per_day: f64,
    pub(crate) panic_drop_pct: u32,
    pub(crate) panic_pct_per_day: f64,
    pub(crate) rituals: bool,
    pub(crate) seat_weight_pct: f64,
    pub(crate) basket_daily_vol_pct: f64,
}

fn agents_out(s: &Scenario) -> AgentsOut {
    AgentsOut {
        launch_retail_deposits: s.launch_retail,
        early_holders: s.early_holders,
        early_holder_bu: s.early_holder_bu,
        whales: s.whales,
        whale_bu: [s.whale_bu.0, s.whale_bu.1],
        whale_dump_days: [s.whale_dump_days.0, s.whale_dump_days.1],
        arrivals_per_day: (0..DAYS).map(s.arrivals_per_day).collect(),
        churn_pct_per_day: ppm_pct(s.churn_ppm),
        panic_drop_pct: s.panic_drop_pct,
        panic_pct_per_day: ppm_pct(s.panic_ppm),
        rituals: s.rituals,
        seat_weight_pct: s.seat_weight_bps as f64 / 100.0,
        basket_daily_vol_pct: s.basket_vol_ppm as f64 / 10_000.0,
    }
}

#[derive(Serialize)]
pub(crate) struct ScenarioOut {
    pub(crate) id: &'static str,
    pub(crate) title: &'static str,
    pub(crate) description: &'static str,
    pub(crate) agents: AgentsOut,
    pub(crate) stats: StatsOut,
    pub(crate) days: Vec<DayOut>,
}

#[derive(Serialize)]
pub(crate) struct ParamsOut {
    pub(crate) seeds: u64,
    pub(crate) days: u32,
    pub(crate) step_hours: u32,
    pub(crate) virtual_bu: f64,
    pub(crate) virtual_tokens: f64,
    pub(crate) graduation_reserve_bu: f64,
    pub(crate) trade_fee_bps: u128,
    pub(crate) fee_split_bps: [u128; 3],
    pub(crate) redeem_fee_bps: u128,
    pub(crate) pool_share_bps: u128,
    pub(crate) challenge_min_bps_of_slot: u128,
    pub(crate) epoch_days: u64,
    pub(crate) seat_weight_bps: u128,
    pub(crate) challenge_aim_pct_of_minimum: [u32; 2],
    pub(crate) challenge_budget_bps_of_supply: [u128; 2],
    pub(crate) epoch_burn_cap_bps_of_supply: u128,
    pub(crate) solver_cut_bps_of_slot: [u32; 2],
    pub(crate) bu_usd_at_launch: f64,
    pub(crate) basket_daily_vol_pct: f64,
    pub(crate) retail_sizes_bu_and_weight_pct: Vec<[u128; 2]>,
    pub(crate) take_profit_pct_of_cost: Vec<u32>,
    pub(crate) take_profit_sell_chance_pct: f64,
    pub(crate) whale_dump_hours: u32,
    pub(crate) challenge_parts: [u32; 2],
    pub(crate) defend_chance_pct: f64,
    pub(crate) defend_delay_hours: [u32; 2],
    pub(crate) defend_size_pct_of_challenge: [u32; 2],
    pub(crate) arb_chunk_bps_of_pool: u128,
    pub(crate) arb_max_rounds_per_hour: u32,
}

fn params_out(p: &Params, seeds: u64) -> ParamsOut {
    ParamsOut {
        seeds,
        days: DAYS,
        step_hours: 1,
        virtual_bu: whole_units(p.curve.x0),
        virtual_tokens: whole_units(p.curve.y0),
        graduation_reserve_bu: whole_units(p.curve.grad_reserve),
        trade_fee_bps: p.fee_bps,
        fee_split_bps: p.split_bps,
        redeem_fee_bps: p.redeem_fee_bps,
        pool_share_bps: p.pool_share_bps,
        challenge_min_bps_of_slot: p.challenge_min_bps,
        epoch_days: p.epoch_hours / 24,
        seat_weight_bps: SEAT_WEIGHT_BPS,
        challenge_aim_pct_of_minimum: [CHALLENGE_MARGIN_PCT.0, CHALLENGE_MARGIN_PCT.1],
        challenge_budget_bps_of_supply: [CHALLENGE_BUDGET_BPS.0, CHALLENGE_BUDGET_BPS.1],
        epoch_burn_cap_bps_of_supply: EPOCH_BURN_CAP_BPS,
        solver_cut_bps_of_slot: [SOLVER_CUT_BPS.0, SOLVER_CUT_BPS.1],
        bu_usd_at_launch: whole_units(p.bu_usd_e18),
        basket_daily_vol_pct: ppm_pct(BASKET_DAILY_VOL_PPM as u32),
        retail_sizes_bu_and_weight_pct: RETAIL_SIZES_BU.iter().map(|&(b, w)| [b, w as u128]).collect(),
        take_profit_pct_of_cost: TAKE_PROFIT_PCT.to_vec(),
        take_profit_sell_chance_pct: ppm_pct(TAKE_PROFIT_PPM),
        whale_dump_hours: WHALE_DUMP_HOURS,
        challenge_parts: [CHALLENGE_PARTS.0, CHALLENGE_PARTS.1],
        defend_chance_pct: ppm_pct(DEFEND_PPM),
        defend_delay_hours: [DEFEND_DELAY_HOURS.0, DEFEND_DELAY_HOURS.1],
        defend_size_pct_of_challenge: [DEFEND_SIZE_PCT.0, DEFEND_SIZE_PCT.1],
        arb_chunk_bps_of_pool: ARB_CHUNK_BPS,
        arb_max_rounds_per_hour: ARB_MAX_ROUNDS,
    }
}

#[derive(Serialize)]
pub(crate) struct SimOut {
    pub(crate) generated_by: &'static str,
    pub(crate) params: ParamsOut,
    pub(crate) scenarios: Vec<ScenarioOut>,
}

/// Run every scenario across `seeds` seeds (in parallel; each run is independent).
fn run_all(seeds: u64) -> Result<Vec<(Scenario, Vec<Run>)>> {
    let scenarios = Scenario::all();
    let results: Vec<Vec<Result<Run>>> = std::thread::scope(|sc| {
        let handles: Vec<Vec<_>> = scenarios
            .iter()
            .map(|s| (0..seeds).map(|seed| sc.spawn(move || run(s, seed))).collect())
            .collect();
        handles
            .into_iter()
            .map(|hs| hs.into_iter().map(|h| h.join().expect("run thread panicked")).collect())
            .collect()
    });
    scenarios
        .into_iter()
        .zip(results)
        .map(|(s, rs)| Ok((s, rs.into_iter().collect::<Result<Vec<Run>>>()?)))
        .collect()
}

pub fn generate(seeds: u64) -> Result<Outputs> {
    let params = Params::from_constants();
    let all = run_all(seeds)?;
    let out = SimOut {
        generated_by: "cargo run -p sim --release (sim/ in this repo; mechanism math from crates/curve-math)",
        params: params_out(&params, seeds),
        scenarios: all
            .iter()
            .map(|(s, runs)| ScenarioOut {
                id: s.id,
                title: s.title,
                description: s.description,
                agents: agents_out(s),
                stats: stats_out(runs),
                days: (0..=DAYS as usize).map(|i| day_out(runs, i)).collect(),
            })
            .collect(),
    };
    Ok(Outputs { json: layout(&out), markdown: crate::doc::markdown(&params, &out) })
}

/// JSON with one line per day: readable diffs, a third of the pretty-printed size.
fn layout(out: &SimOut) -> String {
    fn compact<T: Serialize + ?Sized>(v: &T) -> String {
        serde_json::to_string(v).expect("serializes")
    }
    let mut s = String::from("{\n");
    let _ = writeln!(s, "  \"generated_by\": {},", compact(out.generated_by));
    let _ = writeln!(s, "  \"params\": {},", compact(&out.params));
    s.push_str("  \"scenarios\": [\n");
    for (i, sc) in out.scenarios.iter().enumerate() {
        s.push_str("    {\n");
        let _ = writeln!(s, "      \"id\": {},", compact(sc.id));
        let _ = writeln!(s, "      \"title\": {},", compact(sc.title));
        let _ = writeln!(s, "      \"description\": {},", compact(sc.description));
        let _ = writeln!(s, "      \"agents\": {},", compact(&sc.agents));
        let _ = writeln!(s, "      \"stats\": {},", compact(&sc.stats));
        s.push_str("      \"days\": [\n");
        let days: Vec<String> = sc.days.iter().map(|d| format!("        {}", compact(d))).collect();
        s.push_str(&days.join(",\n"));
        s.push_str("\n      ]\n    }");
        s.push_str(if i + 1 < out.scenarios.len() { ",\n" } else { "\n" });
    }
    s.push_str("  ]\n}\n");
    s
}

impl Outputs {
    fn files(&self) -> [(&'static str, &String); 2] {
        [(JSON_PATH, &self.json), (MD_PATH, &self.markdown)]
    }
}

pub fn write(root: &Path, out: &Outputs) -> std::io::Result<()> {
    for (rel, body) in out.files() {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().expect("has a parent"))?;
        std::fs::write(path, body)?;
    }
    Ok(())
}

/// Output files whose contents on disk differ from `out` (or are missing).
pub fn stale(root: &Path, out: &Outputs) -> Vec<&'static str> {
    out.files()
        .into_iter()
        .filter(|(rel, body)| std::fs::read_to_string(root.join(rel)).ok().as_deref() != Some(body.as_str()))
        .map(|(rel, _)| rel)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_json_has_61_days_per_scenario_with_ordered_bands() {
        let out = generate(2).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out.json).unwrap();
        let scenarios = v["scenarios"].as_array().unwrap();
        assert_eq!(scenarios.len(), 5);
        for s in scenarios {
            let days = s["days"].as_array().unwrap();
            assert_eq!(days.len(), 61);
            for d in days {
                for m in ["supply", "circulating", "price_bu", "floor_bu", "surplus_per_token",
                          "vault_bu", "burned_total", "holders_avg_cost_bu"] {
                    let b = &d[m];
                    let (lo, mid, hi) = (b["p10"].as_f64().unwrap(), b["median"].as_f64().unwrap(), b["p90"].as_f64().unwrap());
                    assert!(lo <= mid && mid <= hi, "{} day {} {m}: {lo} {mid} {hi}", s["id"], d["day"]);
                }
                assert!(d["mode"] == "curve" || d["mode"] == "index");
            }
        }
        assert!(out.markdown.contains("| Day |"));
    }

    #[test]
    fn check_names_the_files_that_differ_from_a_fresh_run() {
        let dir = std::env::temp_dir().join(format!("sim-check-{}", std::process::id()));
        let out = Outputs { json: "{}".into(), markdown: "# sim".into() };
        write(&dir, &out).unwrap();
        assert!(stale(&dir, &out).is_empty());
        std::fs::write(dir.join(MD_PATH), "# edited").unwrap();
        assert_eq!(stale(&dir, &out), vec![MD_PATH]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
