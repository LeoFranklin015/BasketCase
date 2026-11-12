/**
 * The bonding curve as floats, for drawing and previews only (the contract and quote_buy are the
 * truth for anything that moves money). Curve: x * y = k with x = x0 + reserve, y = y0 - sold;
 * the price of the next token is x / y + s, and the floor is x0 / y0 + s.
 */

export type CurveF = { x0: number; y0: number; grad: number };

export const k = (c: CurveF) => c.x0 * c.y0;

/** Curve price (without s) after `sold` tokens. */
export function curvePriceAt(c: CurveF, sold: number): number {
  const y = c.y0 - sold;
  return y > 0 ? k(c) / (y * y) : Infinity;
}

/** Tokens sold when the reserve reaches graduation: 858.4M for the spec curve. */
export function soldAtGraduation(c: CurveF): number {
  return c.y0 - k(c) / (c.x0 + c.grad);
}

/** Reserve (BU) the curve holds after `sold` tokens. */
export function reserveAt(c: CurveF, sold: number): number {
  return k(c) / (c.y0 - sold) - c.x0;
}

/**
 * Tokens a buy of `net` BU (after the fee) gets at `sold` with surplus per token `s`:
 * the largest t with curve_cost(t) + s * t <= net, capped at graduation.
 */
export function tokensForNet(c: CurveF, sold: number, s: number, net: number): { tokens: number; capped: boolean } {
  const tMax = Math.max(0, soldAtGraduation(c) - sold);
  const cost = (t: number) => k(c) / (c.y0 - sold - t) - k(c) / (c.y0 - sold) + s * t;
  if (net <= 0) return { tokens: 0, capped: false };
  if (cost(tMax) <= net) return { tokens: tMax, capped: true };
  let lo = 0;
  let hi = tMax;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (cost(mid) <= net) lo = mid;
    else hi = mid;
  }
  return { tokens: lo, capped: false };
}
