/**
 * A bigint port of crates/curve-math, used only to generate self-consistent fixture data.
 * The contract is the source of truth; this never runs in rpc mode.
 */

export const E18 = 10n ** 18n;
const BPS = 10_000n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export type CurveParams = { x0: bigint; y0: bigint; grad: bigint };
export type CurveSt = { reserve: bigint; surplus: bigint; sold: bigint };

export const SPEC_CURVE: CurveParams = { x0: 5_000n * E18, y0: 1_073_000_000n * E18, grad: 20_000n * E18 };

export function curveBuy(c: CurveParams, st: CurveSt, net: bigint) {
  const x = c.x0 + st.reserve;
  const y = c.y0 - st.sold;
  const k = c.x0 * c.y0;
  const curveCost = (t: bigint) => ceilDiv(k, y - t) - x;
  const surplusCost = (t: bigint) => (st.sold === 0n ? 0n : ceilDiv(st.surplus * t, st.sold));
  const cost = (t: bigint) => curveCost(t) + surplusCost(t);
  const yGrad = ceilDiv(k, c.x0 + c.grad);
  const tMax = y - yGrad;
  const maxCost = cost(tMax);
  if (maxCost <= net) {
    const cc = curveCost(tMax);
    return { tokens: tMax, curveCost: cc, surplusPart: maxCost - cc, unused: net - maxCost, graduates: true };
  }
  let lo = 0n;
  let hi = tMax;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (cost(mid) <= net) lo = mid;
    else hi = mid;
  }
  const cc = curveCost(lo);
  return { tokens: lo, curveCost: cc, surplusPart: net - cc, unused: 0n, graduates: false };
}

export function curveSell(c: CurveParams, st: CurveSt, tokens: bigint) {
  const x = c.x0 + st.reserve;
  const y = c.y0 - st.sold;
  const xAfter = ceilDiv(c.x0 * c.y0, y + tokens);
  const surplusOut = st.sold === 0n ? 0n : (st.surplus * tokens) / st.sold;
  return { curveOut: x - xAfter, surplusOut };
}

export function surplusPerToken(st: CurveSt) {
  return st.sold === 0n ? 0n : (st.surplus * E18) / st.sold;
}

export function curvePrice(c: CurveParams, st: CurveSt) {
  return ((c.x0 + st.reserve) * E18) / (c.y0 - st.sold) + surplusPerToken(st);
}

export function curveFloor(c: CurveParams, st: CurveSt) {
  return (c.x0 * E18) / c.y0 + surplusPerToken(st);
}

export function feeOf(amount: bigint, feeBps: number) {
  return ceilDiv(amount * BigInt(feeBps), BPS);
}

export function splitFee(fee: bigint) {
  const vault = ceilDiv(fee * 3_000n, BPS);
  const creator = (fee * 5_000n) / BPS;
  return { vault, creator, protocol: fee - vault - creator };
}

export function poolBuy(xp: bigint, yp: bigint, net: bigint) {
  return yp - ceilDiv(xp * yp, xp + net);
}

export function poolSell(xp: bigint, yp: bigint, tokens: bigint) {
  return xp - ceilDiv(xp * yp, yp + tokens);
}
