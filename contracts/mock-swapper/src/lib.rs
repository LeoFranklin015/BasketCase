//! Testnet stand-in for 1Click: swaps verifier balances at an owner-set price table.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::store::LookupMap;
use near_sdk::{env, ext_contract, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

const BPS: u128 = 10_000;
const FEE_BPS: u128 = 30;

#[ext_contract(ext_verifier)]
pub trait Verifier {
    fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>);
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
#[serde(untagged)]
enum Msg {
    Swap { want: String, amount_out: Option<U128>, min_out: Option<U128>, recipient: Option<AccountId> },
    Seed(#[allow(dead_code)] String),
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockSwapper {
    owner: AccountId,
    verifier: AccountId,
    prices: Vec<(String, U128)>,
    inventory: LookupMap<String, u128>,
}

uint::construct_uint! {
    struct U256(4);
}

fn u(v: u128) -> U256 {
    U256::from(v)
}

fn ceil(a: U256, b: U256) -> U256 {
    let (q, r) = a.div_mod(b);
    if r.is_zero() { q } else { q + 1 }
}

#[near]
impl MockSwapper {
    #[init]
    pub fn new(owner: AccountId, verifier: AccountId) -> Self {
        Self { owner, verifier, prices: vec![], inventory: LookupMap::new(b"i") }
    }

    pub fn set_prices(&mut self, prices: Vec<(String, U128)>) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
        for (t, p) in prices {
            require!(p.0 > 0, "zero price");
            match self.prices.iter_mut().find(|(id, _)| *id == t) {
                Some(e) => e.1 = p,
                None => self.prices.push((t, p)),
            }
        }
    }

    pub fn get_prices(&self) -> Vec<(String, U128)> {
        self.prices.clone()
    }

    pub fn get_inventory(&self, token_id: String) -> U128 {
        U128(self.inventory.get(&token_id).copied().unwrap_or(0))
    }

    /// Output for an exact input, after the 0.3% fee, rounded down.
    pub fn quote_out(&self, token_in: String, token_out: String, amount_in: U128) -> U128 {
        let usd = u(amount_in.0) * u(self.price(&token_in)) * u(BPS - FEE_BPS) / u(BPS);
        U128((usd / u(self.price(&token_out))).as_u128())
    }

    /// Input needed for an exact output, after the 0.3% fee, rounded up.
    pub fn quote_in(&self, token_in: String, token_out: String, amount_out: U128) -> U128 {
        let usd_in = ceil(u(amount_out.0) * u(self.price(&token_out)) * u(BPS), u(BPS - FEE_BPS));
        U128(ceil(usd_in, u(self.price(&token_in))).as_u128())
    }

    /// Verifier callback. `"seed"` adds inventory; a swap message pays out through the verifier.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(env::predecessor_account_id() == self.verifier, "only the verifier");
        let _ = previous_owner_ids;
        require!(token_ids.len() == 1, "one token per swap");
        let (token_in, amount_in) = (token_ids[0].clone(), amounts[0].0);
        let msg: Msg = near_sdk::serde_json::from_str(&msg).expect("bad msg");
        match msg {
            Msg::Seed(_) => {
                self.add(&token_in, amount_in);
                PromiseOrValue::Value(vec![U128(0)])
            }
            Msg::Swap { want, amount_out, min_out, recipient } => {
                require!(want != token_in, "same token");
                let (used, out) = match amount_out {
                    Some(out) => {
                        let need = self.quote_in(token_in.clone(), want.clone(), out).0;
                        require!(need <= amount_in, "not enough input");
                        (need, out.0)
                    }
                    None => {
                        let out = self.quote_out(token_in.clone(), want.clone(), U128(amount_in)).0;
                        require!(out >= min_out.map(|m| m.0).unwrap_or(0) && out > 0, "below min_out");
                        (amount_in, out)
                    }
                };
                let have = self.inventory.get(&want).copied().unwrap_or(0);
                require!(have >= out, "not enough inventory");
                self.inventory.insert(want.clone(), have - out);
                self.add(&token_in, used);
                let to = recipient.unwrap_or(sender_id);
                ext_verifier::ext(self.verifier.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .mt_transfer(to, want, U128(out), None, None)
                    .detach();
                PromiseOrValue::Value(vec![U128(amount_in - used)])
            }
        }
    }
}

impl MockSwapper {
    fn price(&self, token_id: &str) -> u128 {
        self.prices.iter().find(|(t, _)| t == token_id).map(|(_, p)| p.0).expect("no price for token")
    }

    fn add(&mut self, token_id: &str, amount: u128) {
        let have = self.inventory.get(token_id).copied().unwrap_or(0);
        self.inventory.insert(token_id.to_string(), have + amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn as_caller(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).build());
    }

    const USDC: &str = "nep141:usdc.mock";
    const BTC: &str = "nep141:btc.mock";
    // USD per raw unit, scaled 1e36: USDC (6 dp) $1, BTC (8 dp) $100,000.
    const P_USDC: u128 = 1_000_000_000_000_000_000_000_000_000_000;
    const P_BTC: u128 = 1_000_000_000_000_000_000_000_000_000_000_000;

    fn swapper() -> MockSwapper {
        as_caller("owner.testnet");
        let mut s = MockSwapper::new(acc("owner.testnet"), acc("intents.testnet"));
        s.set_prices(vec![(USDC.into(), U128(P_USDC)), (BTC.into(), U128(P_BTC))]);
        s
    }

    #[test]
    fn quotes_use_the_table_minus_0_3_percent() {
        let s = swapper();
        // $1,000 of USDC (1e9 raw) buys 1,000,000 sats less 0.3% = 997,000 sats.
        assert_eq!(s.quote_out(USDC.into(), BTC.into(), U128(1_000_000_000)), U128(997_000));
        // 997,000 sats need exactly $1,000; 1 sat needs ceil(1,000 / 0.997) = 1,004 micro-USDC.
        assert_eq!(s.quote_in(USDC.into(), BTC.into(), U128(997_000)), U128(1_000_000_000));
        assert_eq!(s.quote_in(USDC.into(), BTC.into(), U128(1)), U128(1_004));
    }

    fn seeded() -> MockSwapper {
        let mut s = swapper();
        as_caller("intents.testnet");
        let _ = s.mt_on_transfer(acc("owner.testnet"), vec![acc("owner.testnet")], vec![BTC.into()], vec![U128(5_000_000)], "\"seed\"".into());
        s
    }

    #[test]
    fn an_exact_out_swap_returns_the_excess_input() {
        let mut s = seeded();
        as_caller("intents.testnet");
        let msg = format!("{{\"want\":\"{BTC}\",\"amount_out\":\"997000\"}}");
        let unused = s.mt_on_transfer(acc("alice.testnet"), vec![acc("alice.testnet")], vec![USDC.into()], vec![U128(1_200_000_000)], msg);
        match unused {
            PromiseOrValue::Value(v) => assert_eq!(v, vec![U128(200_000_000)]),
            _ => panic!("expected a value"),
        }
        assert_eq!(s.get_inventory(BTC.into()), U128(4_003_000));
        assert_eq!(s.get_inventory(USDC.into()), U128(1_000_000_000));
    }

    #[test]
    #[should_panic(expected = "not enough inventory")]
    fn a_swap_beyond_inventory_is_refused() {
        let mut s = seeded();
        as_caller("intents.testnet");
        let msg = format!("{{\"want\":\"{BTC}\",\"min_out\":\"0\"}}");
        let _ = s.mt_on_transfer(acc("alice.testnet"), vec![acc("alice.testnet")], vec![USDC.into()], vec![U128(10_000_000_000)], msg);
    }

    #[test]
    #[should_panic(expected = "only the verifier")]
    fn only_the_verifier_can_deliver_tokens() {
        let mut s = seeded();
        as_caller("mallory.testnet");
        let _ = s.mt_on_transfer(acc("mallory.testnet"), vec![acc("mallory.testnet")], vec![USDC.into()], vec![U128(1)], "\"seed\"".into());
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn only_the_owner_sets_prices() {
        let mut s = swapper();
        as_caller("mallory.testnet");
        s.set_prices(vec![(BTC.into(), U128(1))]);
    }
}
