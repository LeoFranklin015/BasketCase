// Cross-chain preview: live 1Click dry-run quotes showing how a buyer on another chain would fill
// a coin's basket on mainnet NEAR Intents. Nothing moves; testnet trades use test tokens.

export const ONECLICK_URL = "https://1click.chaindefuser.com";

/** Testnet stand-in token -> the mainnet NEAR Intents asset it represents (null: no 1Click route today). */
const MAINNET_ASSET: Record<string, string | null> = {
  "nep141:usdc.mock": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  // Omni-bridged BTC: quotes today, and a stronger trust model than the PoA btc.omft.near.
  "nep141:btc.mock": "nep141:nbtc.bridge.near",
  "nep141:eth.mock": "nep141:eth.omft.near",
  "nep141:sol.mock": "nep141:sol.omft.near",
  "nep141:pepe.mock": "nep141:eth-0x6982508145454ce325ddbe47a25d4ec3d2311933.omft.near",
  "nep141:doge.mock": "nep141:doge.omft.near",
  "nep141:wif.mock": "nep141:sol-b9c68f94ec8fd160137af8cdfe5e61cd68e2afba.omft.near",
  "nep141:bonk.mock": null,
  "nep141:nvda.mock": null,
};

export function mainnetAssetFor(testnetTokenId: string): string | null {
  return MAINNET_ASSET[testnetTokenId] ?? null;
}

export type Origin = {
  id: string;
  label: string;
  assetId: string;
  decimals: number;
  /** A syntactically valid refund address on that chain, used only for dry quotes. */
  sampleRefundTo: string;
};

export const ORIGINS: Origin[] = [
  { id: "sol", label: "SOL on Solana", assetId: "nep141:sol.omft.near", decimals: 9, sampleRefundTo: "So11111111111111111111111111111111111111112" },
  { id: "base-usdc", label: "USDC on Base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, sampleRefundTo: "0x0000000000000000000000000000000000000001" },
  { id: "eth", label: "ETH on Ethereum", assetId: "nep141:eth.omft.near", decimals: 18, sampleRefundTo: "0x0000000000000000000000000000000000000001" },
  { id: "arb-usdc", label: "USDC on Arbitrum", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, sampleRefundTo: "0x0000000000000000000000000000000000000001" },
];

export type Leg = { token_id: string; destination: string | null; amount: string };

/** Split `usd` of the origin asset across basket assets by value share. */
export function planLegs(usd: number, originUsdPrice: number, originDecimals: number, basket: { token_id: string; share: number }[]): Leg[] {
  return basket.map((b) => {
    const units = (usd * b.share) / originUsdPrice;
    const raw = BigInt(Math.floor(units * 1e9)) * 10n ** BigInt(originDecimals) / 1_000_000_000n;
    return { token_id: b.token_id, destination: mainnetAssetFor(b.token_id), amount: raw.toString() };
  });
}

export function quoteRequest(origin: Origin, destinationAsset: string, amount: string, now = new Date()) {
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset,
    amount,
    refundTo: origin.sampleRefundTo,
    refundType: "ORIGIN_CHAIN",
    // Dry quotes need a valid NEAR account; the real buyer's account replaces it on mainnet.
    recipient: "intents.near",
    recipientType: "INTENTS",
    deadline: new Date(now.getTime() + 10 * 60_000).toISOString(),
  };
}

export type QuoteSummary =
  | { status: "ok"; amountOut: string; usdOut: number; seconds: number }
  | { status: "no_liquidity" | "error"; message: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function summarizeQuote(res: any): QuoteSummary {
  const q = res?.quote;
  if (q?.amountOutFormatted) {
    return { status: "ok", amountOut: q.amountOutFormatted, usdOut: Number(q.amountOutUsd), seconds: Number(q.timeEstimate) };
  }
  const message = String(res?.message ?? "no quote");
  return { status: /liquidity/i.test(message) ? "no_liquidity" : "error", message };
}

/** One row of 1Click's public GET /v0/tokens. */
export type OneClickToken = { assetId: string; decimals: number; price: number | string };

/**
 * 1Click USD prices -> the contracts' price unit: USD per raw unit, scaled by 1e36, as
 * `[token_id, price_e36]` rows (the shape the testnet swapper's get_prices returns).
 * On mainnet this feeds the reporter and the app's dollar figures. Tokens 1Click doesn't list are left out.
 */
export function oneClickPricesE36(list: OneClickToken[], tokenIds: string[]): [string, string][] {
  const byId = new Map(list.map((t) => [t.assetId, t]));
  const out: [string, string][] = [];
  for (const id of tokenIds) {
    const t = byId.get(id);
    if (!t) continue;
    const usd = typeof t.price === "number" ? t.price.toFixed(18) : t.price;
    if (!/^\d+(\.\d+)?$/.test(usd) || Number(usd) <= 0) continue;
    const [whole, frac = ""] = usd.split(".");
    const usdE18 = BigInt(whole + frac.padEnd(18, "0").slice(0, 18));
    out.push([id, ((usdE18 * 10n ** 18n) / 10n ** BigInt(t.decimals)).toString()]);
  }
  return out;
}

const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const quotedPrice = new Map<string, { e36: string; at: number }>();

/**
 * USD per raw unit × 1e36 for a token 1Click routes but leaves out of /v0/tokens (e.g. Ondo's NVDAon), read from a
 * dry quote of $10 of USDC into it. Cached 10 minutes; null when there is no route.
 */
export async function quotedPriceE36(tokenId: string): Promise<string | null> {
  const hit = quotedPrice.get(tokenId);
  if (hit && Date.now() - hit.at < 600_000) return hit.e36;
  try {
    const res = await fetch(`${ONECLICK_URL}/v0/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType: "EXACT_INPUT",
        slippageTolerance: 200,
        originAsset: NEAR_USDC,
        depositType: "INTENTS",
        destinationAsset: tokenId,
        amount: "10000000",
        refundTo: "intents.near",
        refundType: "INTENTS",
        recipient: "intents.near",
        recipientType: "INTENTS",
        deadline: new Date(Date.now() + 600_000).toISOString(),
      }),
    });
    const body = (await res.json()) as { quote?: { amountOut: string } };
    const out = BigInt(body.quote?.amountOut ?? "0");
    if (out <= 0n) return null;
    // $10 bought `out` raw units: USD per raw unit = 10 / out; × 1e36.
    const e36 = ((10n * 10n ** 36n) / out).toString();
    quotedPrice.set(tokenId, { e36, at: Date.now() });
    return e36;
  } catch {
    return null;
  }
}

export async function fetchOneClickPrices(tokenIds: string[]): Promise<[string, string][]> {
  const res = await fetch(`${ONECLICK_URL}/v0/tokens`);
  if (!res.ok) throw new Error(`1Click /v0/tokens: ${res.status}`);
  const rows = oneClickPricesE36((await res.json()) as OneClickToken[], tokenIds);
  const missing = tokenIds.filter((id) => !rows.some(([t]) => t === id));
  for (const id of missing) {
    const e36 = await quotedPriceE36(id);
    if (e36) rows.push([id, e36]);
  }
  return rows;
}
