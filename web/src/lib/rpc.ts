/**
 * NEAR RPC access with failover. The free testnet endpoints rate-limit (HTTP 429) under load, so
 * every read goes through `failoverFetch`: it tries the last endpoint that worked, steps to the
 * next on 429, 5xx or a network error (cooling the bad one down briefly), and dedupes identical
 * view calls made within a couple of seconds, so a snapshot read by several components costs one
 * request. Signing paths use near-api-js's FailoverRpcProvider over the same list.
 */

import { deployment } from "./config";
import { NET } from "./network";

/** Endpoints for the active network, the deployment's first. Override with NEXT_PUBLIC_NEAR_RPCS (testnet) or NEXT_PUBLIC_NEAR_RPCS_MAINNET, comma-separated. */
export const RPC_URLS: string[] = [
  ...new Set(
    [deployment.rpc, ...((NET.id === "mainnet" ? process.env.NEXT_PUBLIC_NEAR_RPCS_MAINNET : process.env.NEXT_PUBLIC_NEAR_RPCS)?.split(",") ?? NET.rpcs)]
      .map((u) => u.trim())
      .filter(Boolean),
  ),
];

const COOLDOWN_429_MS = 15_000;
const COOLDOWN_ERR_MS = 5_000;
const IS_SERVER = typeof window === "undefined";
/** The server cache is shared by every visitor through /api/rpc, so it can hold a little longer. */
const CACHE_MS = IS_SERVER ? 3_000 : 2_000;
/** Same-origin proxy for view calls (see app/api/rpc/route.ts). */
export const RPC_PROXY_PATH = "/api/rpc";
const TIMEOUT_MS = 10_000;

let preferred = 0;
const coolUntil = new Map<string, number>();
type Got = { status: number; text: string };
const inflight = new Map<string, Promise<Got>>();
const cache = new Map<string, { at: number; got: Got }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Endpoints in the order to try: the preferred one first, cooled-down ones last. */
function order(): string[] {
  const now = Date.now();
  const rotated = RPC_URLS.map((_, i) => RPC_URLS[(preferred + i) % RPC_URLS.length]!);
  return [...rotated.filter((u) => (coolUntil.get(u) ?? 0) <= now), ...rotated.filter((u) => (coolUntil.get(u) ?? 0) > now)];
}

/** In the browser, view calls go through our server first: one shared cache for every visitor. */
async function viaProxy(body: string): Promise<Got | null> {
  try {
    const res = await fetch(RPC_PROXY_PATH, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status !== 200) return null;
    return { status: 200, text: await res.text() };
  } catch {
    return null;
  }
}

async function post(body: string, view = false): Promise<Got> {
  if (view && !IS_SERVER && process.env.NEXT_PUBLIC_RPC_PROXY !== "off") {
    const got = await viaProxy(body);
    if (got) return got;
  }
  let last: Got | null = null;
  let lastErr: unknown = null;
  const urls = order();
  for (let attempt = 0; attempt < urls.length * 2; attempt++) {
    const url = urls[attempt % urls.length]!;
    if (attempt >= urls.length) await sleep(300 * (attempt - urls.length + 1));
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        coolUntil.set(url, Date.now() + (res.status === 429 ? COOLDOWN_429_MS : COOLDOWN_ERR_MS));
        last = { status: res.status, text };
        continue;
      }
      preferred = RPC_URLS.indexOf(url);
      return { status: res.status, text };
    } catch (e) {
      coolUntil.set(url, Date.now() + COOLDOWN_ERR_MS);
      lastErr = e;
    }
  }
  if (last) return last;
  throw lastErr instanceof Error ? lastErr : new Error("all NEAR RPC endpoints failed");
}

/** Dedupe key for a read-only call: the JSON-RPC body without its id. Null for anything else. */
export function viewKey(body: string): string | null {
  try {
    const j = JSON.parse(body) as { method?: string; params?: { request_type?: string } };
    if (j.method === "query" && j.params?.request_type === "call_function") return JSON.stringify(j.params);
  } catch {
    // not JSON: don't dedupe
  }
  return null;
}

/** Send a JSON-RPC body through the failover list (no proxy), with the view cache when it is a view. */
export async function rpcPost(body: string): Promise<{ status: number; text: string }> {
  const r = await failoverFetch(RPC_URLS[0]!, { method: "POST", body });
  return { status: r.status, text: await r.text() };
}

/** A `fetch` for NEAR JSON-RPC that fails over across RPC_URLS. Other URLs pass straight through. */
export const failoverFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init?.body === "string" ? init.body : null;
  if (!RPC_URLS.includes(url) || init?.method !== "POST" || body === null) return fetch(input, init);
  const key = viewKey(body);
  let got: Got;
  if (key === null) got = await post(body);
  else {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) got = hit.got;
    else {
      let p = inflight.get(key);
      if (!p) {
        p = post(body, true).finally(() => inflight.delete(key));
        inflight.set(key, p);
      }
      got = await p;
      if (got.status === 200) {
        if (cache.size > 500) cache.clear();
        cache.set(key, { at: Date.now(), got });
      }
    }
  }
  return new Response(got.text, { status: got.status, headers: { "content-type": "application/json" } });
};

/** Errors that mean "this endpoint didn't answer", as opposed to an answer (e.g. not enough balance). */
export const TRANSPORT_ERROR = /429|rate limit|Failed to fetch|fetch failed|network|timed? ?out|ECONNRESET|ETIMEDOUT|50[234]|Service Unavailable|Bad Gateway/i;

/**
 * The RPC calls a signer needs (see near-signer.ts SenderRpc), failing over across RPC_URLS only when
 * an endpoint doesn't answer. Any real answer, such as NotEnoughBalance or InvalidNonce, is thrown
 * as is: near-api-js's FailoverRpcProvider would try every endpoint and then hide it behind
 * "Exceeded N providers".
 */
export async function rpcProvider() {
  const { JsonRpcProvider } = await import("near-api-js");
  const providers = RPC_URLS.map((url) => new JsonRpcProvider({ url }));
  const over = async <T,>(f: (p: InstanceType<typeof JsonRpcProvider>) => Promise<T>): Promise<T> => {
    let last: unknown;
    for (const p of providers) {
      try {
        return await f(p);
      } catch (e) {
        last = e;
        if (!TRANSPORT_ERROR.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
    throw last;
  };
  return {
    viewAccessKey: (q: Parameters<InstanceType<typeof JsonRpcProvider>["viewAccessKey"]>[0]) => over((p) => p.viewAccessKey(q)),
    viewBlock: (q: Parameters<InstanceType<typeof JsonRpcProvider>["viewBlock"]>[0]) => over((p) => p.viewBlock(q)),
    sendTransactionUntil: (...a: Parameters<InstanceType<typeof JsonRpcProvider>["sendTransactionUntil"]>) => over((p) => p.sendTransactionUntil(...a)),
  };
}
