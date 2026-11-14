//! Agents and scenarios: 60 days of hourly steps on one coin.
//!
//! Every draw is an integer from a seeded ChaCha8 stream and every amount is an integer, so a
//! (scenario, seed) pair replays to the same bytes on any machine. Four independent streams keep
//! scenarios comparable: `arrivals` (who arrives when, ticket sizes, each holder's habits),
//! `decisions` (daily sell rolls), `ritual` (challenge and defend burns) and `basket` (the BU's
//! USD value). Seed n draws the same basket path in every scenario, and the steady and
//! challenge-war scenarios see the same buyers.

use crate::coin::{mul_div, Coin, Mode, Path, Result, SimError};
use crate::params::Params;
use curve_math::{BPS, E18};
use rand::Rng;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

pub const DAYS: u32 = 60;
const HOURS: u32 = DAYS * 24;

/// Buy sizes in whole BU for retail buyers, with weights in percent (mean 63.75 BU).
pub const RETAIL_SIZES_BU: [(u128, u32); 7] =
    [(5, 10), (10, 20), (25, 25), (50, 20), (100, 15), (250, 8), (500, 2)];
/// Take-profit multiples (percent of average cost); each retail holder draws one.
pub const TAKE_PROFIT_PCT: [u32; 4] = [150, 200, 300, 500];
/// At its target a holder sells half its bag, with this chance per daily check (ppm).
pub const TAKE_PROFIT_PPM: u32 = 500_000;
/// Whales dump in this many equal hourly chunks.
pub const WHALE_DUMP_HOURS: u32 = 4;
/// The challenged seat's weight: a $DEGEN-style basket of one anchored asset and one seat, 50/50.
/// (The default; a scenario sets its own.)
pub const SEAT_WEIGHT_BPS: u128 = 5_000;
/// A three-asset meme basket ($COOK-style: JAMBO anchored, BLACKDRAGON, PEPE): each seat is a third.
pub const MEME_SEAT_WEIGHT_BPS: u128 = 3_333;
/// Solver's cut on the swap after a winning challenge, drawn per swap (bps of the slot's value).
pub const SOLVER_CUT_BPS: (u32, u32) = (100, 200);
/// Challengers aim for this multiple (percent) of the challenge minimum, drawn per epoch...
pub const CHALLENGE_MARGIN_PCT: (u32, u32) = (100, 130);
/// ...but burn no less and no more than this, in bps of circulating supply at the epoch's start.
pub const CHALLENGE_BUDGET_BPS: (u128, u128) = (10, 80);
/// The budget is burned in this many equal parts at random hours...
pub const CHALLENGE_PARTS: (u32, u32) = (2, 3);
/// ...none in the epoch's last hours, so defenders can answer.
pub const CHALLENGE_QUIET_HOURS: u32 = 18;
/// Defenders answer a challenge burn with this chance (ppm), after 1 to 12 hours, burning
/// 50% to 130% of its size.
pub const DEFEND_PPM: u32 = 500_000;
pub const DEFEND_DELAY_HOURS: (u32, u32) = (1, 12);
pub const DEFEND_SIZE_PCT: (u32, u32) = (50, 130);
/// Cap on all burns (challenge + defense) in one epoch, bps of circulating at the epoch's start.
/// Burns are first come, first served against it.
pub const EPOCH_BURN_CAP_BPS: u128 = 100;
/// Arbitrage (Index mode): round trips of this share of the pool's BU (bps), at most this many
/// an hour.
pub const ARB_CHUNK_BPS: u128 = 100;
pub const ARB_MAX_ROUNDS: u32 = 50;
/// Daily volatility of the basket's USD value, in ppm (3%: majors like BTC and ETH with USDC).
pub const BASKET_DAILY_VOL_PPM: i64 = 30_000;
/// The same for a basket of memecoins (10% a day).
pub const MEME_BASKET_DAILY_VOL_PPM: i64 = 100_000;

#[derive(Clone, Debug)]
pub struct Scenario {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// Retail deposits in the fair-launch window.
    pub launch_retail: u32,
    /// Early holders (whole BU each) who join the fair launch and never sell. When rituals are
    /// on, the first half are challengers and the second half defenders.
    pub early_holders: u32,
    pub early_holder_bu: u128,
    /// Whales in the fair launch (whole BU range) and the days their dumps may start.
    pub whales: u32,
    pub whale_bu: (u32, u32),
    pub whale_dump_days: (u32, u32),
    /// New retail buyers per day, by day index (0-based).
    pub arrivals_per_day: fn(u32) -> u32,
    /// Chance per daily check that a retail holder sells everything (ppm).
    pub churn_ppm: u32,
    /// A holder whose mark is this many percent below cost may panic-sell, with this daily chance.
    pub panic_drop_pct: u32,
    pub panic_ppm: u32,
    pub rituals: bool,
    /// Share of the vault the challenged seat holds (bps).
    pub seat_weight_bps: u128,
    /// Daily volatility of the basket's USD value (ppm). Agents trade in BU; this moves the USD view.
    pub basket_vol_ppm: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DaySnap {
    pub day: u32,
    pub supply: u128,
    pub circulating: u128,
    pub price: u128,
    pub floor: u128,
    pub surplus_per_token: u128,
    pub vault: u128,
    pub burned: u128,
    pub redeemed: u128,
    pub mode: Mode,
    /// Holders' average cost, BU per token (1e18-scaled), fees included.
    pub avg_cost: u128,
    /// USD per BU (1e18-scaled).
    pub bu_usd: u128,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RunStats {
    /// Day (1-based) during which the coin graduated.
    pub graduation_day: Option<u32>,
    pub epochs_closed: u32,
    pub swaps: u32,
    /// Per closed epoch: all burns (challenge + defense) as bps of circulating at its start.
    pub epoch_burn_bps: Vec<u128>,
    /// Per closed epoch: tokens the challenge minimum needed at the close, bps of circulating.
    pub epoch_min_challenge_bps: Vec<u128>,
    pub buys: u32,
    /// BU of all arriving retail tickets (before any refund).
    pub bought_bu: u128,
    pub sells: u32,
    /// Sells the matching path paid by redeeming, and arbitrage buy-and-redeem round trips.
    pub redeem_sells: u32,
    pub arb_redeems: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub days: Vec<DaySnap>,
    pub stats: RunStats,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Retail,
    Whale,
    Challenger,
    Defender,
}

#[derive(Clone, Debug)]
struct Holder {
    kind: Kind,
    tokens: u128,
    /// BU paid for the tokens still held (average-cost method), fees included.
    cost: u128,
    /// Hour of day (0..24) of this holder's daily check.
    check_hour: u32,
    take_profit_pct: u32,
    /// Whales: hour the dump starts, and the chunk sold each hour.
    dump_start: Option<u32>,
    dump_chunk: u128,
}

impl Holder {
    fn new(kind: Kind, tokens: u128, cost: u128, rng: &mut ChaCha8Rng) -> Holder {
        Holder {
            kind,
            tokens,
            cost,
            check_hour: rng.gen_range(0..24),
            take_profit_pct: TAKE_PROFIT_PCT[rng.gen_range(0..TAKE_PROFIT_PCT.len())],
            dump_start: None,
            dump_chunk: 0,
        }
    }

    /// A retail holder's daily check: tokens to sell at price `mark`. Churn first, then take
    /// profit at its target, then panic when far enough under water.
    fn decide(&self, s: &Scenario, mark: u128, rng: &mut ChaCha8Rng) -> u128 {
        let avg = mul_div(self.cost, E18, self.tokens);
        if chance(rng, s.churn_ppm) {
            self.tokens
        } else if mark * 100 >= avg * self.take_profit_pct as u128 {
            if chance(rng, TAKE_PROFIT_PPM) { self.tokens / 2 } else { 0 }
        } else if mark * 100 <= avg * (100 - s.panic_drop_pct as u128) && chance(rng, s.panic_ppm) {
            self.tokens
        } else {
            0
        }
    }

    /// Remove `t` tokens and their share of the cost basis.
    fn take(&mut self, t: u128) {
        self.cost -= mul_div(self.cost, t, self.tokens);
        self.tokens -= t;
    }
}

fn chance(rng: &mut ChaCha8Rng, ppm: u32) -> bool {
    rng.gen_range(0..1_000_000u32) < ppm
}

fn retail_size(rng: &mut ChaCha8Rng) -> u128 {
    let mut r = rng.gen_range(0..100u32);
    for (bu, w) in RETAIL_SIZES_BU {
        if r < w {
            return bu * E18;
        }
        r -= w;
    }
    unreachable!("weights sum to 100")
}

/// Pop the (hour, tokens) entries of a sorted queue that are due by `hour`.
fn take_due(queue: &mut Vec<(u32, u128)>, hour: u32) -> Vec<u128> {
    let n = queue.iter().take_while(|&&(h, _)| h <= hour).count();
    queue.drain(..n).map(|(_, t)| t).collect()
}

/// One day's move of the basket's USD value: Irwin-Hall approximation of a normal draw
/// (sum of 12 uniforms), integer only.
fn basket_step(bu_usd: u128, vol_ppm: i64, rng: &mut ChaCha8Rng) -> u128 {
    let z_e4: i64 = (0..12).map(|_| rng.gen_range(0..10_000i64)).sum::<i64>() - 60_000;
    // Floored so a long run of bad days can't take the basket to zero or below.
    let r_ppm = (z_e4 * vol_ppm / 10_000).max(-500_000);
    mul_div(bu_usd, (1_000_000 + r_ppm) as u128, 1_000_000)
}

/// Challenge and defense plan for the current epoch.
#[derive(Default)]
struct Epoch {
    start_circ: u128,
    cap: u128,
    burned: u128,
    tally: u128,
    defense: u128,
    /// (hour, tokens) burns still to happen this epoch.
    challenges: Vec<(u32, u128)>,
    defenses: Vec<(u32, u128)>,
}

struct World<'a> {
    s: &'a Scenario,
    coin: Coin,
    holders: Vec<Holder>,
    arrivals: ChaCha8Rng,
    decisions: ChaCha8Rng,
    ritual: ChaCha8Rng,
    basket: ChaCha8Rng,
    bu_usd: u128,
    epoch: Epoch,
    stats: RunStats,
    epoch_hours: u32,
}

impl World<'_> {
    fn sell(&mut self, i: usize, t: u128) -> Result<()> {
        if t == 0 {
            return Ok(());
        }
        let sold = self.coin.sell(t)?;
        self.holders[i].take(t);
        self.stats.sells += 1;
        if sold.path == Path::Redeem {
            self.stats.redeem_sells += 1;
        }
        Ok(())
    }

    fn arrivals(&mut self, day: u32) -> Result<()> {
        // Poisson-like: 60 one-minute slots, each a buyer with probability rate / 1,440.
        let ppm = (self.s.arrivals_per_day)(day) * 1_000_000 / 1_440;
        for _ in 0..60 {
            if chance(&mut self.arrivals, ppm) {
                let bu = retail_size(&mut self.arrivals);
                let b = self.coin.buy(bu)?;
                self.stats.buys += 1;
                self.stats.bought_bu += bu;
                let h = Holder::new(Kind::Retail, b.tokens, b.spent, &mut self.arrivals);
                self.holders.push(h);
            }
        }
        Ok(())
    }

    fn retail_checks(&mut self, hour: u32) -> Result<()> {
        for i in 0..self.holders.len() {
            let h = &self.holders[i];
            if h.kind != Kind::Retail || h.check_hour != hour % 24 || h.tokens == 0 {
                continue;
            }
            let t = h.decide(self.s, self.coin.price(), &mut self.decisions);
            self.sell(i, t)?;
        }
        Ok(())
    }

    fn whale_dumps(&mut self, hour: u32) -> Result<()> {
        for i in 0..self.holders.len() {
            let h = &self.holders[i];
            let Some(start) = h.dump_start else { continue };
            if hour < start || h.tokens == 0 {
                continue;
            }
            if hour == start {
                self.holders[i].dump_chunk = self.holders[i].tokens / WHALE_DUMP_HOURS as u128;
            }
            let h = &self.holders[i];
            let last = hour + 1 >= start + WHALE_DUMP_HOURS;
            let t = if last { h.tokens } else { h.dump_chunk.min(h.tokens) };
            self.sell(i, t)?;
        }
        Ok(())
    }

    /// The biggest bag of `kind` burns up to `t` tokens, within the epoch's cap.
    fn faction_burn(&mut self, kind: Kind, t: u128) -> Result<u128> {
        let Some(i) = (0..self.holders.len())
            .filter(|&i| self.holders[i].kind == kind)
            .max_by_key(|&i| (self.holders[i].tokens, std::cmp::Reverse(i)))
        else {
            return Ok(0);
        };
        let t = t.min(self.holders[i].tokens).min(self.epoch.cap - self.epoch.burned);
        if t == 0 {
            return Ok(0);
        }
        let value = self.coin.burn(t)?;
        self.holders[i].take(t);
        self.epoch.burned += t;
        Ok(value)
    }

    /// Fewest tokens whose burn counts for at least `value` BU (binary search on the quote).
    fn tokens_for_burn_value(&self, value: u128) -> u128 {
        let (mut lo, mut hi) = (0u128, self.coin.circulating());
        if self.coin.quote_burn(hi) < value {
            return hi;
        }
        while hi - lo > 1 {
            let mid = lo + (hi - lo) / 2;
            if self.coin.quote_burn(mid) >= value { hi = mid } else { lo = mid }
        }
        hi
    }

    fn rituals(&mut self, hour: u32) -> Result<()> {
        let len = self.epoch_hours;
        let at = hour % len;
        if at == 0 {
            let circ = self.coin.circulating();
            let margin = self.ritual.gen_range(CHALLENGE_MARGIN_PCT.0..=CHALLENGE_MARGIN_PCT.1);
            let aim = self.coin.challenge_minimum(self.s.seat_weight_bps) * margin as u128 / 100;
            let budget = self.tokens_for_burn_value(aim).clamp(
                circ * CHALLENGE_BUDGET_BPS.0 / BPS,
                circ * CHALLENGE_BUDGET_BPS.1 / BPS,
            );
            let n = self.ritual.gen_range(CHALLENGE_PARTS.0..=CHALLENGE_PARTS.1);
            let chunk = budget / n as u128;
            let mut challenges: Vec<(u32, u128)> = (0..n)
                .map(|_| (hour + self.ritual.gen_range(0..len - CHALLENGE_QUIET_HOURS), chunk))
                .collect();
            challenges.sort();
            self.epoch = Epoch {
                start_circ: circ,
                cap: circ * EPOCH_BURN_CAP_BPS / BPS,
                challenges,
                ..Epoch::default()
            };
        }
        for t in take_due(&mut self.epoch.challenges, hour) {
            self.epoch.tally += self.faction_burn(Kind::Challenger, t)?;
            if chance(&mut self.ritual, DEFEND_PPM) {
                let when = hour + self.ritual.gen_range(DEFEND_DELAY_HOURS.0..=DEFEND_DELAY_HOURS.1);
                let pct = self.ritual.gen_range(DEFEND_SIZE_PCT.0..=DEFEND_SIZE_PCT.1);
                self.epoch.defenses.push((when, t * pct as u128 / 100));
                self.epoch.defenses.sort();
            }
        }
        for t in take_due(&mut self.epoch.defenses, hour) {
            self.epoch.defense += self.faction_burn(Kind::Defender, t)?;
        }
        if at == len - 1 {
            self.stats.epochs_closed += 1;
            self.stats
                .epoch_burn_bps
                .push(self.epoch.burned * BPS / self.epoch.start_circ.max(1));
            let min = self.coin.challenge_minimum(self.s.seat_weight_bps);
            let min_tokens = self.tokens_for_burn_value(min);
            self.stats
                .epoch_min_challenge_bps
                .push(min_tokens * BPS / self.coin.circulating().max(1));
            if self.epoch.tally > self.epoch.defense && self.epoch.tally >= min {
                let cut = self.ritual.gen_range(SOLVER_CUT_BPS.0..=SOLVER_CUT_BPS.1) as u128;
                let slot = mul_div(self.coin.owed(), self.s.seat_weight_bps, BPS);
                self.coin.swap_loss(mul_div(slot, cut, BPS))?;
                self.stats.swaps += 1;
            }
        }
        Ok(())
    }

    /// Index mode: while buying a slice of the pool's BU and redeeming the tokens pays more than
    /// it costs, an arbitrageur does it. This holds the pool price near the floor from below.
    fn arbitrage(&mut self) -> Result<()> {
        for _ in 0..ARB_MAX_ROUNDS {
            let chunk = self.coin.pool_bu() * ARB_CHUNK_BPS / BPS;
            let mut trial = self.coin.clone();
            let b = trial.buy(chunk)?;
            if trial.redeem(b.tokens)? <= chunk {
                break;
            }
            self.coin = trial;
            self.stats.arb_redeems += 1;
        }
        Ok(())
    }

    fn snapshot(&self, day: u32) -> Result<DaySnap> {
        let tokens: u128 = self.holders.iter().map(|h| h.tokens).sum();
        let cost: u128 = self.holders.iter().map(|h| h.cost).sum();
        if tokens != self.coin.circulating() {
            return Err(SimError::TokenLedger { holders: tokens, circulating: self.coin.circulating() });
        }
        Ok(DaySnap {
            day,
            supply: self.coin.supply(),
            circulating: self.coin.circulating(),
            price: self.coin.price(),
            floor: self.coin.floor(),
            surplus_per_token: self.coin.surplus_per_token(),
            vault: self.coin.vault_bu(),
            burned: self.coin.burned(),
            redeemed: self.coin.redeemed(),
            mode: self.coin.mode(),
            avg_cost: if tokens == 0 { 0 } else { mul_div(cost, E18, tokens) },
            bu_usd: self.bu_usd,
        })
    }
}

/// Run one scenario for 60 days with one seed.
pub fn run(s: &Scenario, seed: u64) -> Result<Run> {
    let params = Params::from_constants();
    let mut w = World {
        s,
        coin: Coin::new(params),
        holders: Vec::new(),
        arrivals: ChaCha8Rng::seed_from_u64(seed),
        decisions: ChaCha8Rng::seed_from_u64(seed ^ 0xdec1_5105),
        ritual: ChaCha8Rng::seed_from_u64(seed ^ 0x5249_5455_414c),
        basket: ChaCha8Rng::seed_from_u64(seed ^ 0xba5c_e700),
        bu_usd: params.bu_usd_e18,
        epoch: Epoch::default(),
        stats: RunStats::default(),
        epoch_hours: params.epoch_hours as u32,
    };

    // Fair-launch window: early holders, whales and retail deposit; one pooled buy.
    let mut kinds = Vec::new();
    let mut deposits = Vec::new();
    for i in 0..s.early_holders {
        kinds.push(if i < s.early_holders / 2 { Kind::Challenger } else { Kind::Defender });
        deposits.push(s.early_holder_bu * E18);
    }
    for _ in 0..s.whales {
        kinds.push(Kind::Whale);
        deposits.push(w.arrivals.gen_range(s.whale_bu.0..=s.whale_bu.1) as u128 * E18);
    }
    for _ in 0..s.launch_retail {
        kinds.push(Kind::Retail);
        deposits.push(retail_size(&mut w.arrivals));
    }
    let got = w.coin.fair_launch(&deposits)?;
    for (kind, b) in kinds.into_iter().zip(got) {
        let mut h = Holder::new(kind, b.tokens, b.spent, &mut w.arrivals);
        if kind == Kind::Whale {
            h.dump_start = Some(w.arrivals.gen_range(s.whale_dump_days.0 * 24..s.whale_dump_days.1 * 24));
        }
        w.holders.push(h);
    }

    let mut days = vec![w.snapshot(0)?];
    for hour in 0..HOURS {
        let day = hour / 24;
        w.arrivals(day)?;
        w.whale_dumps(hour)?;
        w.retail_checks(hour)?;
        if s.rituals {
            w.rituals(hour)?;
        }
        if w.coin.mode() == Mode::Index {
            if w.stats.graduation_day.is_none() {
                w.stats.graduation_day = Some(day + 1);
            }
            w.arbitrage()?;
        }
        if hour % 24 == 23 {
            w.coin.claim_fees()?;
            w.bu_usd = basket_step(w.bu_usd, s.basket_vol_ppm, &mut w.basket);
            days.push(w.snapshot(day + 1)?);
            w.holders.retain(|h| h.tokens > 0 || h.kind != Kind::Retail);
        }
    }
    Ok(Run { days, stats: w.stats })
}

fn steady_arrivals(day: u32) -> u32 {
    6 + day / 10
}

fn pump_arrivals(day: u32) -> u32 {
    if day < 5 { 50 } else { 6 }
}

fn graduation_arrivals(day: u32) -> u32 {
    if day < 10 { 150 } else { 10 }
}

fn meme_arrivals(day: u32) -> u32 {
    if day < 7 { 30 } else { 8 }
}

impl Scenario {
    pub fn all() -> Vec<Scenario> {
        let steady = Scenario {
            id: "steady",
            title: "Steady organic growth",
            description: "Retail buyers arrive at a slowly rising rate (6 a day, rising to 11). \
                Holders take profit at their own target, a few churn out each day, and six early \
                holders never sell. No burns.",
            launch_retail: 30,
            early_holders: 6,
            early_holder_bu: 250,
            whales: 0,
            whale_bu: (0, 0),
            whale_dump_days: (0, 0),
            arrivals_per_day: steady_arrivals,
            churn_ppm: 15_000,
            panic_drop_pct: 50,
            panic_ppm: 50_000,
            rituals: false,
            seat_weight_bps: SEAT_WEIGHT_BPS,
            basket_vol_ppm: BASKET_DAILY_VOL_PPM,
        };
        let war = Scenario {
            id: "challenge-war",
            title: "Challenge war",
            description: "The steady scenario plus a weekly seat challenge. Three early holders \
                challenge the 50% seat, aiming just past the challenge minimum, and three defend \
                it. All burns in a week are capped at 1% of supply, and the cap binds in most \
                weeks.",
            rituals: true,
            ..steady.clone()
        };
        let pump = Scenario {
            id: "pump-and-dump",
            title: "Pump and dump",
            description: "Five whales put 800 to 1,500 BU each into the fair launch, hype brings \
                50 buyers a day for five days, then the whales sell everything between days 4 and \
                7. Arrivals fall to 6 a day and holders under water panic-sell.",
            launch_retail: 20,
            early_holders: 0,
            early_holder_bu: 0,
            whales: 5,
            whale_bu: (800, 1_500),
            whale_dump_days: (4, 7),
            arrivals_per_day: pump_arrivals,
            churn_ppm: 30_000,
            panic_drop_pct: 40,
            panic_ppm: 200_000,
            rituals: false,
            seat_weight_bps: SEAT_WEIGHT_BPS,
            basket_vol_ppm: BASKET_DAILY_VOL_PPM,
        };
        let grad = Scenario {
            id: "graduation",
            title: "Run to graduation, then Index mode",
            description: "Strong demand (150 buyers a day for ten days) carries the curve to \
                graduation within about a week and the coin graduates into its pool. Then demand \
                fades to 10 buyers a day: each seller gets the better of the pool and redeeming, \
                and arbitrageurs buy and redeem whenever the pool trades below the floor.",
            launch_retail: 40,
            early_holders: 0,
            early_holder_bu: 0,
            whales: 0,
            whale_bu: (0, 0),
            whale_dump_days: (0, 0),
            arrivals_per_day: graduation_arrivals,
            churn_ppm: 20_000,
            panic_drop_pct: 50,
            panic_ppm: 50_000,
            rituals: false,
            seat_weight_bps: SEAT_WEIGHT_BPS,
            basket_vol_ppm: BASKET_DAILY_VOL_PPM,
        };
        let meme = Scenario {
            id: "meme-basket",
            title: "NEAR memes basket",
            description: "A $COOK-style coin whose basket is three NEAR memecoins (JAMBO from \
                meme.cooking anchored, BLACKDRAGON, PEPE), so each seat is a third of the vault and \
                the basket's dollar value swings 10% a day instead of 3%. A hype week brings 30 \
                buyers a day, then 8. Holders panic faster when under water, and every week they \
                vote on a seat, as in the challenge war.",
            launch_retail: 30,
            early_holders: 6,
            early_holder_bu: 250,
            whales: 0,
            whale_bu: (0, 0),
            whale_dump_days: (0, 0),
            arrivals_per_day: meme_arrivals,
            churn_ppm: 25_000,
            panic_drop_pct: 40,
            panic_ppm: 120_000,
            rituals: true,
            seat_weight_bps: MEME_SEAT_WEIGHT_BPS,
            basket_vol_ppm: MEME_BASKET_DAILY_VOL_PPM,
        };
        vec![steady, pump, war, grad, meme]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seed_replays_exactly_and_another_seed_does_not() {
        let s = &Scenario::all()[0];
        let a = run(s, 7).unwrap();
        assert_eq!(a.days.len(), 61, "day 0 plus 60 days");
        assert_eq!(a, run(s, 7).unwrap());
        assert_ne!(a.days, run(s, 8).unwrap().days);
    }

    fn scenario(id: &str) -> Scenario {
        Scenario::all().into_iter().find(|s| s.id == id).unwrap()
    }

    #[test]
    fn a_meme_basket_floor_still_climbs_in_bu_while_its_dollar_value_swings_wider() {
        let usd_floor = |r: &Run, d: usize| mul_div(r.days[d].floor, r.days[d].bu_usd, E18);
        let (mut meme_usd, mut steady_usd) = (Vec::new(), Vec::new());
        for seed in 0..6 {
            let meme = run(&scenario("meme-basket"), seed).unwrap();
            let steady = run(&scenario("steady"), seed).unwrap();
            // In basket units the floor ends above where it started: votes burn, fees stay.
            assert!(meme.days[60].floor > meme.days[0].floor, "seed {seed}");
            assert!(meme.stats.epochs_closed > 0, "seed {seed}: votes ran");
            meme_usd.push(usd_floor(&meme, 60));
            steady_usd.push(usd_floor(&steady, 60));
        }
        // In dollars the meme basket's floor is spread far wider than a majors basket's.
        let spread = |v: &[u128]| (*v.iter().max().unwrap() as f64) / (*v.iter().min().unwrap() as f64);
        assert!(spread(&meme_usd) > spread(&steady_usd), "meme spread {} vs steady {}", spread(&meme_usd), spread(&steady_usd));
    }

    #[test]
    fn the_challenge_war_burns_0_1_to_1_percent_a_week_and_lifts_the_floor_over_steady() {
        for seed in 0..3 {
            let war = run(&scenario("challenge-war"), seed).unwrap();
            let steady = run(&scenario("steady"), seed).unwrap();
            assert_eq!(war.stats.epochs_closed, 8);
            for &bps in &war.stats.epoch_burn_bps {
                assert!((10..=100).contains(&bps), "seed {seed}: {bps} bps in one epoch");
            }
            // The challenge minimum, in tokens at the close, as bps of circulating supply.
            assert_eq!(war.stats.epoch_min_challenge_bps.len(), 8);
            for &bps in &war.stats.epoch_min_challenge_bps {
                assert!((10..=100).contains(&bps), "seed {seed}: minimum is {bps} bps of supply");
            }
            let (w, st) = (war.days[60], steady.days[60]);
            assert!(w.burned > 0 && steady.days[60].burned == 0);
            assert!(w.surplus_per_token > st.surplus_per_token, "seed {seed}");
        }
    }

    #[test]
    fn in_a_challenge_war_some_challenges_win_and_some_are_defended() {
        let (mut swaps, mut epochs) = (0, 0);
        for seed in 0..3 {
            let r = run(&scenario("challenge-war"), seed).unwrap();
            swaps += r.stats.swaps;
            epochs += r.stats.epochs_closed;
        }
        assert!(swaps > 0 && swaps < epochs, "{swaps} swaps in {epochs} epochs");
    }

    #[test]
    fn the_graduation_scenario_graduates_every_seed_and_some_sells_redeem() {
        for seed in 0..3 {
            let r = run(&scenario("graduation"), seed).unwrap();
            let day = r.stats.graduation_day.expect("graduates");
            assert!(day <= 20, "seed {seed} graduated on day {day}");
            assert_eq!(r.days[60].mode, Mode::Index);
            assert!(r.stats.redeem_sells + r.stats.arb_redeems > 0, "seed {seed}: no redeems");
            assert!(r.days[60].redeemed > 0);
        }
    }

    #[test]
    fn the_pump_and_dump_stays_on_the_curve_ends_below_half_its_peak_and_still_lifts_the_floor() {
        for seed in 0..3 {
            let r = run(&scenario("pump-and-dump"), seed).unwrap();
            assert_eq!(r.stats.graduation_day, None, "seed {seed}");
            let peak = r.days[..=7].iter().map(|d| d.price).max().unwrap();
            assert!(r.days[60].price * 2 < peak, "seed {seed}: day-60 price is more than half the peak");
            assert!(r.days[60].floor > r.days[0].floor, "the fees left behind lift the floor");
        }
    }

    #[test]
    fn steady_and_challenge_war_see_the_same_buyers_for_a_seed() {
        for seed in 0..3 {
            let steady = run(&scenario("steady"), seed).unwrap();
            let war = run(&scenario("challenge-war"), seed).unwrap();
            assert_eq!(steady.stats.buys, war.stats.buys, "seed {seed}");
            assert_eq!(steady.stats.bought_bu, war.stats.bought_bu, "seed {seed}");
        }
    }
}
