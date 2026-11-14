//! One memecoin: NEP-141 token, bonding curve with a two-part price, basket vault on the
//! Intents verifier, seat-challenge rituals, fair launch, and graduation into a built-in pool.
//! No method checks for an owner; the account has no access keys.

mod consts;
mod events;
mod exit;
mod launch;
mod ritual;
mod trade;
mod views;

#[cfg(test)]
mod tests;

use consts::*;
use curve_math::{Curve, CurveState};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::{LazyOption, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum Key {
    Token,
    Metadata,
    Queue,
    Tombstones,
    Log,
    Owed,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BasketInput {
    pub token_id: String,
    pub weight_bps: u16,
    pub q: U128,
    pub anchored: bool,
}

/// What the factory passes to `new`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct CoinInit {
    pub ticker: String,
    pub name: String,
    pub icon: Option<String>,
    pub basket: Vec<BasketInput>,
    pub fee_bps: u16,
    pub epoch_profile: String,
    pub bu_usd_e6: u64,
    pub creator: AccountId,
    pub protocol: AccountId,
    pub verifier: AccountId,
    pub reporter: AccountId,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Config {
    pub ticker: String,
    pub name: String,
    pub icon: Option<String>,
    pub factory: AccountId,
    pub creator: AccountId,
    pub protocol: AccountId,
    pub verifier: AccountId,
    pub reporter: AccountId,
    pub fee_bps: u16,
    pub epoch_profile: String,
    pub window_ms: u64,
    pub epoch_ms: u64,
    pub auction_ms: u64,
    pub staleness_ms: u64,
    pub bu_usd_e6: u64,
    pub launch_ms: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Slot {
    pub token_id: String,
    pub q: u128,
    pub held: u128,
    pub anchored: bool,
    pub weight_bps: u16,
    pub joined_epoch: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Launch,
    Curve,
    Index,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Challenge {
    pub target: String,
    pub replacement: String,
    pub burned_bu: u128,
    pub top_challenger: AccountId,
    pub top_burn: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Auction {
    pub id: u64,
    pub target: String,
    pub replacement: String,
    pub target_total: u128,
    pub replacement_received: u128,
    pub fair_rate: u128,
    pub start_ms: u64,
    pub challenger: AccountId,
    pub joined_epoch: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Tombstone {
    pub token_id: String,
    pub joined_epoch: u64,
    pub removed_epoch: u64,
    pub challenger: AccountId,
    pub rate: U128,
    pub ts_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LogEntry {
    pub ts_ms: u64,
    pub kind: String,
    pub account_id: AccountId,
    pub tokens: U128,
    pub bu: U128,
    pub reason: String,
    pub price_after: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Coin {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    cfg: Config,
    basket: Vec<Slot>,
    mode: Mode,
    // BU buckets (1e18). B_total = queued + reserve + surplus + creator_owed + protocol_owed + pool_bu.
    queued: u128,
    reserve: u128,
    surplus: u128,
    creator_owed: u128,
    protocol_owed: u128,
    pool_bu: u128,
    sold: u128,
    // Fair launch.
    queue: Vector<(AccountId, u128)>,
    settle_next: u32,
    settle_tokens: u128,
    settle_minted: u128,
    settle_bu: u128,
    // Rituals.
    epoch_index: u64,
    epoch_start_ms: u64,
    challenges: Vec<Challenge>,
    defenses: Vec<(String, u128)>,
    prices: Vec<(String, u128, u64)>,
    auction: Option<Auction>,
    next_auction_id: u64,
    tombstones: Vector<Tombstone>,
    // Liveness.
    log: Vector<LogEntry>,
    log_next: u32,
    owed: LookupMap<AccountId, Vec<(String, u128)>>,
    graduated_ms: Option<u64>,
}

pub(crate) fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

pub(crate) fn curve() -> Curve {
    Curve { x0: X0, y0: Y0, grad_reserve: GRAD_RESERVE }
}

fn valid_ticker(t: &str) -> bool {
    (2..=10).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

#[near]
impl Coin {
    #[init]
    pub fn new(init: CoinInit) -> Self {
        require!(valid_ticker(&init.ticker), "bad ticker");
        let n = init.basket.len();
        require!((BASKET_MIN..=BASKET_MAX).contains(&n), "basket must have 1 to 9 assets");
        let weights: u32 = init.basket.iter().map(|b| b.weight_bps as u32).sum();
        require!(weights == 10_000, "weights must sum to 10000");
        for (i, b) in init.basket.iter().enumerate() {
            require!(b.q.0 > 0 && b.weight_bps > 0, "zero q or weight");
            require!(init.basket[..i].iter().all(|o| o.token_id != b.token_id), "duplicate asset");
        }
        require!((FEE_MIN_BPS..=FEE_MAX_BPS).contains(&init.fee_bps), "fee out of range");
        let p = match init.epoch_profile.as_str() {
            "prod" => PROD,
            "demo" => DEMO,
            _ => env::panic_str("epoch_profile must be demo or prod"),
        };
        let launch_ms = now_ms();
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: init.name.clone(),
            symbol: init.ticker.clone(),
            icon: init.icon.clone(),
            reference: None,
            reference_hash: None,
            decimals: 18,
        };
        let mut this = Self {
            token: FungibleToken::new(Key::Token),
            metadata: LazyOption::new(Key::Metadata, Some(metadata)),
            cfg: Config {
                ticker: init.ticker,
                name: init.name,
                icon: init.icon,
                factory: env::predecessor_account_id(),
                creator: init.creator,
                protocol: init.protocol,
                verifier: init.verifier,
                reporter: init.reporter,
                fee_bps: init.fee_bps,
                epoch_profile: init.epoch_profile,
                window_ms: p.window_ms,
                epoch_ms: p.epoch_ms,
                auction_ms: p.auction_ms,
                staleness_ms: p.staleness_ms,
                bu_usd_e6: init.bu_usd_e6,
                launch_ms,
            },
            basket: init
                .basket
                .into_iter()
                .map(|b| Slot { token_id: b.token_id, q: b.q.0, held: 0, anchored: b.anchored, weight_bps: b.weight_bps, joined_epoch: 0 })
                .collect(),
            mode: Mode::Launch,
            queued: 0,
            reserve: 0,
            surplus: 0,
            creator_owed: 0,
            protocol_owed: 0,
            pool_bu: 0,
            sold: 0,
            queue: Vector::new(Key::Queue),
            settle_next: 0,
            settle_tokens: 0,
            settle_minted: 0,
            settle_bu: 0,
            epoch_index: 0,
            epoch_start_ms: launch_ms,
            challenges: vec![],
            defenses: vec![],
            prices: vec![],
            auction: None,
            next_auction_id: 0,
            tombstones: Vector::new(Key::Tombstones),
            log: Vector::new(Key::Log),
            log_next: 0,
            owed: LookupMap::new(Key::Owed),
            graduated_ms: None,
        };
        this.token.internal_register_account(&env::current_account_id());
        this
    }
}

impl Coin {
    pub(crate) fn curve_state(&self) -> CurveState {
        CurveState { reserve: self.reserve, surplus: self.surplus, sold: self.sold }
    }

    pub(crate) fn b_total(&self) -> u128 {
        self.queued + self.reserve + self.surplus + self.creator_owed + self.protocol_owed + self.pool_bu
    }

    pub(crate) fn pool_tokens(&self) -> u128 {
        self.token.ft_balance_of(env::current_account_id()).0
    }

    pub(crate) fn supply(&self) -> u128 {
        self.token.ft_total_supply().0
    }

    /// Fee split: vault share raises s (curve) or the floor (index).
    pub(crate) fn credit_fee(&mut self, fee: u128) {
        let s = curve_math::split_fee(fee);
        self.creator_owed += s.creator;
        self.protocol_owed += s.protocol;
        if self.mode == Mode::Index {
            self.reserve += s.vault;
        } else {
            self.surplus += s.vault;
        }
    }

    pub(crate) fn is_registered(&self, account_id: &AccountId) -> bool {
        self.token.storage_balance_of(account_id.clone()).is_some()
    }

    /// Burn tokens held by `account_id` (sell, challenge, defend, lost transfer).
    pub(crate) fn burn_tokens(&mut self, account_id: &AccountId, amount: u128) {
        self.token.internal_withdraw(account_id, amount);
        near_contract_standards::fungible_token::events::FtBurn { owner_id: account_id, amount: U128(amount), memo: None }.emit();
    }

    /// Tokens just minted to the verifier's balance: tell it (NEP-141 `ft_on_transfer`) whose they are. NEAR Intents
    /// reads `msg` as the receiver. Anything it doesn't take comes back to this contract via `ft_resolve_transfer`.
    pub(crate) fn notify_verifier(&mut self, receiver: &AccountId, amount: u128) {
        let me = env::current_account_id();
        let verifier = self.cfg.verifier.clone();
        near_contract_standards::fungible_token::events::FtTransfer { old_owner_id: &me, new_owner_id: &verifier, amount: U128(amount), memo: Some("buy delivered to NEAR Intents") }.emit();
        near_contract_standards::fungible_token::receiver::ext_ft_receiver::ext(verifier.clone())
            .with_static_gas(near_sdk::Gas::from_tgas(30))
            .ft_on_transfer(me.clone(), U128(amount), receiver.to_string())
            .then(Self::ext(me.clone()).with_static_gas(near_sdk::Gas::from_tgas(10)).ft_resolve_transfer(me, verifier, U128(amount)))
            .detach();
    }

    pub(crate) fn mint_tokens(&mut self, account_id: &AccountId, amount: u128) {
        if !self.is_registered(account_id) {
            self.token.internal_register_account(account_id);
        }
        self.token.internal_deposit(account_id, amount);
        near_contract_standards::fungible_token::events::FtMint { owner_id: account_id, amount: U128(amount), memo: None }.emit();
    }

    /// Price of the next token, BU per token (1e18).
    pub(crate) fn price_now(&self) -> u128 {
        match self.mode {
            Mode::Index => {
                let y = self.pool_tokens();
                if y == 0 { 0 } else { curve_math::mul_div(self.pool_bu, E18, y) }
            }
            _ => curve().price(&self.curve_state()),
        }
    }

    pub(crate) fn floor_now(&self) -> u128 {
        match self.mode {
            Mode::Index => {
                let s = self.supply();
                if s == 0 { 0 } else { curve_math::mul_div(self.reserve, E18, s) }
            }
            _ => curve().floor(&self.curve_state()),
        }
    }
}

/// A sell arriving from the verifier: `{"action":"sell","min_bu_out":"…","receiver_id":"…"}`. Assets go to
/// `receiver_id` on the verifier.
#[near(serializers = [json])]
pub struct SellMsg {
    pub min_bu_out: U128,
    pub receiver_id: AccountId,
}

// ---------- NEP-141 / NEP-145 / NEP-148 ----------

#[near]
impl FungibleTokenCore for Coin {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(receiver_id != env::current_account_id(), "use sell to trade with the pool");
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        if receiver_id == env::current_account_id() {
            // The one way to send coins to the coin itself: NEAR Intents withdrawing a holder's tokens with a
            // sell message (an `ft_withdraw` intent the holder signed, e.g. with MetaMask or Phantom).
            require!(env::predecessor_account_id() == self.cfg.verifier, "use sell to trade with the pool");
            // NEAR Intents does not refund a withdrawal whose `ft_transfer_call` panics, so nothing below may panic:
            // a sell that can't happen returns 0 used, and NEAR Intents credits the holder's tokens back.
            let Ok(m) = near_sdk::serde_json::from_str::<SellMsg>(&msg) else {
                env::log_str("sell refused: bad sell message");
                return PromiseOrValue::Value(U128(0));
            };
            self.advance_mode();
            match self.sell_out(amount.0) {
                Ok(out) if out >= m.min_bu_out.0 => {
                    let verifier = self.cfg.verifier.clone();
                    self.sell_from(&verifier, &m.receiver_id, amount.0, m.min_bu_out.0);
                    return PromiseOrValue::Value(amount);
                }
                Ok(_) => env::log_str("sell refused: slippage"),
                Err(why) => env::log_str(&format!("sell refused: {why}")),
            }
            return PromiseOrValue::Value(U128(0));
        }
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Coin {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            // Tokens burned because the sender unregistered mid-transfer: account for them as a burn.
            self.account_burn(burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Coin {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// Only empty accounts can unregister, so no tokens leave supply outside the curve's books.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        let who = env::predecessor_account_id();
        require!(self.token.ft_balance_of(who.clone()).0 == 0, "sell or transfer your tokens first");
        require!(!self.queue.iter().any(|(a, _)| *a == who), "you have a fair-launch deposit pending");
        self.token.internal_storage_unregister(Some(false)).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Coin {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().unwrap()
    }
}
