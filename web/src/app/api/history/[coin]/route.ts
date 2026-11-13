// Price history for one coin: trades (newest first, with the floor rebuilt after each) and OHLCV
// candles for `?tf=` (1m, 5m, 15m, 1h, 4h, 1D; default: the smallest that fits the history).
// Sources and their limits are in src/lib/server/history.ts.
import { NextResponse } from "next/server";
import { isTimeframe, pickTimeframe, tfSeconds, toCandles, type HistoryResponse } from "@/lib/history";
import { isOurCoin, loadCoinHistory } from "@/lib/server/history";

export const dynamic = "force-dynamic";

// The last history that loaded, per coin. When NEARBlocks and the RPCs are rate limiting (this server
// shares them with the keeper), a stale chart is far better than an empty page.
const lastGood = new Map<string, { h: Awaited<ReturnType<typeof loadCoinHistory>>; at: number }>();

export async function GET(req: Request, ctx: { params: Promise<{ coin: string }> }) {
  const coin = decodeURIComponent((await ctx.params).coin);
  if (!isOurCoin(coin)) return NextResponse.json({ error: `${coin} is not a coin from this launchpad` }, { status: 404 });
  const tfParam = new URL(req.url).searchParams.get("tf");
  try {
    let h: Awaited<ReturnType<typeof loadCoinHistory>>;
    try {
      h = await loadCoinHistory(coin);
      lastGood.set(coin, { h, at: Date.now() });
    } catch (e) {
      const prev = lastGood.get(coin);
      if (!prev) throw e;
      const min = Math.max(1, Math.round((Date.now() - prev.at) / 60_000));
      h = { ...prev.h, note: `${prev.h.note} Showing what loaded ${min} min ago: NEAR couldn't be read just now.` };
    }
    const tf = isTimeframe(tfParam) ? tfParam : pickTimeframe(h.trades);
    const body: HistoryResponse = { ...h, tf, candles: toCandles(h.trades, tfSeconds(tf)) };
    return NextResponse.json(body, { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=50" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
