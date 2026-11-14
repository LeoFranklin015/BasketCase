// POST /api/fund {accountId}: testnet only. Send 0.5 testnet NEAR from the relayer to a new Privy (implicit) account.
// Server-only: the relayer key comes from RELAYER_PRIVATE_KEY and never reaches the browser.

import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { AccountDoesNotExistError } from "near-api-js/rpc-errors";
import { NET, deployment } from "@/lib/config";
import { createFundHandler, createRateLimiter } from "@/lib/server/fund";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
// The free RPCs drop requests now and then: read the balance from the first one that answers.
const RPCS = [...new Set([deployment.rpc, ...NET.rpcs])];
const providers = RPCS.map((url) => new JsonRpcProvider({ url }));
const provider = providers[0]!;
const TRANSPORT = /429|rate limit|fetch failed|Failed to fetch|network|timed? ?out|ECONNRESET|ETIMEDOUT|50[234]|Service Unavailable|Bad Gateway|Exceeded/i;

let handler: ReturnType<typeof createFundHandler> | null = null;

function getHandler() {
  const relayerId = process.env.RELAYER_ACCOUNT_ID;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY as KeyPairString | undefined;
  if (!relayerId || !relayerKey) return null;
  if (!handler) {
    const relayer = new Account(relayerId, provider, relayerKey);
    handler = createFundHandler({
      getBalance: async (accountId) => {
        let last: unknown;
        for (let round = 0; round < 2; round++) {
          for (const p of providers) {
            try {
              return (await p.viewAccount({ accountId })).amount;
            } catch (e) {
              // An implicit account does not exist until its first transfer.
              if (e instanceof AccountDoesNotExistError) return 0n;
              last = e;
              if (!TRANSPORT.test(e instanceof Error ? e.message : String(e))) throw e;
            }
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        throw last;
      },
      transfer: async (accountId, amount) => {
        const res = await relayer.transfer({ receiverId: accountId, amount });
        return res.transaction_outcome.id;
      },
      // One funding per account every 6 hours; at most 60 per hour in total (30 testnet NEAR).
      limiter: createRateLimiter({ perAccountMs: 6 * HOUR, globalMax: 60, globalWindowMs: HOUR }),
      now: () => Date.now(),
    });
  }
  return handler;
}

// Implicit accounts cost nothing to make, so the per-account limit alone can't stop a script: also
// limit each visitor's IP to a few new wallets every 6 hours. The app is only reachable through our
// proxy (which overwrites X-Forwarded-For) or the Cloudflare tunnel (which sets CF-Connecting-IP).
const IP_MAX = 4;
const ipHits = new Map<string, number[]>();
function ipAllowed(ip: string, now: number): boolean {
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < 6 * HOUR);
  if (recent.length >= IP_MAX) return false;
  recent.push(now);
  ipHits.set(ip, recent);
  if (ipHits.size > 10_000) ipHits.clear();
  return true;
}
/** Addresses exempt from the per-IP limit (comma list), e.g. this server's own address for the live tests. */
const IP_ALLOW = new Set((process.env.FUND_IP_ALLOW ?? "").split(",").map((s) => s.trim()).filter(Boolean));
function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function POST(req: Request) {
  // Free gas is a testnet convenience; on mainnet the relayer would be giving away real NEAR.
  if (!NET.testTokens) return Response.json({ error: `No gas top-ups on ${NET.chain}.` }, { status: 404 });
  const h = getHandler();
  if (!h) return Response.json({ error: "Funding is not configured on this server." }, { status: 503 });
  const body = await req.json().catch(() => null);
  const ip = clientIp(req);
  if (!IP_ALLOW.has(ip) && !ipAllowed(ip, Date.now())) {
    return Response.json({ error: "This network already made a few guest wallets in the last 6 hours. Reuse one, or connect a NEAR testnet wallet." }, { status: 429 });
  }
  try {
    const r = await h(body);
    return Response.json(r.body, { status: r.status });
  } catch (e) {
    return Response.json({ error: `Could not check the balance: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
