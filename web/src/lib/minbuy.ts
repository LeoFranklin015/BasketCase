// The smallest buy that works on mainnet. A buy is split across the basket by value, and each swap leg must
// clear 1Click's minimum for that asset. Measured with dry quotes on Nov 14, 2026: USDC → BTC fills from $0.10;
// Ondo's NVDAon needs about $5.50 ($5 → "no liquidity"); the USDC deposit from Base or Solana fills from $0.50.
// Unmeasured assets assume about $1. So the smallest buy is max(leg minimum ÷ leg share), with room for price
// moves, and never below MIN_BUY_USD. Testnet has no minimum (the stand-in swapper fills any size).
import { NET } from "./config";

/** Smallest USD amount 1Click fills into each asset, with ~15% room; assets not listed use DEFAULT_LEG_USD. */
export const MIN_LEG_USD: Record<string, number> = {
  "nep141:bnb-0xa9ee28c80f960b889dfbd1902055218cba016f75.omdep.near": 6.5, // NVDAon
  "nep141:nbtc.bridge.near": 0.25, // BTC: fills from $0.10
};
/** No buy below $1: the Base/Solana deposit fills from $0.50, and this leaves room for its fee. */
export const MIN_BUY_USD = 1;
export const DEFAULT_LEG_USD = 1.15;
const PAY_TOKEN = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"; // USDC: no swap needed

/** Smallest buy in USD for a basket given each asset's share of value (0..1); 0 on testnet. */
export function minBuyUsd(rows: { token_id: string; share: number | null }[], network = NET.testTokens ? "testnet" : "mainnet"): number {
  if (network === "testnet") return 0;
  let min = MIN_BUY_USD;
  for (const r of rows) {
    const share = r.share ?? 0;
    if (share <= 0 || r.token_id === PAY_TOKEN) continue;
    min = Math.max(min, (MIN_LEG_USD[r.token_id] ?? DEFAULT_LEG_USD) / share);
  }
  return Math.ceil(min);
}

/** The plain-words reason shown under a buy that is too small. */
export function minBuyMessage(ticker: string, min: number, rows: { token_id: string; symbol: string; share: number | null }[]): string {
  const limiting = rows.find((r) => (MIN_LEG_USD[r.token_id] ?? 0) / (r.share || 1) >= min - 1);
  return limiting
    ? `Smallest buy for $${ticker} is $${min}: ${limiting.symbol} needs at least $${MIN_LEG_USD[limiting.token_id]!.toFixed(2)} per swap.`
    : `Smallest buy for $${ticker} is $${min}.`;
}
