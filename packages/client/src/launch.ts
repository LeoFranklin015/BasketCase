/** Launch helpers: price conversion, q per asset, and the factory's config checks. */

import { BPS, ceilDiv, parseUnits } from "./units.ts";
import type { LaunchConfig } from "./types.ts";

export const LAUNCH_LIMITS = {
  tickerPattern: /^[A-Z0-9]{2,10}$/,
  minAssets: 1,
  maxAssets: 9,
  feeMinBps: 25,
  feeMaxBps: 100,
} as const;

/** Dollars per whole token ("180") -> dollars per raw unit scaled by 1e36 (the swapper/reporter scale). */
export function usdToPriceE36(usd: string, decimals: number): bigint {
  const usdE36 = parseUnits(usd, 36);
  return usdE36 / 10n ** BigInt(decimals);
}

/**
 * `q_i = weight_i / 10000 * bu_usd / usd_price_i * 10^decimals_i`, rounded up.
 * `price_e36` is dollars per raw unit scaled by 1e36 (mock-swapper `get_prices`).
 */
export function computeQ(a: { weight_bps: number; bu_usd_e6: number; price_e36: bigint | string }): string {
  const price = BigInt(a.price_e36);
  if (price <= 0n) throw new Error("no price for this asset");
  const num = BigInt(a.weight_bps) * BigInt(a.bu_usd_e6) * 10n ** 36n;
  const den = BPS * 1_000_000n * price;
  return ceilDiv(num, den).toString();
}

/** The checks `create_coin` makes, as readable messages. Empty means valid. */
export function validateLaunch(c: LaunchConfig): string[] {
  const errors: string[] = [];
  if (!LAUNCH_LIMITS.tickerPattern.test(c.ticker)) errors.push("Ticker must be 2 to 10 characters, A-Z and 0-9.");
  if (!c.name.trim()) errors.push("Name is required.");
  if (c.basket.length < LAUNCH_LIMITS.minAssets || c.basket.length > LAUNCH_LIMITS.maxAssets) {
    errors.push("The basket needs 1 to 9 assets.");
  }
  const seen = new Set<string>();
  for (const b of c.basket) {
    if (seen.has(b.token_id)) errors.push(`${b.token_id} is in the basket twice.`);
    seen.add(b.token_id);
    if (!/^\d+$/.test(b.q) || BigInt(b.q) === 0n) errors.push(`${b.token_id}: q must be more than 0.`);
    if (!Number.isInteger(b.weight_bps) || b.weight_bps <= 0) errors.push(`${b.token_id}: weight must be more than 0.`);
  }
  const total = c.basket.reduce((s, b) => s + b.weight_bps, 0);
  if (c.basket.length > 0 && total !== 10_000) errors.push(`Weights must sum to 10,000 bps (100%); they sum to ${total}.`);
  if (!Number.isInteger(c.fee_bps) || c.fee_bps < LAUNCH_LIMITS.feeMinBps || c.fee_bps > LAUNCH_LIMITS.feeMaxBps) {
    errors.push("Fee must be 25 to 100 bps (0.25% to 1%).");
  }
  if (c.epoch_profile !== "demo" && c.epoch_profile !== "prod") errors.push("Epoch profile must be demo or prod.");
  if (!Number.isInteger(c.bu_usd_e6) || c.bu_usd_e6 <= 0) errors.push("BU dollar size must be more than 0.");
  return errors;
}
