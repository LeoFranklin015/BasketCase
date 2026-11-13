// Pure part of GET /api/status: one coin's live numbers, plus a recomputation of its floor from
// the same get_state, so a reader can see the floor is arithmetic on the state (not a stored claim).
import { toNumber, type CoinMode } from "@backed/client";
import type { CoinSummary } from "../../../lib/data";
import { constants } from "../../../lib/config";
import { buUsdE6, priceToUsd } from "../../../lib/money";

const E18 = 10n ** 18n;
const X0 = BigInt(constants.curve.virtual_bu) * E18;
const Y0 = BigInt(constants.curve.virtual_tokens) * E18;

const STAGE: Record<CoinMode, string> = { launch: "Fair launch", curve: "Growing", index: "Graduated" };

/**
 * The floor as the contract defines it (crates/curve-math `floor`, coin `floor_now`), BU per token x 1e18:
 * before graduation, the curve's lowest price x0/y0 plus the surplus per sold token;
 * after graduation, the vault's reserve divided by the supply.
 */
export function expectedFloor(s: { mode: CoinMode; reserve: string; surplus: string; sold: string; supply: string }): bigint {
  if (s.mode === "index") {
    const supply = BigInt(s.supply);
    return supply === 0n ? 0n : (BigInt(s.reserve) * E18) / supply;
  }
  const sold = BigInt(s.sold);
  const perToken = sold === 0n ? 0n : (BigInt(s.surplus) * E18) / sold;
  return (X0 * E18) / Y0 + perToken;
}

export type CoinStatus = {
  id: string;
  ticker: string;
  stage: string;
  /** BU per token. */
  price: number;
  /** BU per token: the least any sell pays per token before the fee. */
  floor: number;
  price_usd: number;
  floor_usd: number;
  /** "live" when every basket asset had a price from the swapper, else the coin's launch BU price. */
  usd_source: "live" | "launch";
  /** Everything the coin's vault holds, in basket units (get_state b_total). */
  vault_bu: number;
  /** Tokens in existence, whole tokens. */
  supply: number;
  /** floor / price, in percent. */
  backed_pct: number;
  /** True when get_state.floor equals the floor recomputed from get_state's own fields. */
  floor_matches_formula: boolean;
  /** Keys on the coin's account (view_access_key_list); 0 means nobody can sign as the coin. Null if unread. */
  access_keys: number | null;
  basket: string[];
};

export function coinStatus(s: CoinSummary, usdPrices: Record<string, string>, accessKeys: number | null, symbol: (tokenId: string) => string): CoinStatus {
  const st = s.state;
  const bu = buUsdE6(s.config, s.basket, usdPrices);
  const price = toNumber(st.price, 18);
  const floor = toNumber(st.floor, 18);
  return {
    id: s.info.account_id,
    ticker: s.config.ticker,
    stage: STAGE[st.mode],
    price,
    floor,
    price_usd: priceToUsd(st.price, bu.e6),
    floor_usd: priceToUsd(st.floor, bu.e6),
    usd_source: bu.live ? "live" : "launch",
    vault_bu: toNumber(st.b_total, 18),
    supply: toNumber(st.supply, 18),
    backed_pct: price > 0 ? Math.round((floor / price) * 1000) / 10 : 0,
    floor_matches_formula: expectedFloor(st) === BigInt(st.floor),
    access_keys: accessKeys,
    basket: s.basket.map((b) => symbol(b.token_id)),
  };
}
