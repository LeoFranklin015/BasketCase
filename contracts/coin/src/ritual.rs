//! The seat challenge: holders burn to replace a basket asset or to defend it; a winning
//! challenge opens a Dutch auction that swaps the asset. Prices only set the auction's start.

use crate::events::emit;
use crate::trade::{refund, Refund};
use crate::*;
use curve_math::{auction_out, auction_rate, fair_rate, min_challenge_burn, redeem};
use near_sdk::serde_json::json;


#[near]
impl Coin {
    /// Reporter only: USD per raw unit, scaled 1e36.
    pub fn report_prices(&mut self, prices: Vec<(String, U128)>) {
        require!(env::predecessor_account_id() == self.cfg.reporter, "only the reporter");
        let ts = now_ms();
        for (token_id, p) in prices {
            require!(p.0 > 0, "zero price");
            match self.prices.iter_mut().find(|(t, _, _)| *t == token_id) {
                Some(e) => {
                    e.1 = p.0;
                    e.2 = ts;
                }
                None => self.prices.push((token_id, p.0, ts)),
            }
        }
    }

    /// Burn `amount` to back replacing `target` with `replacement`. Burns are never refunded.
    /// Returns the BU value of the burn, which counts toward the challenge.
    #[payable]
    pub fn challenge(&mut self, target: String, replacement: String, amount: U128) -> U128 {
        near_sdk::assert_one_yocto();
        let who = env::predecessor_account_id();
        let slot = self.slot(&target).unwrap_or_else(|| env::panic_str("target is not in the basket"));
        require!(!slot.anchored, "anchored assets cannot be challenged");
        require!(slot.held > 0 || slot.q > 0, "target is not active");
        require!(self.slot(&replacement).is_none(), "replacement is already in the basket");
        require!(!replacement.is_empty() && replacement.len() <= 128, "bad replacement id");
        let existing = self.challenges.iter().position(|c| c.target == target && c.replacement == replacement);
        require!(existing.is_some() || self.challenges.len() < MAX_CHALLENGES, "too many open challenges this epoch");
        let value = self.burn_for_ritual(&who, amount.0, "challenge");
        match existing {
            Some(i) => {
                let c = &mut self.challenges[i];
                c.burned_bu += value;
                if value > c.top_burn {
                    c.top_burn = value;
                    c.top_challenger = who.clone();
                }
            }
            None => self.challenges.push(Challenge {
                target: target.clone(),
                replacement: replacement.clone(),
                burned_bu: value,
                top_challenger: who.clone(),
                top_burn: value,
            }),
        }
        emit("challenge", json!({ "account_id": who, "target": target, "replacement": replacement, "tokens": amount, "bu": U128(value), "epoch": self.epoch_index }));
        U128(value)
    }

    /// Burn `amount` to keep `target` in the basket this epoch.
    #[payable]
    pub fn defend(&mut self, target: String, amount: U128) -> U128 {
        near_sdk::assert_one_yocto();
        let who = env::predecessor_account_id();
        let slot = self.slot(&target).unwrap_or_else(|| env::panic_str("target is not in the basket"));
        require!(!slot.anchored, "anchored assets need no defense");
        let value = self.burn_for_ritual(&who, amount.0, "defend");
        match self.defenses.iter_mut().find(|(t, _)| *t == target) {
            Some(e) => e.1 += value,
            None => self.defenses.push((target.clone(), value)),
        }
        emit("defend", json!({ "account_id": who, "target": target, "tokens": amount, "bu": U128(value), "epoch": self.epoch_index }));
        U128(value)
    }

    /// Anyone, once the epoch has ended. The biggest challenge that beats the defense and burned
    /// at least the minimum opens an auction (if none is open and prices are fresh).
    pub fn close_epoch(&mut self) -> String {
        let now = now_ms();
        require!(now >= self.epoch_start_ms + self.cfg.epoch_ms, "the epoch has not ended");
        self.advance_mode();
        let b_total = self.b_total();
        let winner = self
            .challenges
            .iter()
            .filter(|c| {
                let Some(slot) = self.slot(&c.target) else { return false };
                let defense = self.defenses.iter().find(|(t, _)| *t == c.target).map(|d| d.1).unwrap_or(0);
                let min = min_challenge_burn(b_total, slot.weight_bps as u128, MIN_CHALLENGE_BPS);
                !slot.anchored && c.burned_bu > defense && c.burned_bu >= min && self.slot(&c.replacement).is_none()
            })
            .max_by_key(|c| c.burned_bu)
            .cloned();
        let outcome = match winner {
            None => "no_winning_challenge".to_string(),
            Some(_) if self.auction.is_some() => "auction_already_open".to_string(),
            Some(c) => match (self.fresh_price(&c.target, now), self.fresh_price(&c.replacement, now)) {
                (Some(pt), Some(pr)) => {
                    self.open_auction(&c, fair_rate(pt, pr), now);
                    "auction_opened".to_string()
                }
                _ => "no_fresh_prices".to_string(),
            },
        };
        emit("epoch_closed", json!({ "epoch": self.epoch_index, "outcome": outcome }));
        self.challenges.clear();
        self.defenses.clear();
        self.epoch_index += 1;
        self.epoch_start_ms = now;
        outcome
    }
}

impl Coin {
    pub(crate) fn slot(&self, token_id: &str) -> Option<&Slot> {
        self.basket.iter().find(|s| s.token_id == token_id)
    }

    fn slot_index(&self, token_id: &str) -> Option<usize> {
        self.basket.iter().position(|s| s.token_id == token_id)
    }

    fn fresh_price(&self, token_id: &str, now: u64) -> Option<u128> {
        self.prices
            .iter()
            .find(|(t, _, ts)| t == token_id && now.saturating_sub(*ts) <= self.cfg.staleness_ms)
            .map(|(_, p, _)| *p)
    }

    /// Burn for a ritual. Curve mode: the burned tokens' curve value moves to the surplus, so s
    /// rises. Index mode: supply falls and the reserve stays, so the floor rises.
    fn burn_for_ritual(&mut self, who: &AccountId, t: u128, reason: &str) -> u128 {
        require!(t > 0, "zero amount");
        self.advance_mode();
        let value = match self.mode {
            Mode::Launch => env::panic_str("the fair launch has not settled yet"),
            Mode::Curve => {
                let s = curve().sell(&self.curve_state(), t);
                self.burn_tokens(who, t);
                self.reserve -= s.curve_out;
                self.surplus += s.curve_out;
                self.sold -= t;
                s.curve_out + s.surplus_out
            }
            Mode::Index => {
                let v = redeem(t, self.reserve, self.supply(), 0).gross;
                self.burn_tokens(who, t);
                v
            }
        };
        self.log_entry("burn", who, t, value, reason);
        emit("burn", json!({ "account_id": who, "tokens": U128(t), "bu": U128(value), "reason": reason }));
        self.sweep_orphan_surplus();
        value
    }

    fn open_auction(&mut self, c: &Challenge, fair: u128, now: u64) {
        let target_weight = self.slot(&c.target).map(|s| s.weight_bps).unwrap_or(0);
        let target_total = self.slot(&c.target).map(|s| s.held).unwrap_or(0);
        self.basket.push(Slot {
            token_id: c.replacement.clone(),
            q: 0,
            held: 0,
            anchored: false,
            weight_bps: target_weight,
            joined_epoch: self.epoch_index + 1,
        });
        let id = self.next_auction_id;
        self.next_auction_id += 1;
        self.auction = Some(Auction {
            id,
            target: c.target.clone(),
            replacement: c.replacement.clone(),
            target_total,
            replacement_received: 0,
            fair_rate: fair,
            start_ms: now,
            challenger: c.top_challenger.clone(),
            joined_epoch: self.epoch_index + 1,
        });
        emit("auction_opened", json!({ "id": id, "target": c.target, "replacement": c.replacement, "fair_rate": U128(fair), "target_total": U128(target_total) }));
    }

    /// A bidder sends the replacement and receives target units at the current auction rate.
    pub(crate) fn fill_auction(&mut self, sender: &AccountId, token_ids: Vec<String>, amounts: Vec<U128>, min_out: u128) -> Refund {
        let Some(a) = self.auction.clone() else { return refund(sender, amounts, "no_auction") };
        if token_ids.len() != 1 || token_ids[0] != a.replacement {
            return refund(sender, amounts, "wrong_token");
        }
        let (ti, ri) = (self.slot_index(&a.target).unwrap(), self.slot_index(&a.replacement).unwrap());
        let held_t = self.basket[ti].held;
        if held_t == 0 {
            self.finish_auction();
            return refund(sender, amounts, "auction_done");
        }
        let amount_in = amounts[0].0;
        let rate = auction_rate(a.fair_rate, AUCTION_PREMIUM_BPS, a.start_ms, self.cfg.auction_ms, now_ms());
        let mut out = auction_out(amount_in, rate);
        let mut used_in = amount_in;
        if out > held_t {
            out = held_t;
            used_in = curve_math::mul_div_ceil(out, rate, E18);
            used_in = used_in.min(amount_in);
        }
        if out == 0 || out < min_out {
            return refund(sender, amounts, "below_min_out");
        }
        self.basket[ti].held -= out;
        self.basket[ri].held += used_in;
        if let Some(au) = self.auction.as_mut() {
            au.replacement_received += used_in;
        }
        self.rewrite_q();
        emit("auction_fill", json!({ "id": a.id, "account_id": sender, "paid": U128(used_in), "received": U128(out), "rate": U128(rate) }));
        let target_id = a.target.clone();
        self.send(sender, vec![target_id], vec![out]);
        if self.basket[ti].held == 0 {
            self.finish_auction();
        }
        PromiseOrValue::Value(vec![U128(amount_in - used_in)])
    }

    /// q follows what the vault actually holds, so the next buyer sends the current mix.
    pub(crate) fn rewrite_q(&mut self) {
        let b = self.b_total();
        if b == 0 {
            return;
        }
        for s in self.basket.iter_mut() {
            s.q = if s.held == 0 { 0 } else { curve_math::mul_div_ceil(s.held, E18, b) };
        }
    }

    fn finish_auction(&mut self) {
        let Some(a) = self.auction.take() else { return };
        if let Some(ti) = self.slot_index(&a.target) {
            let removed = self.basket.remove(ti);
            self.tombstones.push(Tombstone {
                token_id: removed.token_id.clone(),
                joined_epoch: removed.joined_epoch,
                removed_epoch: self.epoch_index,
                challenger: a.challenger.clone(),
                rate: U128(a.fair_rate),
                ts_ms: now_ms(),
            });
        }
        self.rewrite_q();
        let basket: Vec<_> = self.basket.iter().map(|s| json!({ "token_id": s.token_id, "q": U128(s.q) })).collect();
        emit("basket_changed", json!({ "removed": a.target, "added": a.replacement, "basket": basket }));
    }
}
