// POST /api/xbuy {coin, chain: "base"|"solana", user, usd}: start a cross-chain buy (mainnet only).
//   Returns the 1Click deposit address the buyer's wallet sends USDC to. See src/lib/server/xbuy.ts.
// POST /api/xbuy {action: "sell", coin, chain, user, amount|"all"}: sell coins the wallet holds in NEAR Intents.
// POST /api/xbuy {action: "cashout", coin, chain, user}: swap what the sell returned to USDC on the wallet's chain.
// GET /api/xbuy?coin&chain&user: the wallet's balance of the coin in NEAR Intents.
import { NET } from "@/lib/config";
import { USDC_ON, heldInIntents, intentsIdFor, publicOrder, start, startCashout, startSell, type XChain } from "@/lib/server/xbuy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hits = new Map<string, number[]>();
function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60 * 60_000);
  if (recent.length >= 20) return false;
  hits.set(ip, [...recent, now]);
  return true;
}

export async function POST(req: Request) {
  if (NET.testTokens) return Response.json({ error: "Cross-chain buys run on mainnet only." }, { status: 404 });
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowed(ip)) return Response.json({ error: "Too many buys from this network; try again later." }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { action?: "buy" | "sell" | "cashout"; coin?: string; chain?: XChain; user?: string; usd?: number; amount?: string } | null;
  if (b?.action === "sell" || b?.action === "cashout") {
    if (!b.coin || !b.chain || !b.user) return Response.json({ error: "coin, chain and user are required" }, { status: 400 });
    try {
      const o = b.action === "sell" ? await startSell({ coin: b.coin, chain: b.chain, user: b.user, amount: b.amount ?? "all" }) : await startCashout({ coin: b.coin, chain: b.chain, user: b.user });
      return Response.json(publicOrder(o));
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  if (!b?.coin || !b.chain || !b.user || typeof b.usd !== "number") return Response.json({ error: "coin, chain, user and usd are required" }, { status: 400 });
  try {
    const o = await start({ coin: b.coin, chain: b.chain, user: b.user, usd: b.usd });
    const usdc = USDC_ON[o.chain];
    return Response.json({ id: o.id, depositAddress: o.depositAddress, amount: o.amountIn, token: usdc.contract, decimals: usdc.decimals, chain: o.chain });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function GET(req: Request) {
  if (NET.testTokens) return Response.json({ error: "mainnet only" }, { status: 404 });
  const u = new URL(req.url);
  const coin = u.searchParams.get("coin");
  const chain = u.searchParams.get("chain") as XChain | null;
  const user = u.searchParams.get("user");
  if (!coin || !chain || !user) return Response.json({ error: "coin, chain and user are required" }, { status: 400 });
  try {
    const intentsId = intentsIdFor(chain, user);
    return Response.json({ intentsId, held: await heldInIntents(coin, intentsId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
