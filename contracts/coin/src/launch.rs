//! Fair launch: deposits in the first window are pooled and minted at one average price.

use crate::events::emit;
use crate::*;
use near_sdk::serde_json::json;

#[near]
impl Coin {
    /// After the window, mint the window's tokens to up to `limit` depositors. Anyone can call
    /// it repeatedly; trading opens when the queue is empty. Returns how many remain.
    pub fn settle_launch(&mut self, limit: u32) -> u32 {
        require!(self.mode == Mode::Launch, "launch already settled");
        require!(now_ms() >= self.cfg.launch_ms + self.cfg.window_ms, "the fair-launch window is still open");
        let len = self.queue.len();
        if len == 0 {
            self.mode = Mode::Curve;
            return 0;
        }
        if self.settle_tokens == 0 {
            // One curve buy for the whole window. The window cap keeps it below graduation.
            let b = curve().buy(&CurveState::default(), self.queued);
            self.reserve += b.curve_cost;
            self.surplus += b.surplus_part;
            self.sold += b.tokens;
            self.settle_tokens = b.tokens;
            self.settle_bu = self.queued;
            self.queued = 0;
        }
        let end = (self.settle_next + limit.max(1)).min(len);
        for i in self.settle_next..end {
            let (account_id, bu) = self.queue[i].clone();
            let share = if i == len - 1 {
                self.settle_tokens - self.settle_minted
            } else {
                curve_math::mul_div(self.settle_tokens, bu, self.settle_bu)
            };
            self.settle_minted += share;
            self.mint_tokens(&account_id, share);
            self.log_entry("mint", &account_id, share, bu, "fair_launch");
        }
        self.settle_next = end;
        if end == len {
            self.queue.clear();
            self.settle_next = 0;
            self.mode = Mode::Curve;
            emit("settle", json!({ "tokens": U128(self.settle_tokens), "bu": U128(self.settle_bu), "accounts": len }));
        }
        len - end
    }
}

impl Coin {
    /// Leave Launch mode once the window is over and nothing is queued.
    pub(crate) fn advance_mode(&mut self) {
        if self.mode == Mode::Launch && now_ms() >= self.cfg.launch_ms + self.cfg.window_ms && self.queue.is_empty() {
            self.mode = Mode::Curve;
        }
    }
}
