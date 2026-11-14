//! Tests at the coin's public seam: its change methods and views, in the near-sdk unit VM.
//! Expected numbers come from exact integer arithmetic done separately (Python), from the
//! spec's worked examples, or from hand calculation noted beside them.

use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use near_sdk::serde_json::Value;

const COIN: &str = "degen-0.factory.testnet";
const FACTORY: &str = "factory.testnet";
const VERIFIER: &str = "intents.testnet";
const REPORTER: &str = "reporter.testnet";
const BTC: &str = "nep141:btc.mock";
const USDC: &str = "nep141:usdc.mock";
const SOL: &str = "nep141:sol.mock";
// Per BU: 1,000 sats and 500,000 micro-USDC.
const Q_BTC: u128 = 1_000;
const Q_USDC: u128 = 500_000;
const WINDOW_END: u64 = 120_000; // demo profile

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn at(who: &str, ms: u64, yocto: u128) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(acc(COIN))
        .predecessor_account_id(acc(who))
        .block_timestamp(ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .build());
}

fn new_coin() -> Coin {
    // Each test (and each proptest case) starts from empty storage.
    near_sdk::mock::with_mocked_blockchain(|b| {
        let _ = b.take_storage();
    });
    at(FACTORY, 0, 0);
    Coin::new(CoinInit {
        ticker: "DEGEN".into(),
        name: "Degen".into(),
        icon: None,
        basket: vec![
            BasketInput { token_id: BTC.into(), weight_bps: 5_000, q: U128(Q_BTC), anchored: true },
            BasketInput { token_id: USDC.into(), weight_bps: 5_000, q: U128(Q_USDC), anchored: false },
        ],
        fee_bps: 100,
        epoch_profile: "demo".into(),
        bu_usd_e6: 1_000_000,
        creator: acc("creator.testnet"),
        protocol: acc("protocol.testnet"),
        verifier: acc(VERIFIER),
        reporter: acc(REPORTER),
    })
}

fn register(c: &mut Coin, who: &str, ms: u64) {
    at(who, ms, 0);
    let min = c.storage_balance_bounds().min.as_yoctonear();
    at(who, ms, min);
    c.storage_deposit(None, Some(true));
}

/// Send exactly `bu` worth of the basket, plus `extra` sats of BTC, as `who`.
fn buy(c: &mut Coin, who: &str, bu: u128, extra: u128, ms: u64) -> Vec<u128> {
    let ids = vec![BTC.to_string(), USDC.to_string()];
    let amts = vec![U128(bu * Q_BTC / E18 + extra), U128(bu * Q_USDC / E18)];
    buy_raw(c, who, ids, amts, ms)
}

fn buy_raw(c: &mut Coin, who: &str, ids: Vec<String>, amts: Vec<U128>, ms: u64) -> Vec<u128> {
    at(VERIFIER, ms, 0);
    let msg = r#"{"action":"buy"}"#.to_string();
    match c.mt_on_transfer(acc(who), vec![acc(who)], ids, amts, msg) {
        PromiseOrValue::Value(v) => v.into_iter().map(|x| x.0).collect(),
        _ => panic!("expected a value"),
    }
}

fn state(c: &Coin) -> Value {
    c.get_state()
}

fn u(v: &Value) -> u128 {
    v.as_str().unwrap().parse().unwrap()
}

fn bal(c: &Coin, who: &str) -> u128 {
    c.ft_balance_of(acc(who)).0
}

/// A coin past its (empty) window, with alice and bob registered: plain curve trading.
fn curve_coin() -> Coin {
    let mut c = new_coin();
    register(&mut c, "alice.testnet", WINDOW_END);
    register(&mut c, "bob.testnet", WINDOW_END);
    c
}

#[test]
fn constants_match_constants_json() {
    let j: Value = near_sdk::serde_json::from_str(include_str!("../../../constants.json")).unwrap();
    assert_eq!(u(&j["curve"]["virtual_bu"]) * E18, X0);
    assert_eq!(u(&j["curve"]["virtual_tokens"]) * E18, Y0);
    assert_eq!(u(&j["curve"]["graduation_reserve_bu"]) * E18, GRAD_RESERVE);
    assert_eq!(j["fees"]["redeem_fee_bps"].as_u64().unwrap() as u128, REDEEM_FEE_BPS);
    assert_eq!(j["fees"]["trade_fee_bps"]["min"].as_u64().unwrap() as u16, FEE_MIN_BPS);
    assert_eq!(j["fees"]["trade_fee_bps"]["max"].as_u64().unwrap() as u16, FEE_MAX_BPS);
    assert_eq!(j["launch"]["basket_assets"]["max"].as_u64().unwrap() as usize, BASKET_MAX);
    assert_eq!(j["launch"]["fair_launch_window_s"]["demo"].as_u64().unwrap() * 1000, DEMO.window_ms);
    assert_eq!(j["launch"]["fair_launch_window_s"]["prod"].as_u64().unwrap() * 1000, PROD.window_ms);
    assert_eq!(j["epochs"]["len_s"]["demo"].as_u64().unwrap() * 1000, DEMO.epoch_ms);
    assert_eq!(j["auction"]["len_s"]["demo"].as_u64().unwrap() * 1000, DEMO.auction_ms);
    assert_eq!(j["auction"]["start_premium_bps"].as_u64().unwrap() as u128, AUCTION_PREMIUM_BPS);
    assert_eq!(j["challenge"]["min_burn_bps_of_slot"].as_u64().unwrap() as u128, MIN_CHALLENGE_BPS);
    assert_eq!(j["graduation"]["pool_share_bps"].as_u64().unwrap() as u128, POOL_SHARE_BPS);
    assert_eq!(j["log"]["ring_size"].as_u64().unwrap() as u32, LOG_RING);
    assert_eq!(j["launch"]["basket_assets"]["min"].as_u64().unwrap() as usize, BASKET_MIN);
    assert_eq!(j["epochs"]["len_s"]["prod"].as_u64().unwrap() * 1000, PROD.epoch_ms);
    assert_eq!(j["auction"]["len_s"]["prod"].as_u64().unwrap() * 1000, PROD.auction_ms);
    assert_eq!(j["prices"]["staleness_s"]["prod"].as_u64().unwrap() * 1000, PROD.staleness_ms);
    assert_eq!(j["prices"]["staleness_s"]["demo"].as_u64().unwrap() * 1000, DEMO.staleness_ms);
    assert_eq!(u(&j["launch"]["queue_cap_bu"]) * E18, QUEUE_CAP_BU);
    assert_eq!(u(&j["launch"]["min_queue_bu"]) * E18, MIN_QUEUE_BU);
    assert_eq!(j["challenge"]["max_open_per_epoch"].as_u64().unwrap() as usize, MAX_CHALLENGES);
    let split = &j["fees"]["split_bps"];
    assert_eq!(split["creator"].as_u64().unwrap() as u128, curve_math::SPLIT_CREATOR_BPS);
    assert_eq!(split["vault"].as_u64().unwrap() as u128, curve_math::SPLIT_VAULT_BPS);
}

#[test]
fn a_new_coin_starts_in_its_fair_launch_window_with_no_supply() {
    let c = new_coin();
    let s = state(&c);
    assert_eq!(s["mode"], "launch");
    assert_eq!(u(&s["supply"]), 0);
    assert_eq!(c.get_basket().as_array().unwrap().len(), 2);
    assert_eq!(c.ft_metadata().symbol, "DEGEN");
}

#[test]
#[should_panic(expected = "weights must sum to 10000")]
fn launch_config_is_validated() {
    at(FACTORY, 0, 0);
    Coin::new(CoinInit {
        ticker: "BAD".into(),
        name: "Bad".into(),
        icon: None,
        basket: vec![BasketInput { token_id: BTC.into(), weight_bps: 4_000, q: U128(1), anchored: false }],
        fee_bps: 100,
        epoch_profile: "demo".into(),
        bu_usd_e6: 1,
        creator: acc("c.testnet"),
        protocol: acc("p.testnet"),
        verifier: acc(VERIFIER),
        reporter: acc(REPORTER),
    });
}

#[test]
fn a_buy_for_an_unregistered_account_is_refunded_in_full() {
    let mut c = new_coin();
    let unused = buy(&mut c, "alice.testnet", 100 * E18, 0, 1_000);
    assert_eq!(unused, vec![100 * Q_BTC, 100 * Q_USDC]);
    assert_eq!(u(&state(&c)["b_total"]), 0);
}

#[test]
fn a_buy_that_does_not_send_the_basket_is_refunded() {
    let mut c = curve_coin();
    let unused = buy_raw(&mut c, "alice.testnet", vec![BTC.into()], vec![U128(1_000)], WINDOW_END);
    assert_eq!(unused, vec![1_000]);
}

#[test]
fn buys_in_the_window_are_queued_and_the_excess_is_returned() {
    let mut c = new_coin();
    register(&mut c, "alice.testnet", 1_000);
    // USDC is the scarcer asset, so the 7 extra sats come back.
    let unused = buy(&mut c, "alice.testnet", 1_000 * E18, 7, 1_000);
    assert_eq!(unused, vec![7, 0]);
    assert_eq!(bal(&c, "alice.testnet"), 0);
    let s = state(&c);
    assert_eq!(u(&s["launch"]["queued_bu"]), 990 * E18);
    assert_eq!(s["launch"]["queued_accounts"], 1);
    // 1% fee of 1,000 BU: creator 5, protocol 2, vault 3.
    assert_eq!(u(&s["creator_owed"]), 5 * E18);
    assert_eq!(u(&s["protocol_owed"]), 2 * E18);
    assert_eq!(u(&s["b_total"]), 1_000 * E18);
}

#[test]
fn settling_the_window_gives_everyone_the_same_average_price() {
    let mut c = new_coin();
    register(&mut c, "alice.testnet", 1_000);
    register(&mut c, "bob.testnet", 1_000);
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, 1_000);
    buy(&mut c, "bob.testnet", 3_000 * E18, 0, 60_000);
    at("anyone.testnet", WINDOW_END, 0);
    assert_eq!(c.settle_launch(1), 1);
    assert_eq!(c.settle_launch(10), 0);
    // One curve buy with 3,960 BU (net of fees), split 990 : 2,970.
    assert_eq!(bal(&c, "alice.testnet"), 118_556_919_642_857_142_857_142_857);
    assert_eq!(bal(&c, "bob.testnet"), 355_670_758_928_571_428_571_428_571);
    let s = state(&c);
    assert_eq!(s["mode"], "curve");
    assert_eq!(u(&s["sold"]), 474_227_678_571_428_571_428_571_428);
    assert_eq!(u(&s["supply"]), u(&s["sold"]));
}

#[test]
#[should_panic(expected = "the fair-launch window is still open")]
fn the_window_cannot_be_settled_early() {
    let mut c = new_coin();
    at("anyone.testnet", 1_000, 0);
    c.settle_launch(10);
}

#[test]
fn a_curve_buy_mints_at_the_curve_and_splits_the_fee() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    // 990 BU net on a fresh curve.
    assert_eq!(bal(&c, "alice.testnet"), 177_340_567_612_687_813_021_702_838);
    let s = state(&c);
    assert_eq!(s["mode"], "curve");
    assert_eq!(u(&s["reserve"]), 990 * E18);
    assert_eq!(u(&s["surplus"]), 3 * E18);
    assert_eq!(c.get_log()[0].kind, "mint");
}

#[test]
fn a_sell_burns_tokens_and_pays_curve_plus_surplus_minus_fee() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    buy(&mut c, "bob.testnet", 4_000 * E18, 0, WINDOW_END);
    let before = state(&c);
    let tokens = bal(&c, "alice.testnet");
    let q = c.quote_sell(U128(tokens));
    at("alice.testnet", WINDOW_END, 1);
    let out = c.sell(U128(tokens), U128(0), None).0;
    assert_eq!(out, u(&q["out_bu"]));
    assert_eq!(bal(&c, "alice.testnet"), 0);
    let after = state(&c);
    // B_total falls by exactly what was paid out; the fee stays inside.
    assert_eq!(u(&before["b_total"]) - u(&after["b_total"]), out);
    // Alice gets more than she would without a surplus share.
    let surplus_share = curve_math::mul_div(u(&before["surplus"]), tokens, u(&before["sold"]));
    assert!(surplus_share > 0);
    assert_eq!(c.get_log()[0].kind, "burn");
}

#[test]
#[should_panic(expected = "slippage")]
fn a_sell_below_the_minimum_is_refused() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    let tokens = bal(&c, "alice.testnet");
    at("alice.testnet", WINDOW_END, 1);
    c.sell(U128(tokens), U128(10_000 * E18), None);
}

#[test]
fn buying_past_graduation_caps_the_buy_and_opens_the_pool() {
    let mut c = curve_coin();
    let unused = buy(&mut c, "alice.testnet", 30_000 * E18, 0, WINDOW_END);
    assert!(unused[0] > 0 && unused[1] > 0, "the excess comes back");
    let s = state(&c);
    assert_eq!(s["mode"], "index");
    assert_eq!(bal(&c, "alice.testnet"), 858_400_000 * E18);
    // The pool holds 20% of the backing; the rest backs redemptions.
    let (pool, reserve) = (u(&s["pool_bu"]), u(&s["reserve"]));
    assert_eq!(pool, (pool + reserve) * 2_000 / 10_000);
    assert!(u(&s["pool_tokens"]) > 34_000_000 * E18);
    assert!(s["graduated_ms"].is_number());
}

#[test]
fn after_graduation_a_sell_takes_the_better_of_pool_and_redeem() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 30_000 * E18, 0, WINDOW_END);
    let t = 1_000_000 * E18;
    let q = c.quote_sell(U128(t));
    // Near the last curve price the pool pays far more than the floor.
    assert_eq!(q["path"], "pool");
    let floor_before = u(&state(&c)["floor"]);
    at("alice.testnet", WINDOW_END, 1);
    c.sell(U128(t), U128(0), None);
    // Pool trades never lower the floor (supply includes the pool's tokens); the fee's
    // vault share raises it a little.
    let floor_after = u(&state(&c)["floor"]);
    assert!(floor_after >= floor_before && floor_after < floor_before + floor_before / 1_000);
}

#[test]
fn redeeming_raises_the_floor_for_those_who_stay() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 30_000 * E18, 0, WINDOW_END);
    let floor_before = u(&state(&c)["floor"]);
    at("alice.testnet", WINDOW_END, 1);
    c.redeem(U128(100_000_000 * E18), None);
    assert!(u(&state(&c)["floor"]) > floor_before);
}

#[test]
fn a_pool_buy_after_graduation_moves_tokens_out_of_the_pool() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 30_000 * E18, 0, WINDOW_END);
    let pool_before = u(&state(&c)["pool_tokens"]);
    let supply_before = u(&state(&c)["supply"]);
    buy(&mut c, "bob.testnet", 100 * E18, 0, WINDOW_END);
    assert!(bal(&c, "bob.testnet") > 0);
    assert_eq!(u(&state(&c)["pool_tokens"]), pool_before - bal(&c, "bob.testnet"));
    assert_eq!(u(&state(&c)["supply"]), supply_before, "no minting after graduation");
}

#[test]
#[should_panic(expected = "sell or transfer your tokens first")]
fn holders_cannot_unregister_while_holding_tokens() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    at("alice.testnet", WINDOW_END, 1);
    c.storage_unregister(Some(true));
}

#[test]
fn fee_claims_pay_creator_and_protocol_and_empty_their_buckets() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    at("anyone.testnet", WINDOW_END, 0);
    c.claim_fees();
    let s = state(&c);
    assert_eq!(u(&s["creator_owed"]), 0);
    assert_eq!(u(&s["protocol_owed"]), 0);
}

#[test]
fn the_log_keeps_only_the_last_100_entries_newest_first() {
    let mut c = curve_coin();
    for i in 0..105u64 {
        buy(&mut c, "alice.testnet", E18, 0, WINDOW_END + i);
    }
    let log = c.get_log();
    assert_eq!(log.len(), 100);
    assert_eq!(log[0].ts_ms, WINDOW_END + 104);
    assert_eq!(log[99].ts_ms, WINDOW_END + 5);
}

#[test]
fn tiny_buys_in_the_window_are_refused_so_the_queue_cannot_be_spammed() {
    let mut c = new_coin();
    register(&mut c, "alice.testnet", 1_000);
    let unused = buy(&mut c, "alice.testnet", E18 / 2, 0, 1_000);
    assert_eq!(unused, vec![E18 / 2 * Q_BTC / E18, E18 / 2 * Q_USDC / E18]);
    assert_eq!(state(&c)["launch"]["queued_accounts"], 0);
}

#[test]
fn buys_after_the_window_but_before_settling_are_refunded() {
    let mut c = new_coin();
    register(&mut c, "alice.testnet", 1_000);
    buy(&mut c, "alice.testnet", 100 * E18, 0, 1_000);
    let unused = buy(&mut c, "alice.testnet", 100 * E18, 0, WINDOW_END + 1);
    assert_eq!(unused, vec![100 * Q_BTC, 100 * Q_USDC]);
}

#[test]
fn the_last_depositor_gets_the_rounding_dust() {
    let mut c = new_coin();
    for (w, bu) in [("alice.testnet", 7u128), ("bob.testnet", 11), ("carol.testnet", 13)] {
        register(&mut c, w, 1_000);
        buy(&mut c, w, bu * E18, 0, 1_000);
    }
    at("anyone.testnet", WINDOW_END, 0);
    c.settle_launch(10);
    let total: u128 = ["alice.testnet", "bob.testnet", "carol.testnet"].iter().map(|w| bal(&c, w)).sum();
    assert_eq!(total, u(&state(&c)["sold"]));
    assert_eq!(state(&c)["launch"]["settled"], true);
}

#[test]
fn when_every_token_is_gone_the_ownerless_surplus_goes_to_fees_not_the_next_buyer() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    let t = bal(&c, "alice.testnet");
    at("alice.testnet", WINDOW_END, 1);
    c.sell(U128(t), U128(0), None);
    let s = state(&c);
    assert_eq!(u(&s["sold"]), 0);
    assert_eq!(u(&s["surplus"]), 0, "nobody holds tokens, so nobody's surplus is left for a newcomer");
    // A new buyer then pays and gets back no more than they put in.
    buy(&mut c, "bob.testnet", 100 * E18, 0, WINDOW_END);
    let q = c.quote_sell(U128(bal(&c, "bob.testnet")));
    assert!(u(&q["out_bu"]) < 100 * E18);
}

#[test]
fn after_graduation_a_burn_raises_the_floor() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 30_000 * E18, 0, WINDOW_END);
    let floor_before = u(&state(&c)["floor"]);
    at("alice.testnet", WINDOW_END, 1);
    c.defend(USDC.into(), U128(10_000_000 * E18));
    assert!(u(&state(&c)["floor"]) > floor_before);
}

// ---------- Rituals ----------

fn report(c: &mut Coin, ms: u64) {
    at(REPORTER, ms, 0);
    // USD per raw unit x1e36: USDC $1 (6 dp) -> 1e30; SOL $180 (9 dp) -> 1.8e29.
    c.report_prices(vec![(USDC.into(), U128(1_000_000_000_000_000_000_000_000_000_000)), (SOL.into(), U128(180_000_000_000_000_000_000_000_000_000))]);
}

fn epoch_end() -> u64 {
    DEMO.epoch_ms
}

#[test]
fn a_challenge_burns_tokens_and_raises_surplus_per_token() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 5_000 * E18, 0, WINDOW_END);
    buy(&mut c, "bob.testnet", 5_000 * E18, 0, WINDOW_END);
    let s_before = u(&state(&c)["surplus_per_token"]);
    at("alice.testnet", WINDOW_END, 1);
    let v = c.challenge(USDC.into(), SOL.into(), U128(10_000_000 * E18)).0;
    assert!(v > 0);
    assert!(u(&state(&c)["surplus_per_token"]) > s_before);
    let e = c.get_epoch();
    assert_eq!(u(&e["challenges"][0]["burned_bu"]), v);
}

#[test]
#[should_panic(expected = "anchored assets cannot be challenged")]
fn anchored_assets_cannot_be_challenged() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 5_000 * E18, 0, WINDOW_END);
    at("alice.testnet", WINDOW_END, 1);
    c.challenge(BTC.into(), SOL.into(), U128(E18));
}

fn challenged_coin(challenge_tokens: u128, defense_tokens: u128) -> Coin {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 5_000 * E18, 0, WINDOW_END);
    buy(&mut c, "bob.testnet", 5_000 * E18, 0, WINDOW_END);
    at("alice.testnet", WINDOW_END, 1);
    c.challenge(USDC.into(), SOL.into(), U128(challenge_tokens));
    if defense_tokens > 0 {
        at("bob.testnet", WINDOW_END, 1);
        c.defend(USDC.into(), U128(defense_tokens));
    }
    c
}

#[test]
fn a_winning_challenge_opens_an_auction_at_fair_plus_20_percent() {
    // 40M tokens is about 300 BU of burn; the minimum is 3% of a 5,000 BU slot = 150 BU.
    let mut c = challenged_coin(40_000_000 * E18, 0);
    report(&mut c, epoch_end());
    at("anyone.testnet", epoch_end(), 0);
    assert_eq!(c.close_epoch(), "auction_opened");
    let a = c.get_auction().unwrap();
    // Fair rate: 1e30 / 1.8e29 = 5.555.. SOL lamports per micro-USDC, x1e18, rounded up.
    assert_eq!(u(&a["fair_rate"]), 5_555_555_555_555_555_556);
    assert_eq!(u(&a["rate_now"]), 6_666_666_666_666_666_668);
    assert_eq!(state(&c)["epoch"]["index"], 1);
}

#[test]
fn a_challenge_below_the_minimum_burn_does_not_win() {
    let mut c = challenged_coin(1_000_000 * E18, 0);
    report(&mut c, epoch_end());
    at("anyone.testnet", epoch_end(), 0);
    assert_eq!(c.close_epoch(), "no_winning_challenge");
    assert!(c.get_auction().is_none());
}

#[test]
fn defenders_who_burn_more_keep_the_asset() {
    let mut c = challenged_coin(40_000_000 * E18, 60_000_000 * E18);
    report(&mut c, epoch_end());
    at("anyone.testnet", epoch_end(), 0);
    assert_eq!(c.close_epoch(), "no_winning_challenge");
}

#[test]
fn without_fresh_prices_no_auction_opens() {
    let mut c = challenged_coin(40_000_000 * E18, 0);
    report(&mut c, 0); // stale by the end of the epoch
    at("anyone.testnet", epoch_end() + DEMO.staleness_ms + 1, 0);
    assert_eq!(c.close_epoch(), "no_fresh_prices");
}

#[test]
#[should_panic(expected = "the epoch has not ended")]
fn an_epoch_cannot_close_early() {
    let mut c = curve_coin();
    at("anyone.testnet", WINDOW_END, 0);
    c.close_epoch();
}

fn fill(c: &mut Coin, who: &str, amount: u128, ms: u64) -> Vec<u128> {
    at(VERIFIER, ms, 0);
    let msg = r#"{"action":"fill_auction"}"#.to_string();
    match c.mt_on_transfer(acc(who), vec![acc(who)], vec![SOL.into()], vec![U128(amount)], msg) {
        PromiseOrValue::Value(v) => v.into_iter().map(|x| x.0).collect(),
        _ => panic!("expected a value"),
    }
}

#[test]
fn filling_the_auction_swaps_the_asset_and_writes_a_tombstone() {
    let mut c = challenged_coin(40_000_000 * E18, 0);
    report(&mut c, epoch_end());
    at("anyone.testnet", epoch_end(), 0);
    c.close_epoch();
    let usdc_held = c.get_auction().unwrap()["target_left"].as_str().unwrap().parse::<u128>().unwrap();
    // After the ramp the rate is fair; send more SOL than needed for all the USDC.
    let t = epoch_end() + DEMO.auction_ms;
    let need = usdc_held * 5_555_555_555_555_555_556 / E18 + 10;
    let unused = fill(&mut c, "solver.testnet", need + 1_000, t);
    assert!(unused[0] >= 1_000, "the excess SOL comes back");
    assert!(c.get_auction().is_none());
    let basket = c.get_basket();
    let ids: Vec<&str> = basket.as_array().unwrap().iter().map(|s| s["token_id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![BTC, SOL]);
    let tomb = c.get_tombstones(None, None);
    assert_eq!(tomb[0].token_id, USDC);
    assert_eq!(tomb[0].challenger, acc("alice.testnet"));
    // The next buyer sends BTC and SOL.
    let q = c.quote_buy(U128(E18));
    assert_eq!(q["token_ids"], near_sdk::serde_json::json!([BTC, SOL]));
}

#[test]
fn a_partial_fill_keeps_the_auction_open_and_buys_send_the_mixed_basket() {
    let mut c = challenged_coin(40_000_000 * E18, 0);
    report(&mut c, epoch_end());
    at("anyone.testnet", epoch_end(), 0);
    c.close_epoch();
    fill(&mut c, "solver.testnet", 1_000_000, epoch_end() + DEMO.auction_ms);
    assert!(c.get_auction().is_some());
    let q = c.quote_buy(U128(E18));
    assert_eq!(q["token_ids"], near_sdk::serde_json::json!([BTC, USDC, SOL]));
}

// ---------- Solvency under random use ----------

mod solvency {
    use super::*;
    use proptest::prelude::*;

    #[derive(Debug, Clone)]
    enum Op {
        Buy(usize, u128),
        Sell(usize, u16),
        Challenge(usize, u16),
        Defend(usize, u16),
        Claim,
    }

    fn op() -> impl Strategy<Value = Op> {
        prop_oneof![
            4 => (0usize..3, 1u128..3_000).prop_map(|(w, bu)| Op::Buy(w, bu)),
            3 => (0usize..3, 1u16..=10_000).prop_map(|(w, p)| Op::Sell(w, p)),
            1 => (0usize..3, 1u16..=2_000).prop_map(|(w, p)| Op::Challenge(w, p)),
            1 => (0usize..3, 1u16..=2_000).prop_map(|(w, p)| Op::Defend(w, p)),
            1 => Just(Op::Claim),
        ]
    }

    const WHO: [&str; 3] = ["alice.testnet", "bob.testnet", "carol.testnet"];

    fn check(c: &Coin) {
        let s = c.get_state();
        if s["mode"] == "curve" {
            let (r, sold) = (u(&s["reserve"]), u(&s["sold"]));
            let x = curve_math::U256::from(X0 + r);
            let y = curve_math::U256::from(Y0 - sold);
            assert!(x * y >= curve_math::U256::from(X0) * curve_math::U256::from(Y0), "x*y < k");
            assert_eq!(sold, u(&s["supply"]), "sold != supply");
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(128))]
        /// Any sequence of buys, sells, burns and claims keeps the curve whole, and afterwards
        /// every holder can still sell out and every fee can be claimed without the vault running dry.
        #[test]
        fn everyone_can_always_exit(ops in proptest::collection::vec(op(), 1..160)) {
            let mut c = new_coin();
            for w in WHO { register(&mut c, w, WINDOW_END); }
            let t = WINDOW_END;
            for o in ops {
                match o {
                    Op::Buy(w, bu) => { buy(&mut c, WHO[w], bu * E18, 0, t); }
                    Op::Sell(w, p) => {
                        let b = bal(&c, WHO[w]) * p as u128 / 10_000;
                        if b > 0 { at(WHO[w], t, 1); c.sell(U128(b), U128(0), None); }
                    }
                    Op::Challenge(w, p) => {
                        let b = bal(&c, WHO[w]) * p as u128 / 10_000;
                        if b > 0 && c.get_state()["mode"] == "curve" { at(WHO[w], t, 1); c.challenge(USDC.into(), SOL.into(), U128(b)); }
                    }
                    Op::Defend(w, p) => {
                        let b = bal(&c, WHO[w]) * p as u128 / 10_000;
                        if b > 0 && c.get_state()["mode"] == "curve" { at(WHO[w], t, 1); c.defend(USDC.into(), U128(b)); }
                    }
                    Op::Claim => {
                        let s = c.get_state();
                        if u(&s["creator_owed"]) + u(&s["protocol_owed"]) > 0 { at("anyone.testnet", t, 0); c.claim_fees(); }
                    }
                }
                check(&c);
            }
            // Everyone exits (u128 underflow anywhere would panic and fail the test).
            for w in WHO {
                let b = bal(&c, w);
                if b > 0 { at(w, t, 1); c.sell(U128(b), U128(0), None); }
            }
            let s = c.get_state();
            if u(&s["creator_owed"]) + u(&s["protocol_owed"]) > 0 { at("anyone.testnet", t, 0); c.claim_fees(); }
            let s = c.get_state();
            if s["mode"] == "curve" {
                prop_assert_eq!(u(&s["supply"]), 0);
                prop_assert_eq!(u(&s["reserve"]), 0, "the curve owes nothing once everyone has sold");
                // Everything owed was paid out: no BU is left without an owner.
                prop_assert_eq!(u(&s["b_total"]), 0);
            }
        }
    }
}

// ---------- Buying and selling from a wallet on another chain, through NEAR Intents ----------

const EVM_BUYER: &str = "0x1111111111111111111111111111111111111111";

fn deliver_buy(c: &mut Coin, who: &str, bu: u128, ms: u64) -> Vec<u128> {
    let ids = vec![BTC.to_string(), USDC.to_string()];
    let amts = vec![U128(bu * Q_BTC / E18), U128(bu * Q_USDC / E18)];
    at(VERIFIER, ms, 0);
    let msg = r#"{"action":"buy","deliver":true}"#.to_string();
    match c.mt_on_transfer(acc(who), vec![acc(who)], ids, amts, msg) {
        PromiseOrValue::Value(v) => v.into_iter().map(|x| x.0).collect(),
        _ => panic!("expected a value"),
    }
}

#[test]
fn a_delivered_buy_mints_into_near_intents_for_the_signer() {
    let mut c = curve_coin();
    register(&mut c, VERIFIER, WINDOW_END);
    let refund = deliver_buy(&mut c, EVM_BUYER, 1_000 * E18, WINDOW_END);
    assert!(refund.iter().all(|&r| r == 0));
    // The tokens sit on the verifier's balance (NEAR Intents credits them to the buyer), not on the buyer's.
    assert_eq!(bal(&c, VERIFIER), 177_340_567_612_687_813_021_702_838);
    assert_eq!(bal(&c, EVM_BUYER), 0);
}

#[test]
fn a_delivered_buy_during_the_fair_launch_is_refunded() {
    let mut c = new_coin();
    register(&mut c, VERIFIER, 0);
    let ids = vec![BTC.to_string(), USDC.to_string()];
    let amts = vec![U128(10 * Q_BTC), U128(10 * Q_USDC)];
    at(VERIFIER, 1_000, 0);
    let out = match c.mt_on_transfer(acc(EVM_BUYER), vec![acc(EVM_BUYER)], ids, amts.clone(), r#"{"action":"buy","deliver":true}"#.into()) {
        PromiseOrValue::Value(v) => v,
        _ => panic!("expected a value"),
    };
    assert_eq!(out, amts);
}

#[test]
fn near_intents_can_sell_a_holders_tokens_back_to_the_coin() {
    let mut c = curve_coin();
    register(&mut c, VERIFIER, WINDOW_END);
    deliver_buy(&mut c, EVM_BUYER, 1_000 * E18, WINDOW_END);
    buy(&mut c, "bob.testnet", 4_000 * E18, 0, WINDOW_END);
    let held = bal(&c, VERIFIER);
    let q = c.quote_sell(U128(held / 2));
    at(VERIFIER, WINDOW_END, 1);
    let msg = format!(r#"{{"action":"sell","min_bu_out":"0","receiver_id":"{EVM_BUYER}"}}"#);
    match c.ft_transfer_call(acc(COIN), U128(held / 2), None, msg) {
        PromiseOrValue::Value(used) => assert_eq!(used.0, held / 2),
        _ => panic!("expected a value"),
    }
    assert_eq!(bal(&c, VERIFIER), held - held / 2);
    assert_eq!(c.get_log()[0].kind, "burn");
    assert!(u(&q["out_bu"]) > 0);
}

#[test]
fn a_near_intents_sell_that_cannot_fill_uses_nothing_so_the_holder_is_refunded() {
    // NEAR Intents keeps the tokens of a withdrawal whose ft_transfer_call panics, so a failed sell must not panic.
    let mut c = curve_coin();
    register(&mut c, VERIFIER, WINDOW_END);
    deliver_buy(&mut c, EVM_BUYER, 1_000 * E18, WINDOW_END);
    let held = bal(&c, VERIFIER);
    for msg in [
        format!(r#"{{"action":"sell","min_bu_out":"{}","receiver_id":"{EVM_BUYER}"}}"#, u128::MAX),
        "not json".to_string(),
    ] {
        at(VERIFIER, WINDOW_END, 1);
        match c.ft_transfer_call(acc(COIN), U128(held), None, msg) {
            PromiseOrValue::Value(used) => assert_eq!(used.0, 0),
            _ => panic!("expected a value"),
        }
        assert_eq!(bal(&c, VERIFIER), held);
    }
}

#[test]
#[should_panic(expected = "use sell to trade with the pool")]
fn only_near_intents_may_send_coins_to_the_coin() {
    let mut c = curve_coin();
    buy(&mut c, "alice.testnet", 1_000 * E18, 0, WINDOW_END);
    at("alice.testnet", WINDOW_END, 1);
    let _ = c.ft_transfer_call(acc(COIN), U128(1), None, r#"{"action":"sell","min_bu_out":"0","receiver_id":"alice.testnet"}"#.into());
}
