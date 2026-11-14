//! Assets leaving the vault: sells, redeems, fee claims, owed retries. Every payout is pro rata
//! of what the vault holds; a failed transfer is written to the owed ledger, never undone.

use crate::events::emit;
use crate::*;
use curve_math::{fee_of, payout, pool_sell, redeem as redeem_value};
use near_sdk::serde_json::json;
use near_sdk::{ext_contract, Gas};

const GAS_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_ON_PAYOUT: Gas = Gas::from_tgas(10);

#[allow(dead_code)]
#[ext_contract(ext_verifier)]
pub trait Verifier {
    fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    );
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
pub trait SelfPayout {
    fn on_payout(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>);
}

#[near]
impl Coin {
    /// Sell tokens. Curve mode: curve price plus your share of the surplus, minus the fee.
    /// Index mode: whichever pays more of the pool or redeeming. Assets go to `receiver_id`
    /// (default: you) on the verifier. Returns the BU paid out.
    #[payable]
    pub fn sell(&mut self, amount: U128, min_bu_out: U128, receiver_id: Option<AccountId>) -> U128 {
        near_sdk::assert_one_yocto();
        let seller = env::predecessor_account_id();
        let to = receiver_id.unwrap_or_else(|| seller.clone());
        U128(self.sell_from(&seller, &to, amount.0, min_bu_out.0))
    }

    /// Index mode: burn tokens for their share of the reserve, minus 0.5% that stays behind.
    #[payable]
    pub fn redeem(&mut self, amount: U128, receiver_id: Option<AccountId>) -> U128 {
        near_sdk::assert_one_yocto();
        require!(self.mode == Mode::Index, "redeem opens at graduation");
        require!(amount.0 > 0, "zero amount");
        let seller = env::predecessor_account_id();
        let to = receiver_id.unwrap_or_else(|| seller.clone());
        self.redeem_inner(&seller, &to, amount.0)
    }

    /// Pay the creator's and the protocol's fee shares, in kind.
    pub fn claim_fees(&mut self) {
        let (c, p) = (self.creator_owed, self.protocol_owed);
        require!(c + p > 0, "nothing to claim");
        if c > 0 {
            let (ids, amts) = self.take_assets(c);
            self.creator_owed = 0;
            let to = self.cfg.creator.clone();
            self.send(&to, ids, amts);
        }
        if p > 0 {
            let (ids, amts) = self.take_assets(p);
            self.protocol_owed = 0;
            let to = self.cfg.protocol.clone();
            self.send(&to, ids, amts);
        }
        emit("fees_claimed", json!({ "creator_bu": U128(c), "protocol_bu": U128(p) }));
    }

    /// Retry payouts that failed earlier. Anyone can call it for any account.
    pub fn withdraw_owed(&mut self, account_id: AccountId) {
        let entries = self.owed.remove(&account_id).unwrap_or_default();
        require!(!entries.is_empty(), "nothing owed");
        let (ids, amts): (Vec<String>, Vec<u128>) = entries.into_iter().unzip();
        self.send(&account_id, ids, amts);
    }

    #[private]
    pub fn on_payout(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>) {
        if env::promise_result_checked(0, 64).is_err() {
            let mut owed = self.owed.get(&receiver_id).cloned().unwrap_or_default();
            for (t, a) in token_ids.iter().zip(&amounts) {
                match owed.iter_mut().find(|(id, _)| id == t) {
                    Some(e) => e.1 += a.0,
                    None => owed.push((t.clone(), a.0)),
                }
            }
            self.owed.insert(receiver_id.clone(), owed);
            emit("payout_failed", json!({ "account_id": receiver_id, "token_ids": token_ids, "amounts": amounts }));
        }
    }
}

impl Coin {
    fn redeem_inner(&mut self, seller: &AccountId, to: &AccountId, t: u128) -> U128 {
        let r = redeem_value(t, self.reserve, self.supply(), REDEEM_FEE_BPS);
        require!(r.out > 0, "too small");
        self.burn_tokens(seller, t);
        let (ids, amts) = self.take_assets(r.out);
        self.reserve -= r.out;
        self.log_entry("burn", seller, t, r.out, "redeem");
        emit("redeem", json!({ "account_id": seller, "tokens": U128(t), "bu_out": U128(r.out), "fee": U128(r.fee) }));
        self.send(to, ids, amts);
        U128(r.out)
    }

    /// Remove `bu` worth of assets from `held`, pro rata; call before shrinking the BU buckets.
    pub(crate) fn take_assets(&mut self, bu: u128) -> (Vec<String>, Vec<u128>) {
        let held: Vec<u128> = self.basket.iter().map(|s| s.held).collect();
        let amts = payout(&held, bu, self.b_total());
        let mut out = (vec![], vec![]);
        for (slot, a) in self.basket.iter_mut().zip(amts) {
            if a > 0 {
                slot.held -= a;
                out.0.push(slot.token_id.clone());
                out.1.push(a);
            }
        }
        out
    }

    pub(crate) fn send(&mut self, to: &AccountId, ids: Vec<String>, amts: Vec<u128>) {
        if ids.is_empty() {
            return;
        }
        let amounts: Vec<U128> = amts.into_iter().map(U128).collect();
        ext_verifier::ext(self.cfg.verifier.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_TRANSFER)
            .mt_batch_transfer(to.clone(), ids.clone(), amounts.clone(), None, None)
            .then(ext_self::ext(env::current_account_id()).with_static_gas(GAS_ON_PAYOUT).on_payout(to.clone(), ids, amounts))
            .detach();
    }

    /// With no tokens in circulation, surplus belongs to no holder; leaving it would hand it to
    /// the next buyer (who pays s = 0). It goes to the protocol's fee share instead.
    pub(crate) fn sweep_orphan_surplus(&mut self) {
        if self.mode == Mode::Curve && self.sold == 0 && self.surplus > 0 {
            self.protocol_owed += self.surplus;
            self.surplus = 0;
        }
    }

    /// Account for tokens that disappeared outside a sell (e.g. a lost transfer): treat as a burn.
    pub(crate) fn account_burn(&mut self, t: u128) {
        if self.mode == Mode::Curve {
            let s = curve().sell(&self.curve_state(), t);
            self.reserve -= s.curve_out;
            self.surplus += s.curve_out;
            self.sold -= t;
            self.sweep_orphan_surplus();
        }
    }
}

impl Coin {
    /// What selling `t` tokens pays right now (BU), choosing pool or redeem like `sell_from`; never panics.
    pub(crate) fn sell_out(&self, t: u128) -> Result<u128, &'static str> {
        if t == 0 {
            return Err("zero amount");
        }
        match self.mode {
            Mode::Launch => Err("the fair launch has not settled yet"),
            Mode::Curve => {
                if t > self.sold {
                    return Err("more than was sold");
                }
                let s = curve().sell(&self.curve_state(), t);
                let gross = s.curve_out + s.surplus_out;
                Ok(gross - fee_of(gross, self.cfg.fee_bps as u128))
            }
            Mode::Index => {
                if t > self.supply() {
                    return Err("more than the supply");
                }
                let pool_gross = pool_sell(self.pool_bu, self.pool_tokens(), t);
                let pool_out = pool_gross - fee_of(pool_gross, self.cfg.fee_bps as u128);
                let r = redeem_value(t, self.reserve, self.supply(), REDEEM_FEE_BPS);
                let out = pool_out.max(r.out);
                if out == 0 { Err("too small") } else { Ok(out) }
            }
        }
    }

    /// Sell `t` tokens held by `seller`; assets go to `to` on the verifier. Returns the BU paid out.
    pub(crate) fn sell_from(&mut self, seller: &AccountId, to: &AccountId, t: u128, min_bu_out: u128) -> u128 {
        let seller = seller.clone();
        let to = to.clone();
        let amount = U128(t);
        require!(t > 0, "zero amount");
        self.advance_mode();
        match self.mode {
            Mode::Launch => env::panic_str("the fair launch has not settled yet"),
            Mode::Curve => {
                let s = curve().sell(&self.curve_state(), t);
                let gross = s.curve_out + s.surplus_out;
                let fee = fee_of(gross, self.cfg.fee_bps as u128);
                let out = gross - fee;
                require!(out >= min_bu_out, "slippage");
                self.burn_tokens(&seller, t);
                let (ids, amts) = self.take_assets(out);
                self.reserve -= s.curve_out;
                self.surplus -= s.surplus_out;
                self.sold -= t;
                self.credit_fee(fee);
                self.sweep_orphan_surplus();
                self.log_entry("burn", &seller, t, out, "sell");
                emit("sell", json!({ "account_id": seller, "tokens": amount, "bu_out": U128(out), "fee": U128(fee), "path": "curve", "price_after": U128(self.price_now()) }));
                self.send(&to, ids, amts);
                out
            }
            Mode::Index => {
                let pool_gross = pool_sell(self.pool_bu, self.pool_tokens(), t);
                let pool_fee = fee_of(pool_gross, self.cfg.fee_bps as u128);
                let pool_out = pool_gross - pool_fee;
                let r = redeem_value(t, self.reserve, self.supply(), REDEEM_FEE_BPS);
                if pool_out > r.out {
                    require!(pool_out >= min_bu_out, "slippage");
                    let me = env::current_account_id();
                    self.token.internal_withdraw(&seller, t);
                    self.token.internal_deposit(&me, t);
                    near_contract_standards::fungible_token::events::FtTransfer {
                        old_owner_id: &seller,
                        new_owner_id: &me,
                        amount,
                        memo: Some("pool sell"),
                    }
                    .emit();
                    let (ids, amts) = self.take_assets(pool_out);
                    self.pool_bu -= pool_gross;
                    self.credit_fee(pool_fee);
                    emit("sell", json!({ "account_id": seller, "tokens": amount, "bu_out": U128(pool_out), "fee": U128(pool_fee), "path": "pool", "price_after": U128(self.price_now()) }));
                    self.send(&to, ids, amts);
                    pool_out
                } else {
                    require!(r.out >= min_bu_out, "slippage");
                    self.redeem_inner(&seller, &to, t).0
                }
            }
        }
    }

}
