//! Read-only views, shaped exactly as docs/interface.md.

use crate::*;
use curve_math::{amounts_for_bu, auction_rate, fee_of, min_challenge_burn, payout, pool_buy, pool_sell, redeem};
use near_sdk::serde_json::{json, Value};

#[near]
impl Coin {
    pub fn get_config(&self) -> Value {
        let c = &self.cfg;
        json!({
            "ticker": c.ticker, "name": c.name, "icon": c.icon,
            "factory": c.factory, "creator": c.creator, "protocol": c.protocol,
            "verifier": c.verifier, "reporter": c.reporter,
            "fee_bps": c.fee_bps, "redeem_fee_bps": REDEEM_FEE_BPS as u64, "epoch_profile": c.epoch_profile,
            "epoch_len_ms": c.epoch_ms, "window_ms": c.window_ms, "auction_len_ms": c.auction_ms,
            "staleness_ms": c.staleness_ms, "bu_usd_e6": c.bu_usd_e6,
            "x0": U128(X0), "y0": U128(Y0), "grad_reserve": U128(GRAD_RESERVE),
            "launch_ms": c.launch_ms,
        })
    }

    pub fn get_state(&self) -> Value {
        let mode = self.effective_mode();
        let pool_tokens = if mode == Mode::Index { self.pool_tokens() } else { 0 };
        let supply = self.supply();
        json!({
            "mode": mode,
            "reserve": U128(self.reserve), "surplus": U128(self.surplus),
            "creator_owed": U128(self.creator_owed), "protocol_owed": U128(self.protocol_owed),
            "pool_bu": U128(self.pool_bu), "pool_tokens": U128(pool_tokens),
            "sold": U128(self.sold), "supply": U128(supply), "circulating": U128(supply - pool_tokens),
            "b_total": U128(self.b_total()),
            "price": U128(self.price_now()), "floor": U128(self.floor_now()),
            "surplus_per_token": U128(if mode == Mode::Index { 0 } else { curve().surplus_per_token(&self.curve_state()) }),
            "launch": {
                "ends_ms": self.cfg.launch_ms + self.cfg.window_ms,
                "queued_accounts": self.queue.len(),
                "queued_bu": U128(self.queued),
                "settled": mode != Mode::Launch,
            },
            "epoch": { "index": self.epoch_index, "start_ms": self.epoch_start_ms, "end_ms": self.epoch_start_ms + self.cfg.epoch_ms },
            "auction_open": self.auction.is_some(),
            "graduated_ms": self.graduated_ms,
        })
    }

    pub fn get_basket(&self) -> Value {
        Value::Array(
            self.basket
                .iter()
                .map(|s| json!({ "token_id": s.token_id, "q": U128(s.q), "held": U128(s.held), "anchored": s.anchored, "weight_bps": s.weight_bps, "joined_epoch": s.joined_epoch }))
                .collect(),
        )
    }

    pub fn quote_buy(&self, bu_in: U128) -> Value {
        let mode = self.effective_mode();
        let fee = fee_of(bu_in.0, self.cfg.fee_bps as u128);
        let net = bu_in.0 - fee;
        let window_open = now_ms() < self.cfg.launch_ms + self.cfg.window_ms;
        let (tokens, unused, graduates) = match mode {
            Mode::Launch => (0, 0, false),
            Mode::Curve => {
                let b = curve().buy(&self.curve_state(), net);
                (b.tokens, b.unused, b.graduates)
            }
            Mode::Index => (pool_buy(self.pool_bu, self.pool_tokens(), net), 0, false),
        };
        let active = self.active_slots();
        let q: Vec<u128> = active.iter().map(|&i| self.basket[i].q).collect();
        json!({
            "bu_in": bu_in, "fee": U128(fee), "net": U128(net), "tokens_out": U128(tokens),
            "unused": U128(unused), "graduates": graduates,
            "queued": mode == Mode::Launch && window_open,
            "token_ids": active.iter().map(|&i| self.basket[i].token_id.clone()).collect::<Vec<_>>(),
            "amounts": amounts_for_bu(bu_in.0, &q).into_iter().map(U128).collect::<Vec<_>>(),
        })
    }

    pub fn quote_sell(&self, amount: U128) -> Value {
        let t = amount.0;
        let fee_bps = self.cfg.fee_bps as u128;
        let (gross, fee, out, path) = match self.effective_mode() {
            Mode::Launch => (0, 0, 0, "curve"),
            Mode::Curve => {
                let s = curve().sell(&self.curve_state(), t);
                let gross = s.curve_out + s.surplus_out;
                let fee = fee_of(gross, fee_bps);
                (gross, fee, gross - fee, "curve")
            }
            Mode::Index => {
                let pg = pool_sell(self.pool_bu, self.pool_tokens(), t);
                let pf = fee_of(pg, fee_bps);
                let r = redeem(t, self.reserve, self.supply(), REDEEM_FEE_BPS);
                if pg - pf > r.out { (pg, pf, pg - pf, "pool") } else { (r.gross, r.fee, r.out, "redeem") }
            }
        };
        let held: Vec<u128> = self.basket.iter().map(|s| s.held).collect();
        let b = self.b_total();
        let amts = if b == 0 { vec![0; held.len()] } else { payout(&held, out, b) };
        json!({
            "amount": amount, "gross_bu": U128(gross), "fee": U128(fee), "out_bu": U128(out), "path": path,
            "token_ids": self.basket.iter().map(|s| s.token_id.clone()).collect::<Vec<_>>(),
            "amounts": amts.into_iter().map(U128).collect::<Vec<_>>(),
        })
    }

    pub fn get_epoch(&self) -> Value {
        let b = self.b_total();
        json!({
            "index": self.epoch_index,
            "start_ms": self.epoch_start_ms,
            "end_ms": self.epoch_start_ms + self.cfg.epoch_ms,
            "challenges": self.challenges.iter().map(|c| json!({ "target": c.target, "replacement": c.replacement, "burned_bu": U128(c.burned_bu), "top_challenger": c.top_challenger })).collect::<Vec<_>>(),
            "defenses": self.defenses.iter().map(|(t, v)| json!({ "target": t, "burned_bu": U128(*v) })).collect::<Vec<_>>(),
            "min_burn": self.basket.iter().filter(|s| !s.anchored && s.held > 0).map(|s| json!({ "target": s.token_id, "min_bu": U128(min_challenge_burn(b, s.weight_bps as u128, MIN_CHALLENGE_BPS)) })).collect::<Vec<_>>(),
        })
    }

    pub fn get_auction(&self) -> Option<Value> {
        self.auction.as_ref().map(|a| {
            let left = self.slot(&a.target).map(|s| s.held).unwrap_or(0);
            json!({
                "id": a.id, "target": a.target, "replacement": a.replacement,
                "target_total": U128(a.target_total), "target_left": U128(left),
                "replacement_received": U128(a.replacement_received),
                "fair_rate": U128(a.fair_rate),
                "rate_now": U128(auction_rate(a.fair_rate, AUCTION_PREMIUM_BPS, a.start_ms, self.cfg.auction_ms, now_ms())),
                "start_ms": a.start_ms, "ramp_end_ms": a.start_ms + self.cfg.auction_ms, "challenger": a.challenger,
            })
        })
    }

    pub fn get_prices(&self) -> Value {
        Value::Array(self.prices.iter().map(|(t, p, ts)| json!({ "token_id": t, "price": U128(*p), "ts_ms": ts })).collect())
    }

    pub fn get_tombstones(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Tombstone> {
        let from = from.unwrap_or(0);
        let end = (from + limit.unwrap_or(50)).min(self.tombstones.len());
        (from..end).map(|i| self.tombstones[i].clone()).collect()
    }

    pub fn get_log(&self) -> Vec<LogEntry> {
        self.log_newest_first()
    }

    pub fn get_launch_queue(&self, from: Option<u32>, limit: Option<u32>) -> Value {
        let from = from.unwrap_or(0);
        let end = (from + limit.unwrap_or(50)).min(self.queue.len());
        Value::Array((from..end).map(|i| { let (a, b) = &self.queue[i]; json!({ "account_id": a, "bu": U128(*b) }) }).collect())
    }

    pub fn get_owed(&self, account_id: AccountId) -> Value {
        Value::Array(self.owed.get(&account_id).cloned().unwrap_or_default().into_iter().map(|(t, a)| json!({ "token_id": t, "amount": U128(a) })).collect())
    }
}

impl Coin {
    /// Launch mode ends by itself once the window is over and nothing is queued.
    pub(crate) fn effective_mode(&self) -> Mode {
        if self.mode == Mode::Launch && now_ms() >= self.cfg.launch_ms + self.cfg.window_ms && self.queue.is_empty() {
            Mode::Curve
        } else {
            self.mode
        }
    }
}
