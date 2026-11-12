//! Testnet stand-in for the NEAR Intents verifier (intents.near): a NEP-245 subset
//! with the same call shapes, plus a faucet. Not for mainnet.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, Gas, PanicOnDefault, PromiseOrValue,
};

/// Same limit as intents.near (`BATCH_MAX_TOKENS`).
pub const BATCH_MAX_TOKENS: usize = 10;
/// Faucet cap per call, in raw units.
pub const FAUCET_MAX: u128 = 1_000_000_000_000_000_000_000_000_000_000;
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(20);

#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[ext_contract(ext_self)]
pub trait SelfResolve {
    fn mt_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> Vec<U128>;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockIntents {
    balances: LookupMap<String, u128>,
}

fn key(account_id: &AccountId, token_id: &str) -> String {
    format!("{account_id}|{token_id}")
}

#[near]
impl MockIntents {
    #[init]
    pub fn new() -> Self {
        Self { balances: LookupMap::new(b"b") }
    }

    /// Mint test balances. Testnet only.
    pub fn faucet(&mut self, token_id: String, amount: U128, receiver_id: Option<AccountId>) {
        require!(amount.0 <= FAUCET_MAX, "faucet cap exceeded");
        let to = receiver_id.unwrap_or_else(env::predecessor_account_id);
        self.add(&to, &token_id, amount.0);
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.balance(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.balance(&account_id, t))).collect()
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        self.mt_batch_transfer(receiver_id, vec![token_id], vec![amount], approval.map(|a| vec![Some(a)]), memo)
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approvals.is_none(), "approvals are not supported");
        let _ = memo;
        let sender = env::predecessor_account_id();
        self.move_all(&sender, &receiver_id, &token_ids, &amounts);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        self.mt_batch_transfer_call(receiver_id, vec![token_id], vec![amount], approval.map(|a| vec![Some(a)]), memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(approvals.is_none(), "approvals are not supported");
        require!(token_ids.len() <= BATCH_MAX_TOKENS, "too many tokens");
        let _ = memo;
        let sender = env::predecessor_account_id();
        self.move_all(&sender, &receiver_id, &token_ids, &amounts);
        ext_mt_receiver::ext(receiver_id.clone())
            .with_unused_gas_weight(1)
            .mt_on_transfer(sender.clone(), vec![sender.clone(); token_ids.len()], token_ids.clone(), amounts.clone(), msg)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE)
                    .with_unused_gas_weight(0)
                    .mt_resolve_transfer(sender, receiver_id, token_ids, amounts),
            )
            .into()
    }

    /// Refund what the receiver returned as unused: min(returned, sent, receiver balance).
    /// A failed or malformed callback refunds everything sent. Returns the amounts used.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> Vec<U128> {
        let unused: Vec<u128> = match env::promise_result_checked(0, 4_096) {
            Ok(bytes) => match near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes) {
                Ok(v) if v.len() == amounts.len() => v.into_iter().map(|x| x.0).collect(),
                _ => amounts.iter().map(|a| a.0).collect(),
            },
            Err(_) => amounts.iter().map(|a| a.0).collect(),
        };
        let mut used = Vec::with_capacity(amounts.len());
        for ((token_id, sent), back) in token_ids.iter().zip(&amounts).zip(unused) {
            let refund = back.min(sent.0).min(self.balance(&receiver_id, token_id));
            if refund > 0 {
                self.sub(&receiver_id, token_id, refund);
                self.add(&sender_id, token_id, refund);
            }
            used.push(U128(sent.0 - refund));
        }
        used
    }
}

impl MockIntents {
    fn balance(&self, account_id: &AccountId, token_id: &str) -> u128 {
        self.balances.get(&key(account_id, token_id)).copied().unwrap_or(0)
    }

    fn add(&mut self, account_id: &AccountId, token_id: &str, amount: u128) {
        let b = self.balance(account_id, token_id);
        self.balances.insert(key(account_id, token_id), b.checked_add(amount).expect("overflow"));
    }

    fn sub(&mut self, account_id: &AccountId, token_id: &str, amount: u128) {
        let b = self.balance(account_id, token_id);
        require!(b >= amount, "insufficient balance");
        self.balances.insert(key(account_id, token_id), b - amount);
    }

    fn move_all(&mut self, from: &AccountId, to: &AccountId, token_ids: &[String], amounts: &[U128]) {
        require!(token_ids.len() == amounts.len() && !token_ids.is_empty(), "bad batch");
        require!(from != to, "sender and receiver are the same");
        for (t, a) in token_ids.iter().zip(amounts) {
            require!(a.0 > 0, "zero amount");
            self.sub(from, t, a.0);
            self.add(to, t, a.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken, PromiseResult};

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn as_caller(who: &str, yocto: u128) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(acc(who))
            .attached_deposit(NearToken::from_yoctonear(yocto))
            .build());
    }

    const USDC: &str = "nep141:usdc.mock";

    #[test]
    fn the_faucet_credits_the_caller() {
        as_caller("alice.testnet", 0);
        let mut c = MockIntents::new();
        c.faucet(USDC.into(), U128(500), None);
        assert_eq!(c.mt_balance_of(acc("alice.testnet"), USDC.into()), U128(500));
    }

    #[test]
    fn a_transfer_moves_balance_and_needs_one_yocto() {
        as_caller("alice.testnet", 0);
        let mut c = MockIntents::new();
        c.faucet(USDC.into(), U128(500), None);
        as_caller("alice.testnet", 1);
        c.mt_transfer(acc("bob.testnet"), USDC.into(), U128(200), None, None);
        assert_eq!(c.mt_balance_of(acc("alice.testnet"), USDC.into()), U128(300));
        assert_eq!(c.mt_balance_of(acc("bob.testnet"), USDC.into()), U128(200));
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn a_transfer_without_one_yocto_is_refused() {
        as_caller("alice.testnet", 0);
        let mut c = MockIntents::new();
        c.faucet(USDC.into(), U128(500), None);
        c.mt_transfer(acc("bob.testnet"), USDC.into(), U128(200), None, None);
    }

    #[test]
    #[should_panic(expected = "insufficient balance")]
    fn a_transfer_beyond_the_balance_is_refused() {
        as_caller("alice.testnet", 0);
        let mut c = MockIntents::new();
        c.faucet(USDC.into(), U128(5), None);
        as_caller("alice.testnet", 1);
        c.mt_transfer(acc("bob.testnet"), USDC.into(), U128(6), None, None);
    }

    fn with_promise_result(result: PromiseResult) {
        testing_env!(
            VMContextBuilder::new()
                .current_account_id(acc("intents.testnet"))
                .predecessor_account_id(acc("intents.testnet"))
                .build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }

    fn funded_and_sent() -> MockIntents {
        as_caller("alice.testnet", 0);
        let mut c = MockIntents::new();
        c.faucet(USDC.into(), U128(100), None);
        as_caller("alice.testnet", 1);
        let _ = c.mt_transfer_call(acc("coin.testnet"), USDC.into(), U128(40), None, None, "{}".into());
        c
    }

    #[test]
    fn transfer_call_refunds_what_the_receiver_returns_as_unused() {
        let mut c = funded_and_sent();
        with_promise_result(PromiseResult::Successful(serde_json::to_vec(&vec![U128(15)]).unwrap()));
        let used = c.mt_resolve_transfer(acc("alice.testnet"), acc("coin.testnet"), vec![USDC.into()], vec![U128(40)]);
        assert_eq!(used, vec![U128(25)]);
        assert_eq!(c.mt_balance_of(acc("alice.testnet"), USDC.into()), U128(75));
        assert_eq!(c.mt_balance_of(acc("coin.testnet"), USDC.into()), U128(25));
    }

    #[test]
    fn a_failed_receiver_gets_everything_refunded() {
        let mut c = funded_and_sent();
        with_promise_result(PromiseResult::Failed);
        c.mt_resolve_transfer(acc("alice.testnet"), acc("coin.testnet"), vec![USDC.into()], vec![U128(40)]);
        assert_eq!(c.mt_balance_of(acc("alice.testnet"), USDC.into()), U128(100));
        assert_eq!(c.mt_balance_of(acc("coin.testnet"), USDC.into()), U128(0));
    }

    #[test]
    #[should_panic(expected = "too many tokens")]
    fn a_batch_call_with_more_than_10_tokens_is_refused() {
        as_caller("alice.testnet", 0);
        let mut c = MockIntents::new();
        let ids: Vec<String> = (0..11).map(|i| format!("nep141:t{i}.mock")).collect();
        for id in &ids {
            c.faucet(id.clone(), U128(1), None);
        }
        as_caller("alice.testnet", 1);
        let _ = c.mt_batch_transfer_call(acc("coin.testnet"), ids, vec![U128(1); 11], None, None, "{}".into());
    }
}
