//! Pure math for the coin: curve, two-part price, pool, basket units.
//! Every division rounds toward the vault.

uint::construct_uint! {
    pub struct U256(4);
}

fn u(v: u128) -> U256 {
    U256::from(v)
}

fn to_u128(v: U256) -> u128 {
    assert!(v <= U256::from(u128::MAX), "overflow");
    v.as_u128()
}

fn div_ceil(a: U256, b: U256) -> U256 {
    let (q, r) = a.div_mod(b);
    if r.is_zero() { q } else { q + 1 }
}

/// Virtual-reserve constant-product curve, in raw units (BU and tokens both 1e18).
#[derive(Clone, Copy, Debug)]
pub struct Curve {
    pub x0: u128,
    pub y0: u128,
    pub grad_reserve: u128,
}

/// R (BU the curve owes holders), S (surplus BU), sold (curve position = circulating supply).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CurveState {
    pub reserve: u128,
    pub surplus: u128,
    pub sold: u128,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Buy {
    pub tokens: u128,
    pub curve_cost: u128,
    pub surplus_part: u128,
    /// BU of `net` not spent because the buy hit graduation; refund it.
    pub unused: u128,
    pub graduates: bool,
}

impl Curve {
    fn k(&self) -> U256 {
        u(self.x0) * u(self.y0)
    }

    /// Spend `net` BU (after fees). Returns tokens out and how `net` splits between curve and surplus.
    pub fn buy(&self, st: &CurveState, net: u128) -> Buy {
        let x = u(self.x0) + u(st.reserve);
        let y = u(self.y0) - u(st.sold);
        let k = self.k();
        // Curve part of buying t tokens, rounded up.
        let curve_cost = |t: U256| div_ceil(k, y - t) - x;
        // Surplus part: the buyer pays in s = S / C per token, rounded up.
        let surplus_cost = |t: U256| {
            if st.sold == 0 { U256::zero() } else { div_ceil(u(st.surplus) * t, u(st.sold)) }
        };
        let cost = |t: U256| curve_cost(t) + surplus_cost(t);
        // Tokens left before graduation: the curve stops at x = x0 + grad_reserve.
        let y_grad = div_ceil(k, u(self.x0) + u(self.grad_reserve));
        let t_max = y - y_grad;
        let max_cost = cost(t_max);
        if max_cost <= u(net) {
            let cc = to_u128(curve_cost(t_max));
            let spent = to_u128(max_cost);
            return Buy {
                tokens: to_u128(t_max),
                curve_cost: cc,
                surplus_part: spent - cc,
                unused: net - spent,
                graduates: true,
            };
        }
        // Largest t with cost(t) <= net; cost is increasing in t, and cost(t_max) > net.
        let (mut lo, mut hi) = (U256::zero(), t_max);
        while hi - lo > U256::one() {
            let mid = (lo + hi) / 2;
            if cost(mid) <= u(net) { lo = mid } else { hi = mid }
        }
        let cc = to_u128(curve_cost(lo));
        Buy { tokens: to_u128(lo), curve_cost: cc, surplus_part: net - cc, unused: 0, graduates: false }
    }

    /// Sell `tokens` back. Gross BU before fees, split into the curve part and the surplus part.
    pub fn sell(&self, st: &CurveState, tokens: u128) -> Sell {
        let x = u(self.x0) + u(st.reserve);
        let y = u(self.y0) - u(st.sold);
        let x_after = div_ceil(self.k(), y + u(tokens));
        let surplus_out = if st.sold == 0 { 0 } else { to_u128(u(st.surplus) * u(tokens) / u(st.sold)) };
        Sell { curve_out: to_u128(x - x_after), surplus_out }
    }

    /// Surplus per circulating token, BU per token scaled 1e18.
    pub fn surplus_per_token(&self, st: &CurveState) -> u128 {
        if st.sold == 0 { 0 } else { to_u128(u(st.surplus) * u(E18) / u(st.sold)) }
    }

    /// Price of the next token: curve price plus surplus per token, BU per token scaled 1e18.
    pub fn price(&self, st: &CurveState) -> u128 {
        let x = u(self.x0) + u(st.reserve);
        let y = u(self.y0) - u(st.sold);
        to_u128(x * u(E18) / y) + self.surplus_per_token(st)
    }

    /// No sell pays less per token than this (before fees): the curve's lowest price plus `s`.
    pub fn floor(&self, st: &CurveState) -> u128 {
        to_u128(u(self.x0) * u(E18) / u(self.y0)) + self.surplus_per_token(st)
    }
}

pub const E18: u128 = 1_000_000_000_000_000_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Graduation {
    pub pool_bu: u128,
    pub reserve: u128,
    pub pool_tokens: u128,
}

impl Curve {
    /// Split R + S into the pool's share and the holders' reserve; mint pool tokens at the
    /// last price, rounded up so fewer tokens dilute holders.
    pub fn graduate(&self, st: &CurveState, pool_share_bps: u128) -> Graduation {
        let backing = st.reserve + st.surplus;
        let pool_bu = backing * pool_share_bps / BPS;
        let x = u(self.x0) + u(st.reserve);
        let y = u(self.y0) - u(st.sold);
        let mut p_last = div_ceil(x * u(E18), y);
        if st.sold > 0 {
            p_last += div_ceil(u(st.surplus) * u(E18), u(st.sold));
        }
        let pool_tokens = to_u128(u(pool_bu) * u(E18) / p_last);
        Graduation { pool_bu, reserve: backing - pool_bu, pool_tokens }
    }
}

/// floor(a * b / c) without overflowing u128 in the product.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    to_u128(u(a) * u(b) / u(c))
}

/// ceil(a * b / c) without overflowing u128 in the product.
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    to_u128(div_ceil(u(a) * u(b), u(c)))
}

/// Tokens out of the pool for `net` BU in.
pub fn pool_buy(x_p: u128, y_p: u128, net: u128) -> u128 {
    let k = u(x_p) * u(y_p);
    to_u128(u(y_p) - div_ceil(k, u(x_p) + u(net)))
}

/// BU out of the pool for `tokens` in (before fees).
pub fn pool_sell(x_p: u128, y_p: u128, tokens: u128) -> u128 {
    let k = u(x_p) * u(y_p);
    to_u128(u(x_p) - div_ceil(k, u(y_p) + u(tokens)))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Redeem {
    pub gross: u128,
    pub fee: u128,
    pub out: u128,
}

/// BU credited for the amounts sent: limited by the scarcest asset relative to `q`.
pub fn bu_from_amounts(amounts: &[u128], q: &[u128]) -> u128 {
    assert_eq!(amounts.len(), q.len(), "basket mismatch");
    amounts
        .iter()
        .zip(q)
        .map(|(a, qi)| to_u128(u(*a) * u(E18) / u(*qi)))
        .min()
        .unwrap_or(0)
}

/// Amount of each asset needed for `bu` basket units, rounded up.
pub fn amounts_for_bu(bu: u128, q: &[u128]) -> Vec<u128> {
    q.iter().map(|qi| to_u128(div_ceil(u(bu) * u(*qi), u(E18)))).collect()
}

/// What `bu` basket units pay out of `held`, when `b_total` units exist; rounded down.
pub fn payout(held: &[u128], bu: u128, b_total: u128) -> Vec<u128> {
    held.iter().map(|h| to_u128(u(*h) * u(bu) / u(b_total))).collect()
}

/// Dutch auction rate (replacement raw units per target raw unit, scaled 1e18): starts
/// `premium_bps` above fair and falls linearly to fair over `len`, then stays at fair.
pub fn auction_rate(fair: u128, premium_bps: u128, start: u64, len: u64, now: u64) -> u128 {
    let end = start + len;
    if now >= end || len == 0 {
        return fair;
    }
    let remaining = u((end - now.max(start)) as u128);
    let extra = div_ceil(u(fair) * u(premium_bps) * remaining, u(BPS) * u(len as u128));
    to_u128(u(fair) + extra)
}

/// Fair rate from USD prices per raw unit (same scale): replacement units per target unit, 1e18, up.
pub fn fair_rate(p_target: u128, p_replacement: u128) -> u128 {
    to_u128(div_ceil(u(p_target) * u(E18), u(p_replacement)))
}

/// Target units a bidder gets for `amount_in` replacement units at `rate`, rounded down.
pub fn auction_out(amount_in: u128, rate: u128) -> u128 {
    to_u128(u(amount_in) * u(E18) / u(rate))
}

/// Smallest winning challenge: `min_bps` of the slot's share of the vault, rounded up.
pub fn min_challenge_burn(b_total: u128, weight_bps: u128, min_bps: u128) -> u128 {
    to_u128(div_ceil(u(b_total) * u(weight_bps) * u(min_bps), u(BPS) * u(BPS)))
}

/// Burn `tokens` for their share of `reserve`; the fee stays in the reserve.
pub fn redeem(tokens: u128, reserve: u128, supply: u128, fee_bps: u128) -> Redeem {
    let gross = to_u128(u(reserve) * u(tokens) / u(supply));
    let fee = fee_of(gross, fee_bps);
    Redeem { gross, fee, out: gross - fee }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Sell {
    pub curve_out: u128,
    pub surplus_out: u128,
}

pub const BPS: u128 = 10_000;
pub const SPLIT_CREATOR_BPS: u128 = 5_000;
pub const SPLIT_VAULT_BPS: u128 = 3_000;

/// Trade fee on `amount`, rounded up.
pub fn fee_of(amount: u128, fee_bps: u128) -> u128 {
    to_u128(div_ceil(u(amount) * u(fee_bps), u(BPS)))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FeeSplit {
    pub creator: u128,
    pub vault: u128,
    pub protocol: u128,
}

/// Creator 50% (down), vault 30% (up), protocol the rest.
pub fn split_fee(fee: u128) -> FeeSplit {
    let vault = to_u128(div_ceil(u(fee) * u(SPLIT_VAULT_BPS), u(BPS)));
    let creator = fee * SPLIT_CREATOR_BPS / BPS;
    FeeSplit { creator, vault, protocol: fee - vault - creator }
}

#[cfg(test)]
mod tests {
    use super::*;



    fn spec_curve() -> Curve {
        Curve { x0: 5_000 * E18, y0: 1_073_000_000 * E18, grad_reserve: 20_000 * E18 }
    }

    #[test]
    fn buying_1000_bu_on_a_fresh_curve_gives_the_spec_vector() {
        let c = spec_curve();
        let b = c.buy(&CurveState::default(), 1_000 * E18);
        assert_eq!(b.tokens, 178_833_333_333_333_333_333_333_333);
        assert_eq!(b.curve_cost, 1_000 * E18);
        assert_eq!(b.surplus_part, 0);
        assert!(!b.graduates);
    }

    /// State after the spec's two buys (1,000 BU then 4,000 BU, no fees).
    fn after_two_buys() -> CurveState {
        CurveState {
            reserve: 5_000 * E18,
            surplus: 0,
            sold: 178_833_333_333_333_333_333_333_333 + 357_666_666_666_666_666_666_666_667,
        }
    }

    #[test]
    fn second_buy_of_4000_bu_gives_the_spec_vector() {
        let c = spec_curve();
        let first = CurveState { reserve: 1_000 * E18, surplus: 0, sold: 178_833_333_333_333_333_333_333_333 };
        assert_eq!(c.buy(&first, 4_000 * E18).tokens, 357_666_666_666_666_666_666_666_667);
    }

    #[test]
    fn selling_the_first_buyers_tokens_after_both_buys_pays_2500_bu_rounded_down() {
        let c = spec_curve();
        let s = c.sell(&after_two_buys(), 178_833_333_333_333_333_333_333_333);
        // Exact value is 2,500 BU minus a sub-wei remainder; rounding toward the vault drops 1 wei.
        assert_eq!(s.curve_out, 2_500 * E18 - 1);
        assert_eq!(s.surplus_out, 0);
    }

    #[test]
    fn a_seller_takes_their_pro_rata_share_of_the_surplus_rounded_down() {
        let c = spec_curve();
        let st = CurveState { surplus: 1_000 * E18, ..after_two_buys() };
        // 178,833,333.33.. of 536,500,000 tokens is a third minus 1 wei of tokens:
        // 1,000 BU * that fraction = 333.333.. BU, floored.
        let s = c.sell(&st, 178_833_333_333_333_333_333_333_333);
        assert_eq!(s.surplus_out, 333_333_333_333_333_333_333);
        assert_eq!(s.curve_out, 2_500 * E18 - 1);
    }

    #[test]
    fn a_buyer_pays_the_curve_plus_the_current_surplus_per_token() {
        // Expected values from scratchpad/twopart.py: exact rational arithmetic, the quadratic's
        // continuous root, then a local bisection for the largest t with
        // ceil(k/(y-t)) - x + ceil(S*t/C) <= net.
        let c = spec_curve();
        let st = CurveState { surplus: 1_000 * E18, ..after_two_buys() };
        let b = c.buy(&st, 1_000 * E18);
        assert_eq!(b.tokens, 45_023_196_367_055_993_162_613_590);
        assert_eq!(b.curve_cost, 916_079_783_099_616_042_567);
        assert_eq!(b.surplus_part, 83_920_216_900_383_957_433);
    }

    #[test]
    fn a_buy_past_graduation_is_capped_at_858_4m_tokens_and_returns_the_rest() {
        let c = spec_curve();
        let b = c.buy(&CurveState::default(), 25_000 * E18);
        assert_eq!(b.tokens, 858_400_000 * E18);
        assert_eq!(b.curve_cost, 20_000 * E18);
        assert_eq!(b.surplus_part, 0);
        assert_eq!(b.unused, 5_000 * E18);
        assert!(b.graduates);
    }

    #[test]
    fn a_buy_that_stops_short_of_graduation_uses_everything() {
        let b = spec_curve().buy(&CurveState::default(), 19_999 * E18);
        assert!(!b.graduates);
        assert_eq!(b.unused, 0);
    }

    #[test]
    fn a_1_percent_fee_on_1000_bu_is_10_bu_split_5_3_2() {
        assert_eq!(fee_of(1_000 * E18, 100), 10 * E18);
        assert_eq!(split_fee(10 * E18), FeeSplit { creator: 5 * E18, vault: 3 * E18, protocol: 2 * E18 });
    }

    #[test]
    fn fees_round_toward_the_vault() {
        // 1 wei at 1% still costs 1 wei; a 7-wei fee gives the vault ceil(2.1) = 3, creator floor(3.5) = 3.
        assert_eq!(fee_of(1, 100), 1);
        assert_eq!(split_fee(7), FeeSplit { creator: 3, vault: 3, protocol: 1 });
    }

    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2_000))]
        /// Buying and immediately selling never returns more BU than was paid in,
        /// whatever the surplus: the two-part price closes the "grab the surplus" exploit.
        #[test]
        fn buy_then_sell_never_profits(
            first_bu in 1u128..19_000,
            surplus_bu in 0u128..10_000,
            net_wei in 1u128..(5_000 * E18),
        ) {
            let c = spec_curve();
            let first = c.buy(&CurveState::default(), first_bu * E18);
            let st = CurveState { reserve: first.curve_cost, surplus: surplus_bu * E18, sold: first.tokens };
            let b = c.buy(&st, net_wei);
            let after = CurveState {
                reserve: st.reserve + b.curve_cost,
                surplus: st.surplus + b.surplus_part,
                sold: st.sold + b.tokens,
            };
            let s = c.sell(&after, b.tokens);
            prop_assert!(s.curve_out + s.surplus_out <= net_wei - b.unused);
            // The remaining holders' surplus per token never falls.
            let left = CurveState { reserve: after.reserve - s.curve_out, surplus: after.surplus - s.surplus_out, sold: st.sold };
            prop_assert!(U256::from(left.surplus) * U256::from(st.sold) >= U256::from(st.surplus) * U256::from(left.sold));
        }
    }

    #[test]
    fn price_is_the_curve_price_plus_surplus_per_token() {
        let c = spec_curve();
        // 5,000 / 1,073,000,000 BU per token, scaled by 1e18 and floored.
        assert_eq!(c.price(&CurveState::default()), 4_659_832_246_039);
        let at_grad = CurveState { reserve: 20_000 * E18, surplus: 858_400 * E18 / 1_000, sold: 858_400_000 * E18 };
        // 25,000 / 214,600,000 = 1.16495806150978e-4, plus s = 1e-6.
        assert_eq!(c.price(&at_grad), 116_495_806_150_978 + 1_000_000_000_000);
    }

    #[test]
    fn the_floor_is_the_lowest_curve_price_plus_surplus_per_token() {
        let c = spec_curve();
        let st = CurveState { reserve: 20_000 * E18, surplus: 858_400 * E18 / 1_000, sold: 858_400_000 * E18 };
        assert_eq!(c.floor(&st), 4_659_832_246_039 + 1_000_000_000_000);
    }

    // Expected values for graduation, pool and redeem come from exact integer arithmetic
    // in Python (scratchpad), following the spec's rounding rules.
    fn at_graduation() -> CurveState {
        CurveState { reserve: 20_000 * E18, surplus: 0, sold: 858_400_000 * E18 }
    }

    #[test]
    fn graduation_puts_20_percent_in_the_pool_at_the_last_price() {
        let g = spec_curve().graduate(&at_graduation(), 2_000);
        assert_eq!(g.pool_bu, 4_000 * E18);
        assert_eq!(g.reserve, 16_000 * E18);
        // Spec vector: about 34,336,000 tokens; the last price is rounded up, so slightly fewer.
        assert_eq!(g.pool_tokens, 34_335_999_999_999_871_720_704_000);
    }

    #[test]
    fn the_pool_is_a_constant_product_rounded_toward_the_pool() {
        let (x_p, y_p) = (4_000 * E18, 34_335_999_999_999_871_720_704_000);
        assert_eq!(pool_buy(x_p, y_p, 100 * E18), 837_463_414_634_143_212_700_097);
        assert_eq!(pool_sell(x_p, y_p, 1_000_000 * E18), 113_199_003_848_766_541_801);
    }

    #[test]
    fn redeeming_pays_a_pro_rata_share_of_the_reserve_minus_half_a_percent() {
        let supply = 858_400_000 * E18 + 34_335_999_999_999_871_720_704_000;
        let r = redeem(1_000_000 * E18, 16_000 * E18, supply, 50);
        assert_eq!(r.gross, 17_922_431_715_535_166_386);
        assert_eq!(r.fee, 89_612_158_577_675_832);
        assert_eq!(r.out, 17_832_819_556_957_490_554);
    }

    #[test]
    fn a_buyer_gets_credit_for_the_scarcest_asset_and_a_refund_of_the_rest() {
        // q: 1,000 sats and 500,000 micro-USDC per BU. Sent: 2,500 sats, 1,000,000 micro-USDC.
        let q = [1_000, 500_000];
        assert_eq!(bu_from_amounts(&[2_500, 1_000_000], &q), 2 * E18);
        assert_eq!(amounts_for_bu(2 * E18, &q), vec![2_000, 1_000_000]);
        // Any fraction of a raw unit is charged as a whole unit.
        assert_eq!(amounts_for_bu(1, &q), vec![1, 1]);
    }

    #[test]
    fn payouts_are_a_pro_rata_share_of_what_is_held_rounded_down() {
        assert_eq!(payout(&[3_000, 1_500_000], E18, 3 * E18), vec![1_000, 500_000]);
        assert_eq!(payout(&[3_000, 1_500_000], E18, 7 * E18), vec![428, 214_285]);
    }

    #[test]
    fn the_auction_starts_20_percent_above_fair_and_falls_to_fair() {
        let fair = 2 * E18;
        assert_eq!(auction_rate(fair, 2_000, 1_000, 100, 1_000), 2_400_000_000_000_000_000);
        assert_eq!(auction_rate(fair, 2_000, 1_000, 100, 1_050), 2_200_000_000_000_000_000);
        assert_eq!(auction_rate(fair, 2_000, 1_000, 100, 1_100), fair);
        assert_eq!(auction_rate(fair, 2_000, 1_000, 100, 9_999), fair);
    }

    #[test]
    fn the_fair_rate_converts_usd_prices_per_raw_unit() {
        // A sat at $0.001 and a micro-USDC at $0.000001, both scaled by 1e36: 1,000 micro-USDC per sat.
        assert_eq!(fair_rate(1_000_000_000_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000_000), 1_000 * E18);
        // At 2.4 replacement units per target unit, 1,000 in buys 416 target units (rounded down).
        assert_eq!(auction_out(1_000, 2_400_000_000_000_000_000), 416);
    }

    #[test]
    fn a_challenge_must_burn_at_least_3_percent_of_the_slot() {
        // 10,000 BU vault, a 50% slot: 3% of 5,000 BU = 150 BU.
        assert_eq!(min_challenge_burn(10_000 * E18, 5_000, 300), 150 * E18);
    }

    #[test]
    fn mul_div_handles_products_beyond_u128() {
        // 4e21 * 1e18 overflows u128; the result does not.
        assert_eq!(mul_div(4_000 * E18, E18, 2 * E18), 2_000 * E18);
    }

    #[test]
    fn mul_div_ceil_rounds_up_only_when_inexact() {
        assert_eq!(mul_div_ceil(10, 3, 5), 6);
        assert_eq!(mul_div_ceil(10, 3, 4), 8);
    }
}
