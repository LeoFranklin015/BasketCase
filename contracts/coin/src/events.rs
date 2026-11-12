//! NEP-297 events (standard "backed") and the ring log of recent mints and burns.

use crate::*;
use near_sdk::serde_json::{json, Value};

pub(crate) fn emit(event: &str, data: Value) {
    let body = json!({ "standard": "backed", "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{body}"));
}

impl Coin {
    /// Keep the last LOG_RING mints and burns; storage stops growing after that.
    pub(crate) fn log_entry(&mut self, kind: &str, account_id: &AccountId, tokens: u128, bu: u128, reason: &str) {
        let entry = LogEntry {
            ts_ms: now_ms(),
            kind: kind.to_string(),
            account_id: account_id.clone(),
            tokens: U128(tokens),
            bu: U128(bu),
            reason: reason.to_string(),
            price_after: U128(self.price_now()),
        };
        if self.log.len() < LOG_RING {
            self.log.push(entry);
        } else {
            self.log.set(self.log_next, entry);
        }
        self.log_next = (self.log_next + 1) % LOG_RING;
    }

    /// Newest first.
    pub(crate) fn log_newest_first(&self) -> Vec<LogEntry> {
        let n = self.log.len();
        (0..n).map(|i| self.log[(self.log_next + n - 1 - i) % n].clone()).collect()
    }
}
