// GET /api/xbuy/<id>: move an order forward and report where it is (the page polls this). When it waits for the
// wallet, the reply carries the exact messages to sign and the limits the browser checks before signing.
// POST /api/xbuy/<id> {txHash}: tell 1Click about the deposit transaction so it is picked up sooner.
// POST /api/xbuy/<id> {signed: [...]}: the wallet's signatures, in order.
import { ONECLICK, advance, getOrder, heldInIntents, publicOrder, submitSignatures } from "@/lib/server/xbuy";
import type { SignedIntent } from "@backed/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const o = await advance(id);
  if (!o) return Response.json({ error: "no such order" }, { status: 404 });
  const held = o.status === "done" ? await heldInIntents(o.coin, o.intentsId).catch(() => null) : null;
  return Response.json({ ...publicOrder(o), held });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const o = getOrder(id);
  if (!o) return Response.json({ error: "no such order" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { txHash?: string; signed?: SignedIntent[] } | null;
  if (b?.signed) {
    try {
      return Response.json(publicOrder(await submitSignatures(id, b.signed)));
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  if (b?.txHash && /^[0-9a-zA-Z]{20,100}$/.test(b.txHash) && o.depositAddress) {
    await fetch(`${ONECLICK}/v0/deposit/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: b.txHash, depositAddress: o.depositAddress }),
    }).catch(() => undefined);
  }
  return Response.json({ ok: true });
}
