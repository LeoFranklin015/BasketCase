//! One coin's vault and token state, driven only through the actions a user can take.
//!
//! Every action ends with a solvency check: the BU the coin owes (reserve + surplus + owed fees
//! + pool) must never exceed the BU its vault holds. `held` is kept as an independent ledger of
//! BU that came in and went out, so the check compares two separately maintained numbers.

use crate::params::Params;
pub use curve_math::mul_div;
use curve_math::{
    fee_of, min_challenge_burn, payout, pool_buy, pool_sell, redeem, split_fee, Curve, CurveState,
    Redeem, BPS, E18,
};
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Curve,
    Index,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SimError {
    Insolvent { owed: u128, held: u128, after: &'static str },
    Unsupported(&'static str),
    /// Holders' token balances no longer add up to the coin's circulating supply.
    TokenLedger { holders: u128, circulating: u128 },
}

impl fmt::Display for SimError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            SimError::Insolvent { owed, held, after } => {
                write!(f, "solvency violated after {after}: owes {owed} raw BU, holds {held}")
            }
            SimError::Unsupported(what) => write!(f, "unsupported: {what}"),
            SimError::TokenLedger { holders, circulating } => {
                write!(f, "holders hold {holders} raw tokens but circulating is {circulating}")
            }
        }
    }
}

impl std::error::Error for SimError {}

pub type Result<T> = std::result::Result<T, SimError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bought {
    pub tokens: u128,
    /// BU the buyer actually paid, fee included, after any graduation refund.
    pub spent: u128,
}

/// Which way a sell was paid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    Curve,
    Pool,
    Redeem,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sold {
    pub bu_out: u128,
    pub path: Path,
}

#[derive(Clone, Debug)]
pub struct Coin {
    p: Params,
    curve: Curve,
    mode: Mode,
    /// reserve R, surplus S, sold = tokens held by holders (circulating).
    st: CurveState,
    creator_owed: u128,
    protocol_owed: u128,
    /// BU the vault holds: every BU in, minus every BU paid out.
    held: u128,
    /// Tokens destroyed by challenge and defend burns.
    burned: u128,
    /// Index mode: the pool's BU side and the coin's own tokens in it.
    pool_bu: u128,
    pool_tokens: u128,
    /// Tokens burned by redeems (Index mode).
    redeemed: u128,
}

impl Coin {
    pub fn new(p: Params) -> Coin {
        Coin {
            p,
            curve: p.curve,
            mode: Mode::Curve,
            st: CurveState::default(),
            creator_owed: 0,
            protocol_owed: 0,
            held: 0,
            burned: 0,
            pool_bu: 0,
            pool_tokens: 0,
            redeemed: 0,
        }
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Tokens in holders' hands.
    pub fn circulating(&self) -> u128 {
        self.st.sold
    }

    /// Total supply: holders' tokens plus, in Index mode, the pool's tokens.
    pub fn supply(&self) -> u128 {
        self.st.sold + self.pool_tokens
    }

    pub fn reserve(&self) -> u128 {
        self.st.reserve
    }

    pub fn pool_bu(&self) -> u128 {
        self.pool_bu
    }

    /// BU the coin owes: reserve + surplus + owed fees + pool.
    pub fn owed(&self) -> u128 {
        self.st.reserve + self.st.surplus + self.creator_owed + self.protocol_owed + self.pool_bu
    }

    pub fn vault_bu(&self) -> u128 {
        self.held
    }

    pub fn burned(&self) -> u128 {
        self.burned
    }

    pub fn redeemed(&self) -> u128 {
        self.redeemed
    }

    /// No sell pays less per token than this, before fees (BU per token, 1e18-scaled).
    /// Curve mode: `P0 + s`. Index mode: `reserve / supply`.
    pub fn floor(&self) -> u128 {
        match self.mode {
            Mode::Curve => self.curve.floor(&self.st),
            Mode::Index => mul_div(self.st.reserve, E18, self.supply()),
        }
    }

    /// Price of the next token (BU per token, 1e18-scaled). Curve mode: curve price plus `s`.
    /// Index mode: the pool's spot price.
    pub fn price(&self) -> u128 {
        match self.mode {
            Mode::Curve => self.curve.price(&self.st),
            Mode::Index => mul_div(self.pool_bu, E18, self.pool_tokens),
        }
    }

    fn check(&self, after: &'static str) -> Result<()> {
        let owed = self.owed();
        if owed > self.held {
            return Err(SimError::Insolvent { owed, held: self.held, after });
        }
        Ok(())
    }

    fn take_fee(&mut self, fee: u128) {
        let split = split_fee(fee);
        self.creator_owed += split.creator;
        self.protocol_owed += split.protocol;
        match self.mode {
            Mode::Curve => self.st.surplus += split.vault,
            Mode::Index => self.st.reserve += split.vault,
        }
    }

    pub fn buy(&mut self, bu_in: u128) -> Result<Bought> {
        let fee = fee_of(bu_in, self.p.fee_bps);
        let net = bu_in - fee;
        if self.mode == Mode::Index {
            let tokens = pool_buy(self.pool_bu, self.pool_tokens, net);
            self.held += bu_in;
            self.pool_bu += net;
            self.pool_tokens -= tokens;
            self.st.sold += tokens;
            self.take_fee(fee);
            self.check("pool buy")?;
            return Ok(Bought { tokens, spent: bu_in });
        }
        let b = self.curve.buy(&self.st, net);
        // A buy capped at graduation pays the fee only on the BU it used, grossed up from the net
        // the curve took, as contracts/coin/src/trade.rs does; the rest is refunded.
        let (spent, fee) = if b.graduates {
            let net_used = b.curve_cost + b.surplus_part;
            let spent = (net_used * BPS).div_ceil(BPS - self.p.fee_bps).min(bu_in);
            (spent, spent - net_used)
        } else {
            (bu_in, fee)
        };
        self.held += spent;
        self.st.reserve += b.curve_cost;
        self.st.surplus += b.surplus_part;
        self.st.sold += b.tokens;
        self.take_fee(fee);
        if b.graduates {
            self.graduate();
        }
        self.check("buy")?;
        Ok(Bought { tokens: b.tokens, spent })
    }

    /// Fair-launch window: every deposit pays its fee, the nets are pooled into one curve buy,
    /// and the tokens are split pro rata (rounded down; the last depositor gets the dust).
    pub fn fair_launch(&mut self, deposits: &[u128]) -> Result<Vec<Bought>> {
        if self.st.sold != 0 {
            return Err(SimError::Unsupported("fair launch on a coin that already traded"));
        }
        let mut nets = Vec::with_capacity(deposits.len());
        for &d in deposits {
            let fee = fee_of(d, self.p.fee_bps);
            self.take_fee(fee);
            self.held += d;
            nets.push(d - fee);
        }
        let total: u128 = nets.iter().sum();
        let b = self.curve.buy(&self.st, total);
        if b.graduates {
            return Err(SimError::Unsupported("fair launch that reaches graduation"));
        }
        self.st.reserve += b.curve_cost;
        self.st.surplus += b.surplus_part;
        self.st.sold += b.tokens;
        let mut out: Vec<Bought> = deposits
            .iter()
            .zip(&nets)
            .map(|(&d, &n)| Bought { tokens: payout(&[b.tokens], n, total)[0], spent: d })
            .collect();
        let given: u128 = out.iter().map(|o| o.tokens).sum();
        if let Some(last) = out.last_mut() {
            last.tokens += b.tokens - given;
        }
        self.check("fair_launch")?;
        Ok(out)
    }

    /// BU value a burn of `tokens` would count for, without burning.
    pub fn quote_burn(&self, tokens: u128) -> u128 {
        match self.mode {
            Mode::Curve => {
                let s = self.curve.sell(&self.st, tokens);
                s.curve_out + s.surplus_out
            }
            Mode::Index => redeem(tokens, self.st.reserve, self.supply(), 0).gross,
        }
    }

    /// Challenge or defend burn: the tokens' curve value moves from reserve to surplus, so every
    /// remaining holder's `s` rises. Returns the burn's BU value (what the tally counts).
    /// In Index mode supply falls and the reserve stays, so the floor rises; the burn's value
    /// is the tokens' share of the reserve.
    pub fn burn(&mut self, tokens: u128) -> Result<u128> {
        if self.mode == Mode::Index {
            let value = self.quote_burn(tokens);
            self.st.sold -= tokens;
            self.burned += tokens;
            self.check("burn")?;
            return Ok(value);
        }
        let s = self.curve.sell(&self.st, tokens);
        self.st.reserve -= s.curve_out;
        self.st.surplus += s.curve_out;
        self.st.sold -= tokens;
        self.burned += tokens;
        self.check("burn")?;
        Ok(s.curve_out + s.surplus_out)
    }

    /// 20% of R + S seeds the pool (pool tokens minted at the last price), 80% becomes reserve.
    fn graduate(&mut self) {
        let g = self.curve.graduate(&self.st, self.p.pool_share_bps);
        self.pool_bu = g.pool_bu;
        self.pool_tokens = g.pool_tokens;
        self.st.reserve = g.reserve;
        self.st.surplus = 0;
        self.mode = Mode::Index;
    }

    /// Creator and protocol withdraw what they are owed. Returns the BU paid out.
    pub fn claim_fees(&mut self) -> Result<u128> {
        let paid = self.creator_owed + self.protocol_owed;
        self.creator_owed = 0;
        self.protocol_owed = 0;
        self.held -= paid;
        self.check("claim_fees")?;
        Ok(paid)
    }

    /// Smallest winning challenge tally (BU) on a slot of `weight_bps`: 3% of its share of B_total.
    pub fn challenge_minimum(&self, weight_bps: u128) -> u128 {
        min_challenge_burn(self.owed(), weight_bps, self.p.challenge_min_bps)
    }

    /// Surplus per circulating token (BU per token, 1e18-scaled); zero in Index mode.
    pub fn surplus_per_token(&self) -> u128 {
        self.curve.surplus_per_token(&self.st)
    }

    /// The swap after a winning challenge costs the vault the solver's cut, in BU. Curve mode
    /// takes it from surplus: the reserve is the curve's own position and cannot fall without
    /// breaking `x * y >= k`. Index mode shares it pro rata between reserve and pool.
    pub fn swap_loss(&mut self, bu: u128) -> Result<()> {
        match self.mode {
            Mode::Curve => {
                if bu > self.st.surplus {
                    return Err(SimError::Unsupported("swap loss larger than the surplus"));
                }
                self.st.surplus -= bu;
            }
            Mode::Index => {
                let from_reserve = mul_div(bu, self.st.reserve, self.st.reserve + self.pool_bu);
                self.st.reserve -= from_reserve;
                self.pool_bu -= bu - from_reserve;
            }
        }
        self.held -= bu;
        self.check("swap loss")
    }

    /// Curve mode: sell back to the curve. Index mode: the seller gets the larger of the pool's
    /// output after the fee and the redeem value after the 0.5% redeem fee.
    pub fn sell(&mut self, tokens: u128) -> Result<Sold> {
        if self.mode == Mode::Index {
            let pool_gross = pool_sell(self.pool_bu, self.pool_tokens, tokens);
            let pool_fee = fee_of(pool_gross, self.p.fee_bps);
            let r = self.quote_redeem(tokens);
            if r.out > pool_gross - pool_fee {
                return Ok(Sold { bu_out: self.redeem(tokens)?, path: Path::Redeem });
            }
            self.pool_bu -= pool_gross;
            self.pool_tokens += tokens;
            self.st.sold -= tokens;
            self.take_fee(pool_fee);
            self.held -= pool_gross - pool_fee;
            self.check("pool sell")?;
            return Ok(Sold { bu_out: pool_gross - pool_fee, path: Path::Pool });
        }
        let s = self.curve.sell(&self.st, tokens);
        let gross = s.curve_out + s.surplus_out;
        let fee = fee_of(gross, self.p.fee_bps);
        self.st.reserve -= s.curve_out;
        self.st.surplus -= s.surplus_out;
        self.st.sold -= tokens;
        self.take_fee(fee);
        self.held -= gross - fee;
        self.check("sell")?;
        Ok(Sold { bu_out: gross - fee, path: Path::Curve })
    }

    fn quote_redeem(&self, tokens: u128) -> Redeem {
        redeem(tokens, self.st.reserve, self.supply(), self.p.redeem_fee_bps)
    }

    /// Index mode: burn `tokens` for their share of the reserve; the 0.5% fee stays in it.
    pub fn redeem(&mut self, tokens: u128) -> Result<u128> {
        if self.mode != Mode::Index {
            return Err(SimError::Unsupported("redeem before graduation"));
        }
        let r = self.quote_redeem(tokens);
        self.st.reserve -= r.out;
        self.st.sold -= tokens;
        self.redeemed += tokens;
        self.held -= r.out;
        self.check("redeem")?;
        Ok(r.out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::Params;

    fn coin() -> Coin {
        Coin::new(Params::from_constants())
    }

    /// Whole BU (or tokens) as a float, for tolerance checks against hand-worked numbers.
    fn whole(raw: u128) -> f64 {
        raw as f64 / E18 as f64
    }

    #[test]
    fn a_lone_holder_who_buys_1000_bu_and_sells_everything_gets_983_07_bu() {
        let mut c = coin();
        let bought = c.buy(1_000 * E18).unwrap();
        let sold = c.sell(bought.tokens).unwrap();
        // Buy: fee 10, net 990 on the curve, vault share 3 BU to surplus. The only holder owns
        // all of it: gross = 990 + 3 = 993, minus the 1% sell fee = 983.07.
        assert!((whole(sold.bu_out) - 983.07).abs() < 1e-9, "got {}", whole(sold.bu_out));
        assert_eq!(c.circulating(), 0);
        // What stays: 1,000 - 983.07 = 16.93 BU of fees (owed fees plus the sell's vault share).
        assert!((whole(c.vault_bu()) - 16.93).abs() < 1e-9);
        assert_eq!(c.owed(), c.vault_bu(), "no BU created or lost");
    }

    #[test]
    fn fair_launch_deposits_of_100_and_300_bu_pay_the_same_average_price() {
        let mut c = coin();
        let got = c.fair_launch(&[100 * E18, 300 * E18]).unwrap();
        // One pooled buy: 400 in, 4 fee, 396 net. 1,073,000,000 * 396 / 5,396 = 78,744,996.29 tokens,
        // split 1:3 by deposit.
        assert!((whole(got[0].tokens) - 19_686_249.073).abs() < 1e-2, "{}", whole(got[0].tokens));
        assert!((whole(got[1].tokens) - 59_058_747.220).abs() < 1e-2, "{}", whole(got[1].tokens));
        assert_eq!(got[0].tokens + got[1].tokens, c.circulating(), "the last depositor gets the dust");
        assert_eq!(got[1].spent, 300 * E18);
    }

    #[test]
    fn burning_a_tenth_of_supply_moves_its_curve_value_to_surplus_and_lifts_the_floor() {
        let mut c = coin();
        let b = c.buy(1_000 * E18).unwrap();
        let vault = c.vault_bu();
        // Worked in exact rationals: 177,340,567.61 tokens out, surplus 3 BU, floor 4.67675e-6.
        assert!((whole(c.floor()) - 4.676748849e-6).abs() < 1e-14);
        let value = c.burn(b.tokens / 10).unwrap();
        // curve_out = 116.299 BU moves to surplus; the burn's value adds the 0.3 BU surplus share.
        assert!((whole(value) - 116.599274).abs() < 1e-6, "{}", whole(value));
        assert!((whole(c.floor()) - 5.407290941e-6).abs() < 1e-14, "{}", whole(c.floor()));
        assert_eq!(c.vault_bu(), vault, "a burn pays nobody");
        assert_eq!(c.circulating(), b.tokens - b.tokens / 10);
        assert_eq!(c.burned(), b.tokens / 10);
    }

    #[test]
    fn a_25000_bu_buy_graduates_and_pays_the_fee_only_on_the_bu_it_used() {
        let mut c = coin();
        let b = c.buy(25_000 * E18).unwrap();
        // As in contracts/coin trade.rs: the curve takes 20,000 net, so the buyer pays
        // 20,000 / 0.99 = 20,202.02 (fee 202.02) and the rest is refunded.
        assert!((whole(b.spent) - 20_202.020202).abs() < 1e-6, "{}", whole(b.spent));
        assert_eq!(b.tokens, 858_400_000 * E18);
        assert_eq!(c.mode(), Mode::Index);
        // Backing = 20,000 reserve + 60.61 BU vault fee share: pool 20%, reserve 80%.
        assert!((whole(c.pool_bu()) - 4_012.121212).abs() < 1e-6, "{}", whole(c.pool_bu()));
        assert!((whole(c.reserve()) - 16_048.484848).abs() < 1e-6, "{}", whole(c.reserve()));
        // Pool tokens = pool BU / last price (25,000/214.6M + 60.61/858.4M) = 34,419,188.4.
        assert!((whole(c.supply()) - 892_819_188.37).abs() < 0.1, "{}", whole(c.supply()));
        assert_eq!(c.circulating(), 858_400_000 * E18);
        assert!((whole(c.floor()) - 1.79750671e-5).abs() < 1e-13, "{}", whole(c.floor()));
        assert!((whole(c.price()) - 1.16566410e-4).abs() < 1e-12, "{}", whole(c.price()));
        assert_eq!(c.owed(), c.vault_bu());
    }

    fn graduated() -> Coin {
        let mut c = coin();
        c.buy(25_000 * E18).unwrap();
        c
    }

    #[test]
    fn after_graduation_a_small_sell_goes_through_the_pool_and_supply_is_unchanged() {
        let mut c = graduated();
        let supply = c.supply();
        let sold = c.sell(10_000_000 * E18).unwrap();
        // Pool pays 894.21 after the fee; redeeming would pay only 178.85.
        assert!((whole(sold.bu_out) - 894.208144).abs() < 1e-5, "{}", whole(sold.bu_out));
        assert_eq!(sold.path, Path::Pool);
        assert_eq!(c.supply(), supply, "the tokens went into the pool");
        // The floor moves only by the fee's vault share landing in the reserve.
        assert!((whole(c.floor()) - 1.79781022e-5).abs() < 1e-13, "{}", whole(c.floor()));
        assert_eq!(c.owed(), c.vault_bu());
    }

    #[test]
    fn a_sell_bigger_than_the_pool_can_pay_redeems_and_lifts_the_floor() {
        let mut c = graduated();
        let supply = c.supply();
        let sold = c.sell(400_000_000 * E18).unwrap();
        // Redeem: 400M * 16,048.48 / 892.82M = 7,190.03 less 0.5% = 7,154.08; the pool would pay 3,657.30.
        assert!((whole(sold.bu_out) - 7_154.076719).abs() < 1e-5, "{}", whole(sold.bu_out));
        assert_eq!(sold.path, Path::Redeem);
        assert_eq!(c.supply(), supply - 400_000_000 * E18);
        assert_eq!(c.redeemed(), 400_000_000 * E18);
        assert!((whole(c.floor()) - 1.80480151e-5).abs() < 1e-13, "{}", whole(c.floor()));
        assert_eq!(c.owed(), c.vault_bu());
    }

    #[test]
    fn a_pool_buy_after_graduation_gets_pool_tokens_at_the_pool_price() {
        let mut c = graduated();
        let (pool, reserve) = (c.pool_bu(), c.reserve());
        let b = c.buy(100 * E18).unwrap();
        // 99 BU net into a 4,012.12 BU / 34,419,188.4 token pool: 34,419,188.4 * 99 / 4,111.12.
        assert!((whole(b.tokens) - 828_849.23).abs() < 0.01, "{}", whole(b.tokens));
        assert_eq!(c.pool_bu(), pool + 99 * E18);
        assert_eq!(c.reserve(), reserve + 3 * E18 / 10, "the vault's fee share joins the reserve");
        assert_eq!(c.owed(), c.vault_bu());
    }

    #[test]
    fn an_index_mode_burn_keeps_the_reserve_and_lifts_the_floor() {
        let mut c = graduated();
        let reserve = c.reserve();
        let value = c.burn(100_000_000 * E18).unwrap();
        // Value = 100M * 16,048.48 / 892.82M = 1,797.51 BU; floor = 16,048.48 / 792.82M.
        assert!((whole(value) - 1_797.507).abs() < 1e-3, "{}", whole(value));
        assert_eq!(c.reserve(), reserve);
        assert!((whole(c.floor()) - 2.0242301e-5).abs() < 1e-12, "{}", whole(c.floor()));
        assert_eq!(c.burned(), 100_000_000 * E18);
    }

    #[test]
    fn a_swap_loss_in_curve_mode_comes_out_of_surplus_and_the_vault() {
        let mut c = coin();
        let b = c.buy(1_000 * E18).unwrap();
        c.burn(b.tokens / 10).unwrap();
        let (vault, reserve) = (c.vault_bu(), c.reserve());
        c.swap_loss(10 * E18).unwrap();
        assert_eq!(c.vault_bu(), vault - 10 * E18);
        assert_eq!(c.reserve(), reserve, "the curve's reserve is untouched, so x * y >= k holds");
        // Surplus 119.30 -> 109.30 BU over 159,606,510.85 tokens: floor 4.6598e-6 + 6.8481e-7.
        assert!((whole(c.floor()) - 5.3446369e-6).abs() < 1e-12, "{}", whole(c.floor()));
        assert_eq!(c.owed(), c.vault_bu());
    }

    #[test]
    fn a_swap_loss_bigger_than_the_surplus_is_an_error() {
        let mut c = coin();
        c.buy(1_000 * E18).unwrap();
        assert!(c.swap_loss(10 * E18).is_err(), "surplus is only 3 BU");
    }

    #[test]
    fn a_swap_loss_in_index_mode_is_shared_by_reserve_and_pool_4_to_1() {
        let mut c = graduated();
        c.swap_loss(201 * E18).unwrap();
        // 201 BU split 80/20 like the backing: 160.8 from the reserve, 40.2 from the pool.
        assert!((whole(c.reserve()) - 15_887.684848).abs() < 1e-6, "{}", whole(c.reserve()));
        assert!((whole(c.pool_bu()) - 3_971.921212).abs() < 1e-6, "{}", whole(c.pool_bu()));
        assert_eq!(c.owed(), c.vault_bu());
    }

    #[test]
    fn claiming_fees_pays_the_creator_5_and_protocol_2_of_a_1000_bu_buy() {
        let mut c = coin();
        c.buy(1_000 * E18).unwrap();
        assert_eq!(c.claim_fees().unwrap(), 7 * E18);
        assert_eq!(c.vault_bu(), 993 * E18);
        assert_eq!(c.owed(), c.vault_bu());
    }

    #[test]
    fn a_challenge_on_a_half_weight_seat_must_burn_3_percent_of_half_the_vault() {
        let mut c = coin();
        c.buy(1_000 * E18).unwrap();
        c.claim_fees().unwrap();
        // 993 BU * 50% * 3% = 14.895 BU.
        assert_eq!(c.challenge_minimum(5_000), 14_895 * E18 / 1_000);
    }
}
