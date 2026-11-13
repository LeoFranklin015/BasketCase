/**
 * Server-side price history for one coin.
 *
 * NEARBlocks API v3 indexes which receipts reached the coin (`/accounts/{coin}/receipts`), but its
 * list items carry no logs (checked Nov 12, 2026: `outcome` holds only `status`). So the list is the
 * index, and each relevant transaction's logs come from NEAR RPC (`tx`, then the archival node),
 * cached for good because a final transaction never changes. The free NEARBlocks tier allows a few
 * calls a minute, so list calls go through a small token bucket; when it is empty or NEARBlocks
 * fails, the coin's ring log (`get_log`, last 100 mints and burns) fills in.
 */

import { NET } from "../network";
import { DATA_MODE, deployment } from "../config";
import { getReader } from "../data";
import { RPC_URLS } from "../rpc";
import { FIXTURE_COINS } from "../fixture/world";
import {
  mergeSources,
  parseEventLog,
  rebuildFloor,
  sortNewestFirst,
  tradesFromEvents,
  tradesFromLog,
  type ChainEvent,
  type HistorySource,
  type Trade,
} from "../history";

const NEARBLOCKS = process.env.NEARBLOCKS_API_URL || NET.nearblocksApi;
const NEARBLOCKS_KEY = process.env.NEARBLOCKS_API_KEY || "";
// Recent transactions from any endpoint; the archival node for ones the others have dropped.
const RPCS = [...RPC_URLS, process.env.NEAR_ARCHIVAL_RPC || "https://archival-rpc.testnet.fastnear.com"];

/** Methods whose receipts emit trade events: buys and auction fills arrive as mt_on_transfer. */
const TRADE_METHODS = new Set(["mt_on_transfer", "sell", "redeem", "challenge", "defend", "settle_launch"]);
// The free NEARBlocks tier allows a few calls a minute for the whole server; between list
// refreshes the coin's own log fills in new mints and burns.
const LIST_TTL_MS = 60_000;
const MAX_TX_PER_SYNC = 150;
const MAX_PAGES_PER_SYNC = 4;

export type CoinHistory = {
  coin: string;
  source: HistorySource;
  complete: boolean;
  trades: Trade[];
  note: string;
  updated_ms: number;
};

// ---------- NEARBlocks, rate-limited ----------

const bucket = { tokens: 5, cap: 5, refillMs: 12_000, at: Date.now() };

function takeToken(): boolean {
  const now = Date.now();
  const add = Math.floor((now - bucket.at) / bucket.refillMs);
  if (add > 0) {
    bucket.tokens = Math.min(bucket.cap, bucket.tokens + add);
    bucket.at += add * bucket.refillMs;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

class RateLimited extends Error {}

type NbReceipt = {
  receipt_id: string;
  transaction_hash: string;
  block: { block_timestamp: string };
  actions?: { method?: string }[];
  outcome?: { status?: boolean };
};

async function listReceipts(coin: string, next?: string): Promise<{ data: NbReceipt[]; next: string | null }> {
  if (!takeToken()) throw new RateLimited("NEARBlocks rate limit (local budget)");
  const url = `${NEARBLOCKS}/accounts/${encodeURIComponent(coin)}/receipts?limit=100${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  const res = await fetch(url, {
    headers: NEARBLOCKS_KEY ? { Authorization: `Bearer ${NEARBLOCKS_KEY}` } : {},
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (res.status === 429) {
    bucket.tokens = 0;
    throw new RateLimited("NEARBlocks rate limit");
  }
  if (!res.ok) throw new Error(`NEARBlocks HTTP ${res.status}`);
  const body = (await res.json()) as { data?: NbReceipt[]; meta?: { next_page?: string | null } };
  if (!Array.isArray(body.data)) throw new Error("NEARBlocks: unexpected response");
  return { data: body.data, next: body.meta?.next_page ?? null };
}

// ---------- Transaction logs over RPC, cached forever ----------

type TxOutcome = { id: string; outcome: { executor_id: string; logs: string[] } };
/** tx hash -> receipt outcomes on any account (filtered per coin when read). */
const txCache = new Map<string, TxOutcome[]>();

async function txOutcomes(hash: string, sender: string): Promise<TxOutcome[]> {
  const hit = txCache.get(hash);
  if (hit) return hit;
  let lastErr: unknown;
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "history", method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" } }),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      const body = (await res.json()) as { result?: { receipts_outcome?: TxOutcome[]; final_execution_status?: string }; error?: { message?: string } };
      const outs = body.result?.receipts_outcome;
      const status = body.result?.final_execution_status;
      if (outs && (status === "FINAL" || status === "EXECUTED" || status === "EXECUTED_OPTIMISTIC")) {
        const slim = outs.map((o) => ({ id: o.id, outcome: { executor_id: o.outcome.executor_id, logs: o.outcome.logs } }));
        // Only a final transaction can never change; a just-executed one is used now and read again later.
        if (status === "FINAL") {
          if (txCache.size > 20_000) txCache.delete(txCache.keys().next().value!);
          txCache.set(hash, slim);
        }
        return slim;
      }
      lastErr = new Error(body.error?.message ?? "transaction not final");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try {
          out[k] = { status: "fulfilled", value: await fn(items[k]!) };
        } catch (e) {
          out[k] = { status: "rejected", reason: e };
        }
      }
    }),
  );
  return out;
}

// ---------- Per-coin sync ----------

type Receipt = { id: string; tx: string; ts: number; method: string; ok: boolean };
type Sync = {
  receipts: Map<string, Receipt>;
  olderCursor: string | null;
  /** Every receipt since the account was created has been listed. */
  complete: boolean;
  listedAt: number;
  running: Promise<void> | null;
  error: string | null;
};

const syncs = new Map<string, Sync>();

function addReceipts(s: Sync, rows: NbReceipt[]): boolean {
  let hitKnown = false;
  for (const r of rows) {
    if (s.receipts.has(r.receipt_id)) {
      hitKnown = true;
      continue;
    }
    s.receipts.set(r.receipt_id, {
      id: r.receipt_id,
      tx: r.transaction_hash,
      ts: Math.floor(Number(r.block.block_timestamp) / 1e6),
      method: r.actions?.[0]?.method ?? "",
      ok: r.outcome?.status !== false,
    });
  }
  return hitKnown;
}

async function runSync(coin: string, s: Sync): Promise<void> {
  const first = s.receipts.size === 0;
  let pages = 0;
  // Newest pages until we reach receipts we already have.
  let cursor: string | undefined;
  while (pages < MAX_PAGES_PER_SYNC) {
    const page = await listReceipts(coin, cursor);
    pages++;
    const hitKnown = addReceipts(s, page.data);
    if (first) {
      s.olderCursor = page.next;
      s.complete = !page.next;
      break;
    }
    if (hitKnown || !page.next) break;
    cursor = page.next;
    if (pages >= MAX_PAGES_PER_SYNC) {
      // More new receipts than the budget reaches: a gap would open between them and the ones we
      // had. Keep only the newest pages and backfill from here, so "covered" stays truthful.
      const fresh = [...s.receipts.values()].filter((r) => r.ts >= Math.min(...page.data.map((x) => Math.floor(Number(x.block.block_timestamp) / 1e6))));
      s.receipts = new Map(fresh.map((r) => [r.id, r]));
      s.olderCursor = page.next;
      s.complete = false;
    }
  }
  // Then backfill older pages with what is left of the budget.
  while (!s.complete && s.olderCursor && pages < MAX_PAGES_PER_SYNC) {
    const page = await listReceipts(coin, s.olderCursor);
    pages++;
    addReceipts(s, page.data);
    s.olderCursor = page.next;
    s.complete = !page.next;
  }
  s.listedAt = Date.now();
  s.error = null;
}

function syncFor(coin: string): Sync {
  let s = syncs.get(coin);
  if (!s) {
    s = { receipts: new Map(), olderCursor: null, complete: false, listedAt: 0, running: null, error: null };
    syncs.set(coin, s);
  }
  return s;
}

/** Refresh the receipt index if it is stale; wait at most `waitMs` for it. */
async function refreshIndex(coin: string, waitMs: number): Promise<Sync> {
  const s = syncFor(coin);
  if (!s.running && Date.now() - s.listedAt > LIST_TTL_MS) {
    s.running = runSync(coin, s)
      .catch((e: unknown) => {
        s.error = e instanceof Error ? e.message : String(e);
        // Try again on the next request rather than after the full TTL.
        s.listedAt = Date.now() - LIST_TTL_MS + 5_000;
      })
      .finally(() => {
        s.running = null;
      });
  }
  if (s.running) await Promise.race([s.running, new Promise((r) => setTimeout(r, waitMs))]);
  return s;
}

/** Trade events from every indexed receipt, and the time range they are complete for. */
async function chainTrades(coin: string, waitMs: number): Promise<{ trades: Trade[]; covered: { from: number; to: number } | null; listed: number; error: string | null }> {
  const s = await refreshIndex(coin, waitMs);
  if (s.receipts.size === 0) return { trades: [], covered: null, listed: 0, error: s.error };

  const all = [...s.receipts.values()];
  const tsOf = new Map(all.map((r) => [r.id, r.ts]));
  const txTs = new Map<string, number>();
  for (const r of all) if (r.ok && TRADE_METHODS.has(r.method)) txTs.set(r.tx, Math.min(txTs.get(r.tx) ?? Infinity, r.ts));
  const hashes = [...txTs.keys()].sort((a, b) => txTs.get(b)! - txTs.get(a)!);
  // Read every cached transaction, plus up to the budget of uncached ones (newest first), so a
  // long history fills in over successive requests.
  const uncached = hashes.filter((h) => !txCache.has(h));
  const fetchNow = new Set(uncached.slice(0, MAX_TX_PER_SYNC));
  const wanted = hashes.filter((h) => txCache.has(h) || fetchNow.has(h));
  const results = await pool(wanted, 6, (h) => txOutcomes(h, coin));

  const events: ChainEvent[] = [];
  let newestMissing = -Infinity;
  results.forEach((r, i) => {
    const hash = wanted[i]!;
    if (r.status === "rejected") {
      newestMissing = Math.max(newestMissing, txTs.get(hash)!);
      return;
    }
    r.value.forEach((o, oi) => {
      if (o.outcome.executor_id !== coin) return;
      const ts = tsOf.get(o.id) ?? txTs.get(hash)!;
      o.outcome.logs.forEach((line, li) => {
        for (const e of parseEventLog(line)) events.push({ ...e, ts, seq: oi * 1000 + li, tx: hash });
      });
    });
  });
  // Transactions not read yet are left to the ring log.
  for (const h of uncached.slice(MAX_TX_PER_SYNC)) newestMissing = Math.max(newestMissing, txTs.get(h)!);

  const times = all.map((r) => r.ts);
  let from = s.complete ? 0 : Math.min(...times);
  const to = Math.max(...times);
  let trades = tradesFromEvents(events);
  if (newestMissing > -Infinity) {
    // A gap: trust events only after the newest one we couldn't read.
    from = Math.max(from, newestMissing + 1);
    trades = trades.filter((t) => t.ts >= from);
  }
  return { trades, covered: from <= to ? { from, to } : null, listed: s.receipts.size, error: s.error };
}

// ---------- Public ----------

const responseCache = new Map<string, { at: number; value: CoinHistory }>();
const RESPONSE_TTL_MS = 8_000;

export async function loadCoinHistory(coin: string): Promise<CoinHistory> {
  const hit = responseCache.get(coin);
  if (hit && Date.now() - hit.at < RESPONSE_TTL_MS) return hit.value;
  const value = DATA_MODE === "fixture" ? fixtureHistory(coin) : await rpcHistory(coin);
  responseCache.set(coin, { at: Date.now(), value });
  return value;
}

async function rpcHistory(coin: string): Promise<CoinHistory> {
  const c = getReader().coin(coin);
  const [state, config, log, chain] = await Promise.all([
    c.getState(),
    c.getConfig(),
    // A failed log read must not pass for "no trades": keep the error and decide below.
    c.getLog().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    chainTrades(coin, 3_500).catch((e: unknown) => ({ trades: [] as Trade[], covered: null, listed: 0, error: e instanceof Error ? e.message : String(e) })),
  ]);
  const fromChain = chain.covered !== null;
  if (log instanceof Error && !fromChain) throw log;
  const logOk = !(log instanceof Error);
  const merged = mergeSources(chain.trades, chain.covered, tradesFromLog(logOk ? log : []));
  const trades = rebuildFloor(merged, state, config);
  const complete = fromChain ? chain.covered!.from === 0 : logOk && log.length < 100 && state.mode !== "index";
  let note: string;
  if (fromChain && complete) note = "Every trade since launch: NEARBlocks lists the coin's receipts and NEAR RPC returns each transaction's events.";
  else if (fromChain) note = "Recent trades from NEARBlocks and NEAR RPC, with older ones from the contract's log of its last 100 mints and burns. More history loads over the next minutes.";
  else
    note = `From the contract's log of its last 100 mints and burns${state.mode === "index" ? "; pool trades after graduation aren't in it" : ""}. NEARBlocks ${chain.error ? `was unavailable (${chain.error})` : "is still loading"}.`;
  return { coin, source: fromChain ? "chain" : "log", complete, trades: trades.slice(0, 3_000), note, updated_ms: Date.now() };
}

function fixtureHistory(coin: string): CoinHistory {
  const c = FIXTURE_COINS.find((x) => x.info.account_id === coin);
  if (!c) throw new Error(`${coin}: fixture has no such coin`);
  const state = c.sim.stateView({ launch: c.launch, epoch: { index: c.epoch.index, start_ms: c.epoch.start_ms, end_ms: c.epoch.end_ms }, auction_open: c.auction !== null });
  const trades = rebuildFloor(sortNewestFirst(tradesFromEvents(c.sim.history.map((h) => h.ev))), state, c.config);
  return { coin, source: "fixture", complete: true, trades, note: "Fixture data: simulated trades shaped like the coin's events.", updated_ms: Date.now() };
}

/** Coin ids this server will look up: only coins under our factory (no open proxy to NEARBlocks). */
export function isOurCoin(id: string): boolean {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/.test(id)) return false;
  if (DATA_MODE === "fixture") return FIXTURE_COINS.some((c) => c.info.account_id === id);
  return id.endsWith(`.${deployment.factory}`);
}
