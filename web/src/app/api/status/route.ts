// GET /api/status: every coin's live state in one read-only JSON, so anyone can check the
// numbers the app shows with one curl. View calls only; cached 30 s per server.
import { NextResponse } from "next/server";
import { DATA_MODE, NETWORK, tokenInfo } from "@/lib/config";
import { factoryId, getReader, loadSummary, verifierId } from "@/lib/data";
import { rpcPost } from "@/lib/rpc";
import { coinStatus, type CoinStatus } from "./status";

export const dynamic = "force-dynamic";

const TTL_MS = 30_000;
type Body = { network: string; data: "rpc" | "fixture"; factory: string; verifier: string; coins: CoinStatus[]; units: Record<string, string>; checked_at: string };
let cached: { at: number; body: Body } | null = null;

async function accessKeys(account: string): Promise<number | null> {
  if (DATA_MODE === "fixture") return null;
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: "status", method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: account } });
    const got = await rpcPost(body);
    const keys = (JSON.parse(got.text) as { result?: { keys?: unknown[] } }).result?.keys;
    return Array.isArray(keys) ? keys.length : null;
  } catch {
    return null;
  }
}

async function load(): Promise<Body> {
  const r = getReader();
  const [infos, prices] = await Promise.all([r.listAllCoins(), r.swapper.getPrices().catch(() => [] as [string, string][])]);
  const usd = Object.fromEntries(prices);
  const coins = await Promise.all(
    infos.map(async (info) => {
      const [s, keys] = await Promise.all([loadSummary(r, info), accessKeys(info.account_id)]);
      return coinStatus(s, usd, keys, (id) => tokenInfo(id).symbol);
    }),
  );
  return {
    network: NETWORK,
    data: DATA_MODE,
    factory: factoryId(),
    verifier: verifierId(),
    coins,
    units: { price: "BU per token", floor: "BU per token", vault_bu: "basket units", supply: "whole tokens", backed_pct: "floor / price x 100" },
    checked_at: new Date().toISOString(),
  };
}

export async function GET() {
  const headers = { "cache-control": "public, s-maxage=30, stale-while-revalidate=30" };
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.body, { headers });
  try {
    const body = await load();
    cached = { at: Date.now(), body };
    return NextResponse.json(body, { headers });
  } catch (e) {
    // A stale answer, labelled by its checked_at, beats an error when the free RPCs rate-limit.
    if (cached) return NextResponse.json(cached.body, { headers });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
