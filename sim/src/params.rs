//! Parameters read from the repo's `constants.json`, the file the contracts and web app share.

use curve_math::{Curve, CurveState, E18};
use serde_json::Value;

const CONSTANTS: &str = include_str!("../../constants.json");

#[derive(Clone, Copy, Debug)]
pub struct Params {
    pub curve: Curve,
    pub fee_bps: u128,
    /// Creator, vault, protocol shares of the trade fee (bps).
    pub split_bps: [u128; 3],
    pub redeem_fee_bps: u128,
    pub pool_share_bps: u128,
    pub challenge_min_bps: u128,
    /// Production epoch length, in hours.
    pub epoch_hours: u64,
    /// USD per BU at launch, 1e18-scaled (`launch.bu_usd_default`). Only the USD columns use it.
    pub bu_usd_e18: u128,
}

fn whole_e18(v: &Value) -> u128 {
    let s = v.as_str().expect("constants: expected a decimal string");
    s.parse::<u128>().expect("constants: whole number") * E18
}

/// A non-negative decimal such as "0.01" as an exact 1e18-scaled integer (no float on the way).
fn decimal_e18(text: &str) -> u128 {
    let (whole, frac) = text.split_once('.').unwrap_or((text, ""));
    assert!(frac.len() <= 18, "constants: more than 18 decimals in {text}");
    let frac_e18 = format!("{frac:0<18}").parse::<u128>().expect("constants: decimal");
    whole.parse::<u128>().expect("constants: decimal") * E18 + frac_e18
}

fn int(v: &Value) -> u128 {
    v.as_u64().expect("constants: expected an integer") as u128
}

impl Params {
    pub fn from_constants() -> Params {
        let c: Value = serde_json::from_str(CONSTANTS).expect("constants.json parses");
        Params {
            curve: Curve {
                x0: whole_e18(&c["curve"]["virtual_bu"]),
                y0: whole_e18(&c["curve"]["virtual_tokens"]),
                grad_reserve: whole_e18(&c["curve"]["graduation_reserve_bu"]),
            },
            fee_bps: int(&c["fees"]["trade_fee_bps"]["default"]),
            split_bps: ["creator", "vault", "protocol"].map(|k| int(&c["fees"]["split_bps"][k])),
            redeem_fee_bps: int(&c["fees"]["redeem_fee_bps"]),
            pool_share_bps: int(&c["graduation"]["pool_share_bps"]),
            challenge_min_bps: int(&c["challenge"]["min_burn_bps_of_slot"]),
            epoch_hours: (int(&c["epochs"]["len_s"]["prod"]) / 3600) as u64,
            bu_usd_e18: decimal_e18(&c["launch"]["bu_usd_default"].to_string()),
        }
    }

    /// Tokens sold when the curve reaches graduation (858.4M with the spec's numbers).
    pub fn tokens_at_graduation(&self) -> u128 {
        self.curve.buy(&CurveState::default(), self.curve.grad_reserve).tokens
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use curve_math::{split_fee, FeeSplit};

    #[test]
    fn the_fee_split_in_constants_json_is_the_one_curve_math_applies() {
        let p = Params::from_constants();
        // split_fee hard-codes its split; if constants.json changes, the sim must not drift silently.
        let [creator, vault, protocol] = p.split_bps;
        assert_eq!(split_fee(10_000), FeeSplit { creator, vault, protocol });
    }

    #[test]
    fn decimal_amounts_parse_exactly_to_1e18_units() {
        assert_eq!(decimal_e18("0.01"), 10_000_000_000_000_000);
        assert_eq!(decimal_e18("1"), E18);
        assert_eq!(decimal_e18("2.5"), 2_500_000_000_000_000_000);
    }
}
