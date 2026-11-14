// POST /api/rpc: a same-origin, cached proxy for NEAR view calls, so every visitor shares one
// cache and one failover list (src/lib/rpc.ts) instead of each browser hitting the free RPCs.
// Only `call_function` views on this app's own contracts pass; nothing can be signed or sent.
import { NextResponse } from "next/server";
import { DATA_MODE, DIRECT_COINS, deployment } from "@/lib/config";
import { rpcPost } from "@/lib/rpc";

export const dynamic = "force-dynamic";

// The factory, its coins, and coins deployed directly (the mainnet demo coin has no factory).
const OURS = new Set([deployment.factory, deployment.verifier, deployment.swapper, ...DIRECT_COINS.map((c) => c.account_id)]);
const allowed = (id: unknown) => typeof id === "string" && (OURS.has(id) || id.endsWith(`.${deployment.factory}`));

export async function POST(req: Request) {
  if (DATA_MODE === "fixture") return NextResponse.json({ error: "fixture mode has no RPC" }, { status: 404 });
  const text = await req.text();
  if (text.length > 8_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: { method?: string; params?: { request_type?: string; account_id?: unknown; method_name?: unknown } };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const p = body.params;
  if (body.method !== "query" || p?.request_type !== "call_function" || !allowed(p.account_id) || typeof p.method_name !== "string") {
    return NextResponse.json({ error: "only view calls on this app's contracts" }, { status: 403 });
  }
  try {
    const got = await rpcPost(text);
    return new NextResponse(got.text, { status: got.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
