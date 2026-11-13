/**
 * The floor as a share of what a coin is worth, in plain dollars. Pure: these draw the floor bars
 * and the buy sheet's split; they never size a trade.
 */

export type Backing = {
  /** Price x circulating supply. */
  mcapUsd: number;
  /** Floor x circulating supply: the least every holder could sell for, together, before fees. */
  backedUsd: number;
  /** What the market cap holds above the floor. */
  hypeUsd: number;
  /** backedUsd / mcapUsd, 0..1. */
  share: number;
};

export function backing({ priceUsd, floorUsd, circulating }: { priceUsd: number; floorUsd: number; circulating: number }): Backing {
  const ok = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const p = ok(priceUsd);
  const f = Math.min(ok(floorUsd), p);
  const c = ok(circulating);
  const mcapUsd = p * c;
  const backedUsd = f * c;
  return { mcapUsd, backedUsd, hypeUsd: mcapUsd - backedUsd, share: p > 0 ? f / p : 0 };
}

export type Split = { backed: number; above: number; share: number };

/** A buy of `payUsd` whose tokens the floor values at `floorValueUsd`: how much of it is backed. */
export function splitBuy(payUsd: number, floorValueUsd: number): Split {
  const pay = Number.isFinite(payUsd) && payUsd > 0 ? payUsd : 0;
  const backed = Math.min(pay, Number.isFinite(floorValueUsd) && floorValueUsd > 0 ? floorValueUsd : 0);
  return { backed, above: pay - backed, share: pay > 0 ? backed / pay : 0 };
}

/** "BTC", "BTC + SOL", "BTC + SOL + ETH", "BTC + SOL + 3 more", biggest share first. */
export function backedByLabel(rows: { symbol: string; share: number | null }[]): string {
  const sorted = [...rows].sort((a, b) => (b.share ?? 0) - (a.share ?? 0)).map((r) => r.symbol);
  if (sorted.length === 0) return "nothing yet";
  if (sorted.length <= 3) return sorted.join(" + ");
  return `${sorted.slice(0, 2).join(" + ")} + ${sorted.length - 2} more`;
}

/** Style for a bar fill: the element spans the track and is clipped to `pct` from one side (clip-path animates without layout). */
export function fill(pct: number, side: "left" | "right" = "left", round = 0): { clipPath: string } {
  const rest = 100 - Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const r = round ? ` round ${round}px` : "";
  return { clipPath: side === "left" ? `inset(0 ${rest}% 0 0${r})` : `inset(0 0 0 ${rest}%${r})` };
}
