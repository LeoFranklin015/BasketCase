//! Deploys one coin contract per launch at `<ticker>-<n>.<factory>` and keeps the registry.
//! Permissionless: anyone who attaches the deposit can launch. Coin accounts get no keys.

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

#[cfg(not(test))]
const COIN_CODE: &[u8] = include_bytes!(env!("COIN_WASM_PATH"));
#[cfg(test)]
const COIN_CODE: &[u8] = &[0u8; 1_000];

/// Bytes of coin state, log ring and queue the deposit must also cover.
const STATE_ALLOWANCE_BYTES: u128 = 60_000;
const GAS_INIT: Gas = Gas::from_tgas(60);
const GAS_ON_CREATE: Gas = Gas::from_tgas(15);

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BasketInput {
    pub token_id: String,
    pub weight_bps: u16,
    pub q: U128,
    pub anchored: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct LaunchConfig {
    pub ticker: String,
    pub name: String,
    pub icon: Option<String>,
    pub basket: Vec<BasketInput>,
    pub fee_bps: u16,
    pub epoch_profile: String,
    pub bu_usd_e6: u64,
    pub creator: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CoinInfo {
    pub account_id: AccountId,
    pub ticker: String,
    pub name: String,
    pub creator: AccountId,
    pub created_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    reporter: AccountId,
    protocol: AccountId,
    verifier: AccountId,
    launch_fee: u128,
    coins: Vector<CoinInfo>,
    index: LookupMap<AccountId, u32>,
    counters: LookupMap<String, u32>,
}

fn valid_ticker(t: &str) -> bool {
    (2..=10).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

#[near]
impl Factory {
    /// `launch_fee` (yocto) is charged on top of the coin's storage; it stays with the coin.
    #[init]
    pub fn new(reporter: AccountId, protocol: AccountId, verifier: AccountId, launch_fee: U128) -> Self {
        Self {
            reporter,
            protocol,
            verifier,
            launch_fee: launch_fee.0,
            coins: Vector::new(b"c"),
            index: LookupMap::new(b"i"),
            counters: LookupMap::new(b"n"),
        }
    }

    /// NEAR to attach to `create_coin`: storage for the coin's code and state, plus the launch fee.
    pub fn required_deposit(&self) -> NearToken {
        let bytes = COIN_CODE.len() as u128 + STATE_ALLOWANCE_BYTES;
        NearToken::from_yoctonear(env::storage_byte_cost().as_yoctonear() * bytes + self.launch_fee)
    }

    #[payable]
    pub fn create_coin(&mut self, config: LaunchConfig) -> Promise {
        let deposit = env::attached_deposit();
        let need = self.required_deposit();
        require!(deposit >= need, format!("attach at least {} yoctoNEAR", need.as_yoctonear()));
        require!(valid_ticker(&config.ticker), "bad ticker: 2-10 characters, A-Z and 0-9");
        require!((1..=9).contains(&config.basket.len()), "basket must have 1 to 9 assets");
        let weights: u32 = config.basket.iter().map(|b| b.weight_bps as u32).sum();
        require!(weights == 10_000, "weights must sum to 10000");
        for (i, b) in config.basket.iter().enumerate() {
            require!(b.q.0 > 0 && b.weight_bps > 0, "zero q or weight");
            require!(config.basket[..i].iter().all(|o| o.token_id != b.token_id), "duplicate asset");
        }
        require!((25..=100).contains(&config.fee_bps), "fee out of range");
        require!(config.epoch_profile == "demo" || config.epoch_profile == "prod", "epoch_profile must be demo or prod");
        let creator = config.creator.clone().unwrap_or_else(env::predecessor_account_id);
        let account_id = self.next_account_id(config.ticker.clone());
        let n = self.counters.get(&config.ticker).copied().unwrap_or(0);
        self.counters.insert(config.ticker.clone(), n + 1);
        let init = json!({ "init": {
            "ticker": config.ticker, "name": config.name, "icon": config.icon, "basket": config.basket,
            "fee_bps": config.fee_bps, "epoch_profile": config.epoch_profile, "bu_usd_e6": config.bu_usd_e6,
            "creator": creator, "protocol": self.protocol, "verifier": self.verifier, "reporter": self.reporter,
        }});
        let info = CoinInfo { account_id: account_id.clone(), ticker: config.ticker, name: config.name, creator, created_ms: env::block_timestamp_ms() };
        Promise::new(account_id)
            .create_account()
            .transfer(deposit)
            .deploy_contract(COIN_CODE.to_vec())
            .function_call("new".to_string(), init.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_CREATE).on_create(info, env::predecessor_account_id(), U128(deposit.as_yoctonear())))
    }

    /// Registers the coin if the deploy worked; otherwise refunds whoever paid.
    #[private]
    pub fn on_create(&mut self, info: CoinInfo, payer: AccountId, deposit: U128) -> Option<AccountId> {
        if env::promise_result_checked(0, 64).is_ok() {
            self.index.insert(info.account_id.clone(), self.coins.len());
            self.coins.push(info.clone());
            env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": "backed", "version": "1.0.0", "event": "coin_created", "data": [info] })));
            Some(info.account_id)
        } else {
            if deposit.0 > 0 {
                Promise::new(payer).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            }
            None
        }
    }

    pub fn next_account_id(&self, ticker: String) -> AccountId {
        let n = self.counters.get(&ticker).copied().unwrap_or(0);
        format!("{}-{}.{}", ticker.to_lowercase(), n, env::current_account_id()).parse().unwrap()
    }

    pub fn list_coins(&self, from: Option<u32>, limit: Option<u32>) -> Vec<CoinInfo> {
        let from = from.unwrap_or(0);
        let end = (from + limit.unwrap_or(100)).min(self.coins.len());
        (from..end).map(|i| self.coins[i].clone()).collect()
    }

    pub fn get_coin(&self, account_id: AccountId) -> Option<CoinInfo> {
        self.index.get(&account_id).map(|&i| self.coins[i].clone())
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        json!({
            "reporter": self.reporter, "protocol": self.protocol, "verifier": self.verifier,
            "launch_deposit": U128(self.required_deposit().as_yoctonear()), "coin_count": self.coins.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, PromiseResult};

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn at(who: &str, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(acc("factory.testnet"))
            .predecessor_account_id(acc(who))
            .attached_deposit(deposit)
            .build());
    }

    fn factory() -> Factory {
        at("deployer.testnet", NearToken::from_yoctonear(0));
        Factory::new(acc("reporter.testnet"), acc("protocol.testnet"), acc("intents.testnet"), U128(NearToken::from_near(1).as_yoctonear()))
    }

    fn config(ticker: &str) -> LaunchConfig {
        LaunchConfig {
            ticker: ticker.into(),
            name: "Degen".into(),
            icon: None,
            basket: vec![
                BasketInput { token_id: "nep141:btc.mock".into(), weight_bps: 5_000, q: U128(1_000), anchored: true },
                BasketInput { token_id: "nep141:usdc.mock".into(), weight_bps: 5_000, q: U128(500_000), anchored: false },
            ],
            fee_bps: 100,
            epoch_profile: "demo".into(),
            bu_usd_e6: 10_000,
            creator: None,
        }
    }

    #[test]
    fn a_launch_names_the_coin_after_its_ticker_and_a_counter() {
        let mut f = factory();
        at("alice.testnet", f.required_deposit());
        let _ = f.create_coin(config("DEGEN"));
        at("bob.testnet", f.required_deposit());
        let _ = f.create_coin(config("DEGEN"));
        assert_eq!(f.next_account_id("DEGEN".into()), acc("degen-2.factory.testnet"));
    }

    #[test]
    #[should_panic(expected = "attach at least")]
    fn a_launch_without_the_deposit_is_refused() {
        let mut f = factory();
        at("alice.testnet", NearToken::from_near(1));
        let _ = f.create_coin(config("DEGEN"));
    }

    #[test]
    #[should_panic(expected = "bad ticker")]
    fn a_bad_ticker_is_refused() {
        let mut f = factory();
        at("alice.testnet", f.required_deposit());
        let _ = f.create_coin(config("de-gen"));
    }

    #[test]
    #[should_panic(expected = "weights must sum to 10000")]
    fn bad_weights_are_refused_before_deploying() {
        let mut f = factory();
        at("alice.testnet", f.required_deposit());
        let mut c = config("DEGEN");
        c.basket[0].weight_bps = 1;
        let _ = f.create_coin(c);
    }

    #[test]
    #[should_panic(expected = "duplicate asset")]
    fn a_basket_listing_one_asset_twice_is_refused() {
        let mut f = factory();
        at("alice.testnet", f.required_deposit());
        let mut c = config("DEGEN");
        c.basket[1].token_id = c.basket[0].token_id.clone();
        let _ = f.create_coin(c);
    }

    fn after_create(f: &mut Factory, result: PromiseResult) -> Option<AccountId> {
        testing_env!(
            VMContextBuilder::new().current_account_id(acc("factory.testnet")).predecessor_account_id(acc("factory.testnet")).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
        f.on_create(
            CoinInfo { account_id: acc("degen-0.factory.testnet"), ticker: "DEGEN".into(), name: "Degen".into(), creator: acc("alice.testnet"), created_ms: 0 },
            acc("payer.testnet"),
            U128(5),
        )
    }

    #[test]
    fn a_successful_deploy_is_added_to_the_registry() {
        let mut f = factory();
        assert_eq!(after_create(&mut f, PromiseResult::Successful(vec![])), Some(acc("degen-0.factory.testnet")));
        assert_eq!(f.list_coins(None, None).len(), 1);
        assert_eq!(f.get_coin(acc("degen-0.factory.testnet")).unwrap().ticker, "DEGEN");
    }

    #[test]
    fn a_failed_deploy_is_not_registered() {
        let mut f = factory();
        assert_eq!(after_create(&mut f, PromiseResult::Failed), None);
        assert!(f.list_coins(None, None).is_empty());
    }
}
