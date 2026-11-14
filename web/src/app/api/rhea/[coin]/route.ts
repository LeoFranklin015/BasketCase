// GET /api/rhea/<coin>: the coin's Rhea pool, if it has one. The keeper opens pools when coins graduate
// (scripts/src/rhea.ts) and records them in a file this route reads live, so no rebuild is needed.
import { readFile } from "node:fs/promises";
import { NET, RHEA_POOLS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = process.env.RHEA_POOLS_FILE ?? `${process.env.HOME ?? "/tmp"}/backed-ops/rhea-pools-${NET.testTokens ? "testnet" : "mainnet"}.json`;

export async function GET(_req: Request, ctx: { params: Promise<{ coin: string }> }) {
  const { coin } = await ctx.params;
  let live: Record<string, number> = {};
  try {
    live = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    // no pools recorded yet
  }
  const pool = live[coin] ?? RHEA_POOLS[coin];
  if (pool === undefined) return Response.json({ pool: null }, { headers: { "cache-control": "public, max-age=30" } });
  const url = `${NET.testTokens ? "https://testnet.rhea.finance" : "https://app.rhea.finance"}/pool/${pool}`;
  return Response.json({ pool, url }, { headers: { "cache-control": "public, max-age=30" } });
}
