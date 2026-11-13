"use client";

import { graduationProgress, toNumber } from "@backed/client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { backedByLabel, backing, type Backing } from "@/lib/backing";
import { getReader, loadSnapshot, type CoinSnapshot } from "@/lib/data";
import { type Change, changeOver, type HistoryResponse, type Trade } from "@/lib/history";
import { usePoll, type Async } from "@/lib/hooks";
import { basketRows, buToUsdN, buUsdE6, priceToUsd, type BasketRow } from "@/lib/money";

export type CoinCtx = {
  snap: CoinSnapshot;
  rows: BasketRow[];
  /** Dollar value of one BU (x1e6) and whether it comes from live prices. */
  bu: { e6: number; live: boolean };
  refresh: () => void;
  /** Trades and candles from /api/history (absent in embeds that don't load it). */
  history: Async<HistoryResponse> | null;
  /** A buy being typed, in BU after the fee, for the curve chart. */
  preview: number | null;
  setPreview: (bu: number | null) => void;
  /** The same buy for the floor bar: what the floor would back after it. */
  buyPreview: BuyPreview | null;
  setBuyPreview: (p: BuyPreview | null) => void;
};

export type BuyPreview = { payUsd: number; tokens: number; floorValueUsd: number };

const Ctx = createContext<CoinCtx | null>(null);

export function useCoin(): CoinCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCoin outside CoinProvider");
  return c;
}

export function useCoinSnapshot(id: string) {
  return usePoll(() => loadSnapshot(getReader(), id), [id], 10_000);
}

/** GET /api/history/{coin}; `tf` only changes the server-built candles, which the UI rebuilds itself. */
export async function fetchHistory(id: string, tf?: string): Promise<HistoryResponse> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}${tf ? `?tf=${tf}` : ""}`, { cache: "no-store" });
  const body = (await res.json()) as HistoryResponse | { error: string };
  if ("error" in body) throw new Error(body.error);
  return body;
}

/** Trades and candles for a coin, refreshed every 15 s. */
export function useHistoryFeed(id: string, enabled = true): Async<HistoryResponse> | null {
  const q = usePoll(async () => (enabled ? fetchHistory(id) : undefined), [id, enabled], enabled ? 15_000 : 0);
  return enabled ? (q as Async<HistoryResponse>) : null;
}

export function CoinProvider({ snap, refresh, history = null, children }: { snap: CoinSnapshot; refresh: () => void; history?: Async<HistoryResponse> | null; children: ReactNode }) {
  const [preview, setPreview] = useState<number | null>(null);
  const [buyPreview, setBuyPreview] = useState<BuyPreview | null>(null);
  const value = useMemo<CoinCtx>(
    () => ({ snap, rows: basketRows(snap.basket, snap.usdPrices), bu: buUsdE6(snap.config, snap.basket, snap.usdPrices), refresh, history, preview, setPreview, buyPreview, setBuyPreview }),
    // usePoll returns a fresh object each render; depend on its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snap, refresh, history?.data, history?.error, history?.loading, preview, buyPreview],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Trades for this coin (newest first) and the 24 h change against the live price. */
export function useMarket(): { trades: Trade[]; change: Change | null; volume24hBu: number; loaded: boolean } {
  const { snap, history } = useCoin();
  return useMemo(() => {
    const trades = history?.data?.coin === snap.id ? history.data.trades : [];
    const price = Number(snap.state.price) / 1e18;
    const now = snap.loadedAt;
    const volume24hBu = trades.filter((t) => t.ts > now - 86_400_000 && (t.kind === "buy" || t.kind === "sell")).reduce((s, t) => s + t.bu, 0);
    return { trades, change: changeOver(trades, now, price, undefined, history?.data?.coin === snap.id ? history.data.complete : false), volume24hBu, loaded: !!history?.data };
  }, [history?.data, snap.id, snap.state.price, snap.loadedAt]);
}

/** The coin's headline numbers in dollars, from the snapshot. */
export type Numbers = {
  priceUsd: number;
  floorUsd: number;
  circulating: number;
  backing: Backing;
  backedBy: string;
  vaultUsd: number;
  /** 0..1 of the way to graduation (1 once graduated). */
  progress: number;
  gradUsd: number;
};

export function useNumbers(): Numbers {
  const { snap, bu, rows } = useCoin();
  return useMemo(() => {
    const st = snap.state;
    const priceUsd = priceToUsd(st.price, bu.e6);
    const floorUsd = priceToUsd(st.floor, bu.e6);
    const circulating = toNumber(st.circulating, 18);
    return {
      priceUsd,
      floorUsd,
      circulating,
      backing: backing({ priceUsd, floorUsd, circulating }),
      backedBy: backedByLabel(rows),
      vaultUsd: buToUsdN(st.b_total, bu.e6),
      progress: graduationProgress(st, snap.config.grad_reserve),
      gradUsd: buToUsdN(snap.config.grad_reserve, bu.e6),
    };
  }, [snap, bu.e6, rows]);
}
