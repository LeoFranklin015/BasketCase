// POST /api/solana {method, params}: a read-only proxy to Solana mainnet for the two calls the Phantom buy
// needs (a recent blockhash, and whether the deposit address already has a USDC account).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPCS = (process.env.SOLANA_RPCS ?? "https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com").split(",");
const ALLOWED = new Set(["getLatestBlockhash", "getAccountInfo"]);

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { method?: string; params?: unknown[] } | null;
  if (!b?.method || !ALLOWED.has(b.method)) return Response.json({ error: "method not allowed" }, { status: 400 });
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: b.method, params: b.params ?? [] }) });
      if (r.ok) return new Response(await r.text(), { headers: { "content-type": "application/json" } });
    } catch {
      // next endpoint
    }
  }
  return Response.json({ error: "Solana RPC unreachable" }, { status: 502 });
}
