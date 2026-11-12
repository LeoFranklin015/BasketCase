// Live cross-chain preview: for a coin's basket, ask NEAR Intents 1Click (mainnet, dry run) how
// $X from another chain would arrive as each basket asset. Nothing is signed or moved.
import { NextResponse } from "next/server";
import { ONECLICK_URL, ORIGINS, planLegs, quoteRequest, summarizeQuote, type QuoteSummary } from "@backed/client";
import { getReader } from "@/lib/data";
import { basketRows } from "@/lib/money";
import { tokenInfo } from "@/lib/config";

type Token = { assetId: string; price: number };
let tokenCache: { at: number; prices: Map<string, number> } | null = null;

async function mainnetPrices(): Promise<Map<string, number>> {
  if (tokenCache && Date.now() - tokenCache.at < 60_000) return tokenCache.prices;
  const res = await fetch(`${ONECLICK_URL}/v0/tokens`, { cache: "no-store" });
  const list = (await res.json()) as Token[];
  tokenCache = { at: Date.now(), prices: new Map(list.map((t) => [t.assetId, t.price])) };
  return tokenCache.prices;
}

export async function GET(req: Request, ctx: { params: Promise<{ coin: string }> }) {
  const { coin } = await ctx.params;
  const url = new URL(req.url);
  const origin = ORIGINS.find((o) => o.id === url.searchParams.get("from")) ?? ORIGINS[0]!;
  const usd = Math.min(Math.max(Number(url.searchParams.get("usd") ?? 20), 5), 1_000);
  try {
    const reader = getReader();
    const [basket, swapper] = await Promise.all([reader.coin(decodeURIComponent(coin)).getBasket(), reader.swapper.getPrices()]);
    const prices = Object.fromEntries(swapper);
    const rows = basketRows(basket.filter((b) => BigInt(b.held) > 0n || BigInt(b.q) > 0n), prices);
    const live = await mainnetPrices();
    const originPrice = live.get(origin.assetId);
    if (!originPrice) return NextResponse.json({ error: "no price for origin" }, { status: 502 });
    const legs = planLegs(usd, originPrice, origin.decimals, rows.map((r) => ({ token_id: r.token_id, share: r.share ?? 0 })));
    const quotes: (QuoteSummary & { token_id: string; symbol: string; share: number })[] = await Promise.all(
      legs.map(async (leg, i) => {
        const base = { token_id: leg.token_id, symbol: tokenInfo(leg.token_id).symbol, share: rows[i]!.share ?? 0 };
        if (!leg.destination) return { ...base, status: "error" as const, message: "not listed on 1Click today" };
        if (leg.destination === origin.assetId) return { ...base, status: "ok" as const, amountOut: "same asset", usdOut: usd * base.share, seconds: 0 };
        const r = await fetch(`${ONECLICK_URL}/v0/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(quoteRequest(origin, leg.destination, leg.amount)),
          cache: "no-store",
        });
        return { ...base, ...summarizeQuote(await r.json()) };
      }),
    );
    return NextResponse.json({ origin: origin.label, usd, quotes, checked_at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
