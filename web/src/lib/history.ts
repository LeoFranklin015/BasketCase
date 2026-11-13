/**
 * Price history for one coin, as pure functions that run on the server and in the browser.
 *
 * Sources: the coin's NEP-297 events ("backed" standard), or its ring log (`get_log`, last 100
 * mints and burns). Events carry `price_after` but no floor, so the floor at each trade is
 * rebuilt by walking back from the coin's current state:
 *   - Curve mode: price = ceil(k / y) / y + s and floor = x0 / y0 + s, with y = y0 - sold.
 *     Every priced event anchors s; burns and fee shares move it in between.
 *   - Index mode: floor = reserve / supply. Redeems and burns change it; pool trades add the
 *     vault's fee share to the reserve.
 * Numbers here are floats (BU and whole tokens). They draw charts; they never size a trade.
 */

import type { CoinConfig, CoinState, LogEntry } from "@backed/client";

export type TradeKind = "buy" | "sell" | "burn" | "redeem" | "settle" | "graduate" | "fill";

export type Trade = {
  /** Block time, ms. */
  ts: number;
  /** Orders trades that share a millisecond; larger is later. */
  seq: number;
  kind: TradeKind;
  /** Where a buy or sell executed. */
  path?: "curve" | "pool";
  /** Why tokens were burned: challenge, defend. */
  reason?: string;
  account: string;
  /** Whole tokens. */
  tokens: number;
  /** BU: paid in (buy), paid out before the fee (sell), value (burn), paid out (redeem). */
  bu: number;
  fee: number | null;
  /** BU per token after this trade. */
  price: number | null;
  /** BU per token after this trade, rebuilt (see the top of this file). */
  floor: number | null;
  tx?: string;
};

export type Candle = {
  /** Bucket start, unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded BU (buys and sells). */
  volume: number;
  buyVolume: number;
  /** Floor at the bucket's close. */
  floor: number | null;
  trades: number;
  burns: number;
};

export type HistorySource = "chain" | "log" | "fixture";

export type HistoryResponse = {
  coin: string;
  source: HistorySource;
  /** True when every trade since launch is included. */
  complete: boolean;
  /** Newest first. */
  trades: Trade[];
  tf: TimeframeId;
  candles: Candle[];
  updated_ms: number;
  /** Plain words on where the data came from and what may be missing. */
  note: string;
};

export const TIMEFRAMES = [
  { id: "1m", sec: 60 },
  { id: "5m", sec: 300 },
  { id: "15m", sec: 900 },
  { id: "1h", sec: 3_600 },
  { id: "4h", sec: 14_400 },
  { id: "1D", sec: 86_400 },
] as const;
export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export function tfSeconds(id: TimeframeId): number {
  return TIMEFRAMES.find((t) => t.id === id)!.sec;
}

export function isTimeframe(v: unknown): v is TimeframeId {
  return TIMEFRAMES.some((t) => t.id === v);
}

const E18 = 1e18;
/** A U128 string (1e18 scale) as a float. */
const f18 = (v: unknown): number => (typeof v === "string" || typeof v === "number" ? Number(v) / E18 : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ---------- Events ----------

export type ChainEvent = { ts: number; seq: number; event: string; data: Record<string, unknown>; tx?: string };

/** Parse one log line; returns the "backed" events in it (an event's data array may hold several). */
export function parseEventLog(line: string): { event: string; data: Record<string, unknown> }[] {
  if (!line.startsWith("EVENT_JSON:")) return [];
  try {
    const body = JSON.parse(line.slice("EVENT_JSON:".length)) as { standard?: string; event?: string; data?: unknown };
    if (body.standard !== "backed" || typeof body.event !== "string") return [];
    const items = Array.isArray(body.data) ? body.data : [body.data];
    return items.filter((d): d is Record<string, unknown> => !!d && typeof d === "object").map((data) => ({ event: body.event!, data }));
  } catch {
    return [];
  }
}

/** Events that move price, supply or the floor, as trades. Newest first. */
export function tradesFromEvents(events: ChainEvent[]): Trade[] {
  const out: Trade[] = [];
  for (const e of events) {
    const d = e.data;
    const base = { ts: e.ts, seq: e.seq, tx: e.tx, account: str(d.account_id), floor: null };
    switch (e.event) {
      case "buy":
        out.push({ ...base, kind: "buy", path: d.path === "pool" ? "pool" : "curve", tokens: f18(d.tokens_out), bu: f18(d.bu_in), fee: f18(d.fee), price: f18(d.price_after) });
        break;
      case "sell":
        out.push({ ...base, kind: "sell", path: d.path === "pool" ? "pool" : "curve", tokens: f18(d.tokens), bu: f18(d.bu_out) + f18(d.fee), fee: f18(d.fee), price: f18(d.price_after) });
        break;
      case "burn":
        out.push({ ...base, kind: "burn", reason: str(d.reason), tokens: f18(d.tokens), bu: f18(d.bu), fee: null, price: null });
        break;
      case "redeem":
        out.push({ ...base, kind: "redeem", tokens: f18(d.tokens), bu: f18(d.bu_out), fee: f18(d.fee), price: null });
        break;
      case "settle":
        out.push({ ...base, account: "fair launch", kind: "settle", tokens: f18(d.tokens), bu: f18(d.bu), fee: null, price: null });
        break;
      case "auction_fill":
        // An asset swap inside the vault: no tokens move and the price is unchanged.
        out.push({ ...base, kind: "fill", tokens: 0, bu: 0, fee: null, price: null });
        break;
      case "graduated": {
        const tokens = f18(d.pool_tokens);
        const bu = f18(d.pool_bu);
        out.push({ ...base, account: "pool", kind: "graduate", tokens, bu, fee: null, price: tokens > 0 ? bu / tokens : null });
        break;
      }
    }
  }
  return sortNewestFirst(out);
}

/** The ring log as trades. Newest first. */
export function tradesFromLog(log: LogEntry[]): Trade[] {
  const n = log.length;
  return sortNewestFirst(
    log.map((e, i) => {
      const r = e.reason;
      const kind: TradeKind =
        e.kind === "mint" ? (r === "settle" ? "settle" : r.startsWith("graduation") ? "graduate" : "buy") : r === "sell" ? "sell" : r === "redeem" ? "redeem" : "burn";
      return {
        ts: e.ts_ms,
        // The log is newest first; keep its order inside one millisecond.
        seq: n - i,
        kind,
        path: kind === "buy" || kind === "sell" ? "curve" : undefined,
        reason: kind === "burn" ? r : undefined,
        account: e.account_id,
        tokens: f18(e.tokens),
        bu: f18(e.bu),
        fee: null,
        price: f18(e.price_after),
        floor: null,
      } satisfies Trade;
    }),
  );
}

export function sortNewestFirst(t: Trade[]): Trade[] {
  return [...t].sort((a, b) => b.ts - a.ts || b.seq - a.seq);
}

/**
 * Join event-derived trades (complete for `covered`, a closed ms range) with log trades outside
 * that range. Log trades inside it are already in the events.
 */
export function mergeSources(chain: Trade[], covered: { from: number; to: number } | null, log: Trade[]): Trade[] {
  if (!covered) return sortNewestFirst(log);
  const outside = log.filter((t) => t.ts < covered.from || t.ts > covered.to);
  return sortNewestFirst([...chain, ...outside]);
}

// ---------- Floor ----------

export type WalkStart = Pick<CoinState, "mode" | "sold" | "supply" | "reserve" | "surplus_per_token">;

/** Vault share of a fee: 30% (the contract rounds up; a float chart doesn't need to). */
const vaultShare = (fee: number | null) => (fee ? fee * 0.3 : 0);

/**
 * Fill `price` (where an event has none) and `floor` on every trade by walking back from the
 * current state. `trades` must be newest first and must include every trade after the oldest
 * one given; missing older history is fine.
 */
export function rebuildFloor(trades: Trade[], now: WalkStart, curve: Pick<CoinConfig, "x0" | "y0">): Trade[] {
  const x0 = f18(curve.x0);
  const y0 = f18(curve.y0);
  const k = x0 * y0;
  const p0 = x0 / y0;
  const curvePrice = (sold: number) => {
    const y = y0 - sold;
    return y > 0 ? k / (y * y) : NaN;
  };

  let mode: "curve" | "index" = now.mode === "index" ? "index" : "curve";
  let sold = f18(now.sold);
  let supply = f18(now.supply);
  let reserve = f18(now.reserve);
  let s: number | null = mode === "curve" ? f18(now.surplus_per_token) : null;

  const out = trades.map((t) => ({ ...t }));
  for (const t of out) {
    if (mode === "index") {
      t.floor = supply > 0 ? reserve / supply : null;
      switch (t.kind) {
        case "graduate":
          if (t.price === null && t.tokens > 0) t.price = t.bu / t.tokens;
          // Before this, the coin was on the curve; the pool's tokens were minted here.
          sold = Math.max(0, supply - t.tokens);
          mode = "curve";
          s = null;
          break;
        case "buy":
        case "sell":
          reserve -= vaultShare(t.fee);
          break;
        case "redeem":
          reserve += t.bu;
          supply += t.tokens;
          break;
        case "burn":
          supply += t.tokens;
          break;
      }
      continue;
    }

    // Curve mode. Anchor s on every event that reports its price.
    if (t.price !== null && Number.isFinite(curvePrice(sold))) s = Math.max(0, t.price - curvePrice(sold));
    if (s !== null) {
      if (t.price === null) t.price = curvePrice(sold) + s;
      t.floor = Math.min(p0 + s, t.price ?? Infinity);
    }
    const c = sold;
    switch (t.kind) {
      case "buy":
        if (s !== null && c > 0) s -= vaultShare(t.fee) / c;
        sold -= t.tokens;
        break;
      case "sell":
        if (s !== null && c > 0) s -= vaultShare(t.fee) / c;
        sold += t.tokens;
        break;
      case "burn":
        // A burn adds its value less the surplus it carried: s_before = s_after - value / C_after.
        if (s !== null && c > 0) s -= t.bu / c;
        sold += t.tokens;
        break;
      case "settle":
        sold -= t.tokens;
        s = 0;
        break;
    }
    sold = Math.max(0, sold);
    if (s !== null) s = Math.max(0, s);
  }

  // Index-mode redeems and burns leave the pool alone: their price is the last one before them.
  let last: number | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    const t = out[i]!;
    if (t.price === null || !Number.isFinite(t.price)) t.price = last;
    else last = t.price;
  }
  return out;
}

// ---------- Candles ----------

const VOLUME_KINDS = new Set<TradeKind>(["buy", "sell"]);

/** OHLCV buckets, oldest first. Each candle opens at the previous close; empty buckets are skipped. */
export function toCandles(newestFirst: Trade[], tfSec: number): Candle[] {
  const candles: Candle[] = [];
  let prevClose: number | null = null;
  let prevFloor: number | null = null;
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const t = newestFirst[i]!;
    if (t.price === null || !Number.isFinite(t.price) || t.price <= 0) continue;
    const time = Math.floor(t.ts / 1000 / tfSec) * tfSec;
    let c = candles.at(-1);
    if (!c || c.time !== time) {
      const open: number = prevClose ?? t.price;
      c = { time, open, high: open, low: open, close: open, volume: 0, buyVolume: 0, floor: prevFloor, trades: 0, burns: 0 };
      candles.push(c);
    }
    c.high = Math.max(c.high, t.price);
    c.low = Math.min(c.low, t.price);
    c.close = t.price;
    if (t.floor !== null) c.floor = t.floor;
    if (VOLUME_KINDS.has(t.kind)) {
      c.volume += t.bu;
      if (t.kind === "buy") c.buyVolume += t.bu;
      c.trades += 1;
    }
    if (t.kind === "burn" || t.kind === "redeem") c.burns += 1;
    prevClose = c.close;
    prevFloor = c.floor;
  }
  return candles;
}

/** The smallest timeframe that shows the whole history in at most `maxBars` candles. */
export function pickTimeframe(newestFirst: Trade[], maxBars = 120): TimeframeId {
  if (newestFirst.length < 2) return "5m";
  const spanSec = (newestFirst[0]!.ts - newestFirst.at(-1)!.ts) / 1000;
  return (TIMEFRAMES.find((t) => spanSec / t.sec <= maxBars) ?? TIMEFRAMES.at(-1)!).id;
}

export type Change = { pct: number; sinceLaunch: boolean; fromMs?: number };

/**
 * Price change over the last `windowMs`, against the last trade before the window, or the first trade for a
 * coin younger than the window. With a partial history (`complete` false) the oldest loaded trade isn't the
 * launch, so the change is measured from it and `fromMs` says when that was.
 */
export function changeOver(newestFirst: Trade[], nowMs: number, currentPrice: number, windowMs = 86_400_000, complete = true): Change | null {
  const priced = newestFirst.filter((t) => t.price !== null && t.price > 0);
  if (priced.length === 0 || !(currentPrice > 0)) return null;
  const before = priced.find((t) => t.ts <= nowMs - windowMs);
  const base = before ?? priced.at(-1)!;
  const pct = (currentPrice / base.price! - 1) * 100;
  if (before) return { pct, sinceLaunch: false };
  return complete ? { pct, sinceLaunch: true } : { pct, sinceLaunch: false, fromMs: base.ts };
}

/** Plain words for what a change is measured over: "since launch", "in 24h", or "in 14h" for a shorter span. */
export function changeLabel(c: Change | null, nowMs: number): string {
  if (c?.sinceLaunch) return "since launch";
  if (c?.fromMs === undefined) return "in 24h";
  const min = Math.max(1, Math.round((nowMs - c.fromMs) / 60_000));
  return min < 60 ? `in ${min}m` : `in ${Math.round(min / 60)}h`;
}

/** Closing prices for a small chart: one point per bucket over the window, oldest first. */
export function sparkPoints(newestFirst: Trade[], nowMs: number, windowMs = 86_400_000, buckets = 48): { t: number; p: number }[] {
  const step = windowMs / buckets;
  const start = nowMs - windowMs;
  const asc = [...newestFirst].reverse().filter((t) => t.price !== null && t.price > 0);
  if (asc.length === 0) return [];
  const pts: { t: number; p: number }[] = [];
  let j = 0;
  let last: number | null = null;
  // Price going into the window.
  while (j < asc.length && asc[j]!.ts <= start) last = asc[j++]!.price;
  for (let b = 1; b <= buckets; b++) {
    const end = start + b * step;
    while (j < asc.length && asc[j]!.ts <= end) last = asc[j++]!.price;
    if (last !== null) pts.push({ t: end, p: last });
  }
  return pts;
}

/** True when the prices drawn span more than `ratio` times (e.g. a graduation jump): a log scale keeps the floor and the early prices visible. */
export function autoLogScale(candles: Pick<Candle, "low" | "high" | "floor">[], ratio = 20): boolean {
  const vals = candles.flatMap((c) => [c.low, c.high, c.floor ?? NaN]).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length < 2) return false;
  return Math.max(...vals) / Math.min(...vals) > ratio;
}
