/** Read-side math for pages and the bot: floor vs cost, burns, auction rate, epoch standings. */

import type { AuctionView, ChallengeTally, CoinMode, CoinState, EpochView } from "./types.ts";
import { BPS, ceilDiv, E18 } from "./units.ts";

export type RecordedBuy = { tokens: string; bu: string };

/**
 * What the floor pays for the tokens you bought, as a % of the BU you paid (fees included).
 * Null when there are no buys.
 */
export function floorPctOfCost(buys: RecordedBuy[], floor_e18: string): number | null {
  const tokens = buys.reduce((s, b) => s + BigInt(b.tokens), 0n);
  const bu = buys.reduce((s, b) => s + BigInt(b.bu), 0n);
  if (bu === 0n) return null;
  // Basis points of a percent, then back to a float.
  const pctX100 = (BigInt(floor_e18) * tokens * 10_000n) / (E18 * bu);
  return Number(pctX100) / 100;
}

/** Share of the way to graduation, 0..1. Index mode is 1. */
export function graduationProgress(state: Pick<CoinState, "mode" | "reserve">, grad_reserve: string): number {
  if (state.mode === "index") return 1;
  const g = BigInt(grad_reserve);
  if (g === 0n) return 0;
  return Math.min(1, Number((BigInt(state.reserve) * 1_000_000n) / g) / 1_000_000);
}

type BurnState = { mode: CoinMode; reserve: string; sold: string; supply: string };
type CurveParams = { x0: string; y0: string };

function curveXY(s: BurnState, c: CurveParams) {
  const x0 = BigInt(c.x0);
  const y0 = BigInt(c.y0);
  return { x: x0 + BigInt(s.reserve), y: y0 - BigInt(s.sold), k: x0 * y0 };
}

/** BU value a burn of `amount` adds to a tally: the curve's payout (curve mode) or the share of reserve (index mode). */
export function burnValueBu(s: BurnState, c: CurveParams, amount: string): string {
  const t = BigInt(amount);
  if (s.mode === "index") {
    const supply = BigInt(s.supply);
    return supply === 0n ? "0" : ((t * BigInt(s.reserve)) / supply).toString();
  }
  const { x, y, k } = curveXY(s, c);
  return (x - ceilDiv(k, y + t)).toString();
}

/** Fewest tokens whose burn is worth at least `value_bu`. Throws if no amount can reach it. */
export function tokensForBurnValue(s: BurnState, c: CurveParams, value_bu: string): string {
  const v = BigInt(value_bu);
  if (v === 0n) return "0";
  if (s.mode === "index") {
    const r = BigInt(s.reserve);
    if (r === 0n) throw new Error("empty reserve");
    return ceilDiv(v * BigInt(s.supply), r).toString();
  }
  const { x, y, k } = curveXY(s, c);
  if (v >= x) throw new Error("more than the curve holds");
  return (ceilDiv(k, x - v) - y).toString();
}

/** Dutch auction rate at `now_ms`: `premium_bps` above fair at start, linear to fair at ramp end, then fair. */
export function auctionRateAt(a: Pick<AuctionView, "fair_rate" | "start_ms" | "ramp_end_ms">, premium_bps: number, now_ms: number): string {
  const fair = BigInt(a.fair_rate);
  const len = a.ramp_end_ms - a.start_ms;
  if (len <= 0 || now_ms >= a.ramp_end_ms) return fair.toString();
  const remaining = BigInt(a.ramp_end_ms - Math.max(now_ms, a.start_ms));
  const extra = ceilDiv(fair * BigInt(premium_bps) * remaining, BPS * BigInt(len));
  return (fair + extra).toString();
}

/** Target units received for `amount_in` replacement units at `rate` (rounded down). */
export function auctionOut(amount_in: string, rate: string): string {
  return ((BigInt(amount_in) * E18) / BigInt(rate)).toString();
}

/** Replacement units needed to receive `target_out` at `rate` (rounded up). */
export function auctionIn(target_out: string, rate: string): string {
  return ceilDiv(BigInt(target_out) * BigInt(rate), E18).toString();
}

export type TargetStanding = {
  target: string;
  /** Challenges against this target, largest tally first. */
  challenges: ChallengeTally[];
  defense: string;
  min_bu: string;
  /** The leading challenge beats the defense (strictly) and the minimum. */
  leaderWins: boolean;
};

export type EpochStandings = { targets: TargetStanding[]; winner: ChallengeTally | null };

/** If the epoch closed now, which pair would win (before the price-freshness check). */
export function epochStandings(e: EpochView): EpochStandings {
  const targets = new Map<string, TargetStanding>();
  const get = (target: string) => {
    let t = targets.get(target);
    if (!t) {
      t = { target, challenges: [], defense: "0", min_bu: "0", leaderWins: false };
      targets.set(target, t);
    }
    return t;
  };
  for (const c of e.challenges) get(c.target).challenges.push(c);
  for (const d of e.defenses) get(d.target).defense = d.burned_bu;
  for (const m of e.min_burn) get(m.target).min_bu = m.min_bu;

  let winner: ChallengeTally | null = null;
  for (const t of targets.values()) {
    t.challenges.sort((a, b) => (BigInt(b.burned_bu) > BigInt(a.burned_bu) ? 1 : BigInt(b.burned_bu) < BigInt(a.burned_bu) ? -1 : 0));
    const lead = t.challenges[0];
    if (!lead) continue;
    const burned = BigInt(lead.burned_bu);
    t.leaderWins = burned > BigInt(t.defense) && burned >= BigInt(t.min_bu);
    if (t.leaderWins && (!winner || burned > BigInt(winner.burned_bu))) winner = lead;
  }
  return { targets: [...targets.values()], winner };
}

/**
 * Dollar value of one BU now (x1e6): the sum over the basket of q_i (raw units per BU)
 * times the asset's price (dollars per raw unit, 1e36). Null if any asset lacks a price.
 */
export function buUsdNowE6(basket: { token_id: string; q: string }[], usdPricesE36: Record<string, string>): number | null {
  let total = 0n;
  for (const b of basket) {
    const p = usdPricesE36[b.token_id];
    if (p === undefined) return null;
    total += BigInt(b.q) * BigInt(p);
  }
  return Number(total / 10n ** 30n);
}
