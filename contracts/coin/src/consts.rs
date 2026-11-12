//! Mirrors constants.json; `tests::constants_match_constants_json` keeps them in sync.

pub const E18: u128 = 1_000_000_000_000_000_000;
pub const X0: u128 = 5_000 * E18;
pub const Y0: u128 = 1_073_000_000 * E18;
pub const GRAD_RESERVE: u128 = 20_000 * E18;

pub const FEE_MIN_BPS: u16 = 25;
pub const FEE_MAX_BPS: u16 = 100;
pub const REDEEM_FEE_BPS: u128 = 50;

pub const BASKET_MIN: usize = 1;
pub const BASKET_MAX: usize = 9;

pub const MIN_CHALLENGE_BPS: u128 = 300;
pub const AUCTION_PREMIUM_BPS: u128 = 2_000;
pub const POOL_SHARE_BPS: u128 = 2_000;
pub const LOG_RING: u32 = 100;

/// Fair-launch deposits stop at 90% of the graduation reserve, so settling never graduates.
pub const QUEUE_CAP_BU: u128 = 18_000 * E18;
/// Smallest fair-launch deposit: each queued buy costs the coin storage, so dust buys are refused.
pub const MIN_QUEUE_BU: u128 = E18;
/// Bounds the work in `close_epoch`.
pub const MAX_CHALLENGES: usize = 32;

pub struct Profile {
    pub window_ms: u64,
    pub epoch_ms: u64,
    pub auction_ms: u64,
    pub staleness_ms: u64,
}

pub const PROD: Profile = Profile { window_ms: 600_000, epoch_ms: 604_800_000, auction_ms: 3_600_000, staleness_ms: 3_600_000 };
pub const DEMO: Profile = Profile { window_ms: 120_000, epoch_ms: 600_000, auction_ms: 120_000, staleness_ms: 600_000 };
