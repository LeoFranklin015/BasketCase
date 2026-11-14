//! Assets arriving from the verifier: buys (fair launch, curve, pool) and auction fills.

use crate::events::emit;
use crate::*;
use curve_math::{amounts_for_bu, bu_from_amounts, fee_of, pool_buy};
use near_sdk::serde_json::json;

#[near(serializers = [json])]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    /// `deliver`: mint into the verifier (NEAR Intents) and credit `recipient` (default: the sender) there, so a
    /// buyer who signed with MetaMask or Phantom holds the tokens under their own NEAR Intents account.
    Buy { recipient: Option<AccountId>, min_tokens_out: Option<U128>, deliver: Option<bool> },
    FillAuction { min_out: Option<U128> },
}

pub(crate) type Refund = PromiseOrValue<Vec<U128>>;

#[near]
impl Coin {
    /// Entry point for every asset arriving on the verifier. Returns the unused amount of each
    /// token, which the verifier refunds. Bad requests refund everything instead of panicking.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(env::predecessor_account_id() == self.cfg.verifier, "only the verifier");
        let _ = previous_owner_ids;
        require!(token_ids.len() == amounts.len(), "length mismatch");
        let Ok(msg) = near_sdk::serde_json::from_str::<TransferMsg>(&msg) else {
            return refund(&sender_id, amounts, "bad_msg");
        };
        match msg {
            TransferMsg::Buy { recipient, min_tokens_out, deliver } => {
                let recipient = recipient.unwrap_or_else(|| sender_id.clone());
                let min = min_tokens_out.map(|m| m.0).unwrap_or(0);
                if deliver != Some(true) {
                    return self.buy(&sender_id, &recipient, token_ids, amounts, min);
                }
                // Queued fair-launch buys are minted later, without a notification: deliver only after it.
                self.advance_mode();
                if self.mode == Mode::Launch {
                    return refund(&sender_id, amounts, "deliver_after_launch");
                }
                let verifier = self.cfg.verifier.clone();
                let before = self.token.ft_balance_of(verifier.clone()).0;
                let out = self.buy(&sender_id, &verifier, token_ids, amounts, min);
                let minted = self.token.ft_balance_of(verifier.clone()).0 - before;
                if minted > 0 {
                    self.notify_verifier(&recipient, minted);
                }
                out
            }
            TransferMsg::FillAuction { min_out } => {
                self.fill_auction(&sender_id, token_ids, amounts, min_out.map(|m| m.0).unwrap_or(0))
            }
        }
    }
}

pub(crate) fn refund(sender: &AccountId, amounts: Vec<U128>, reason: &str) -> Refund {
    emit("refund", json!({ "account_id": sender, "reason": reason }));
    PromiseOrValue::Value(amounts)
}

impl Coin {
    /// Active slots (q > 0) in basket order: what a buyer must send.
    pub(crate) fn active_slots(&self) -> Vec<usize> {
        (0..self.basket.len()).filter(|&i| self.basket[i].q > 0).collect()
    }

    /// Match the sent tokens to the active slots. Returns amounts in slot order, or None.
    fn order_amounts(&self, token_ids: &[String], amounts: &[U128]) -> Option<(Vec<usize>, Vec<u128>, Vec<usize>)> {
        let active = self.active_slots();
        if token_ids.len() != active.len() {
            return None;
        }
        // pos[k] = index in token_ids of active slot k
        let mut pos = Vec::with_capacity(active.len());
        for &i in &active {
            let id = &self.basket[i].token_id;
            let matches: Vec<usize> = (0..token_ids.len()).filter(|&j| &token_ids[j] == id).collect();
            if matches.len() != 1 {
                return None;
            }
            pos.push(matches[0]);
        }
        let ordered = pos.iter().map(|&j| amounts[j].0).collect();
        Some((active, ordered, pos))
    }

    fn buy(&mut self, sender: &AccountId, recipient: &AccountId, token_ids: Vec<String>, amounts: Vec<U128>, min_tokens: u128) -> Refund {
        if !self.is_registered(recipient) {
            return refund(sender, amounts, "not_registered");
        }
        self.advance_mode();
        let Some((active, ordered, pos)) = self.order_amounts(&token_ids, &amounts) else {
            return refund(sender, amounts, "basket_mismatch");
        };
        let q: Vec<u128> = active.iter().map(|&i| self.basket[i].q).collect();
        let bu_in = bu_from_amounts(&ordered, &q);
        if bu_in == 0 {
            return refund(sender, amounts, "too_small");
        }
        let fee_bps = self.cfg.fee_bps as u128;
        let fee = fee_of(bu_in, fee_bps);
        let net = bu_in - fee;

        let bu_used = match self.mode {
            Mode::Launch => {
                if now_ms() >= self.cfg.launch_ms + self.cfg.window_ms {
                    return refund(sender, amounts, "launch_settling");
                }
                if net < MIN_QUEUE_BU {
                    return refund(sender, amounts, "below_min_deposit");
                }
                if self.queued + net > QUEUE_CAP_BU {
                    return refund(sender, amounts, "window_full");
                }
                self.queued += net;
                self.credit_fee(fee);
                self.queue.push((recipient.clone(), net));
                emit("queue", json!({ "account_id": recipient, "bu_in": U128(bu_in), "net": U128(net) }));
                bu_in
            }
            Mode::Curve => {
                let b = curve().buy(&self.curve_state(), net);
                if b.tokens == 0 {
                    return refund(sender, amounts, "too_small");
                }
                if b.tokens < min_tokens {
                    return refund(sender, amounts, "slippage");
                }
                let (bu_used, fee_used) = if b.graduates {
                    let net_used = b.curve_cost + b.surplus_part;
                    let bu_used = (net_used * curve_math::BPS).div_ceil(curve_math::BPS - fee_bps).min(bu_in);
                    (bu_used, bu_used - net_used)
                } else {
                    (bu_in, fee)
                };
                self.reserve += b.curve_cost;
                self.surplus += b.surplus_part;
                self.sold += b.tokens;
                self.credit_fee(fee_used);
                self.mint_tokens(recipient, b.tokens);
                self.log_entry("mint", recipient, b.tokens, bu_used, "buy");
                emit("buy", json!({ "account_id": recipient, "bu_in": U128(bu_used), "fee": U128(fee_used), "tokens_out": U128(b.tokens), "price_after": U128(self.price_now()) }));
                if b.graduates {
                    self.graduate();
                }
                bu_used
            }
            Mode::Index => {
                let tokens = pool_buy(self.pool_bu, self.pool_tokens(), net);
                if tokens == 0 {
                    return refund(sender, amounts, "too_small");
                }
                if tokens < min_tokens {
                    return refund(sender, amounts, "slippage");
                }
                self.pool_bu += net;
                self.credit_fee(fee);
                let me = env::current_account_id();
                self.token.internal_withdraw(&me, tokens);
                self.token.internal_deposit(recipient, tokens);
                near_contract_standards::fungible_token::events::FtTransfer {
                    old_owner_id: &me,
                    new_owner_id: recipient,
                    amount: U128(tokens),
                    memo: Some("pool buy"),
                }
                .emit();
                emit("buy", json!({ "account_id": recipient, "bu_in": U128(bu_in), "fee": U128(fee), "tokens_out": U128(tokens), "path": "pool", "price_after": U128(self.price_now()) }));
                bu_in
            }
        };

        // Take exactly the assets for bu_used; return the rest in the caller's token order.
        let used = amounts_for_bu(bu_used, &q);
        let mut unused: Vec<U128> = amounts.clone();
        for (k, &i) in active.iter().enumerate() {
            self.basket[i].held += used[k];
            let j = pos[k];
            unused[j] = U128(amounts[j].0 - used[k]);
        }
        PromiseOrValue::Value(unused)
    }

    /// The curve is full: 20% of the backing seeds the pool, 80% backs redemptions. Minting stops.
    pub(crate) fn graduate(&mut self) {
        let g = curve().graduate(&self.curve_state(), POOL_SHARE_BPS);
        self.pool_bu = g.pool_bu;
        self.reserve = g.reserve;
        self.surplus = 0;
        let me = env::current_account_id();
        self.token.internal_deposit(&me, g.pool_tokens);
        near_contract_standards::fungible_token::events::FtMint { owner_id: &me, amount: U128(g.pool_tokens), memo: Some("pool") }.emit();
        self.mode = Mode::Index;
        self.graduated_ms = Some(now_ms());
        self.log_entry("mint", &me, g.pool_tokens, g.pool_bu, "graduation_pool");
        emit("graduated", json!({ "pool_bu": U128(g.pool_bu), "reserve": U128(g.reserve), "pool_tokens": U128(g.pool_tokens) }));
    }
}
