"use client";

import { ORIGINS } from "@backed/client";
import { useEffect, useState } from "react";
import { fmtQty } from "@/lib/money";
import { useCoin } from "./context";
import { TokenIcon } from "../token-icon";
import { ORIGIN_ICON } from "@/lib/icons";

type Quote = {
  token_id: string;
  symbol: string;
  share: number;
  status: "ok" | "no_liquidity" | "error";
  amountOut?: string;
  usdOut?: number;
  seconds?: number;
  message?: string;
};
type Preview = { origin: string; usd: number; quotes: Quote[]; checked_at: string } | { error: string };

/** Live 1Click (mainnet, dry run) quotes: how a buyer on another chain would fill this basket. */
export function CrossChainPanel({ bare }: { bare?: boolean }) {
  const { snap } = useCoin();
  const [from, setFrom] = useState(ORIGINS[0]!.id);
  const [usd, setUsd] = useState(20);
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/routes/${encodeURIComponent(snap.id)}?from=${from}&usd=${usd}`)
        .then((r) => r.json())
        .then((d: Preview) => live && setData(d))
        .catch((e) => live && setData({ error: String(e) }))
        .finally(() => live && setLoading(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [snap.id, from, usd]);

  const quotes = data && "quotes" in data ? data.quotes : [];
  const covered = quotes.filter((q) => q.status === "ok").reduce((s, q) => s + q.share, 0);

  return (
    <section className={bare ? undefined : "card p-5"} aria-labelledby="xchain-h">
      <div className="flex items-start justify-between gap-3">
        <h3 id="xchain-h" className="font-semibold">
          Pay from any chain
        </h3>
        <span className="shrink-0 rounded-full bg-sunk px-2.5 py-1 text-xs font-semibold text-ink-2">mainnet preview</span>
      </div>
      <p className="caption mt-1">
        Live NEAR Intents 1Click quotes for filling this basket from another chain. They are dry runs: nothing is signed or moved. Testnet buys use test
        tokens; on mainnet these routes deliver the basket assets straight into your NEAR Intents balance.
      </p>
      <div className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="xchain-from">
          Pay with
        </label>
        <span className="relative flex-1">
          {ORIGIN_ICON[from] && (
            <TokenIcon symbol={ORIGIN_ICON[from]!.symbol} on={ORIGIN_ICON[from]!.chain} size={22} className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2" />
          )}
          <select id="xchain-from" className={ORIGIN_ICON[from] ? "field pl-12" : "field"} value={from} onChange={(e) => setFrom(e.target.value)}>
            {ORIGINS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
        <label className="sr-only" htmlFor="xchain-usd">
          Amount in dollars
        </label>
        <div className="relative w-28">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">$</span>
          <input
            id="xchain-usd"
            className="field num pl-7"
            type="number"
            min={5}
            max={1000}
            value={usd}
            onChange={(e) => setUsd(Math.min(1000, Math.max(5, Number(e.target.value) || 5)))}
          />
        </div>
      </div>
      <div className="mt-3" aria-live="polite">
        {loading && !quotes.length && <p className="caption py-2">Asking 1Click…</p>}
        {data && "error" in data && <p className="py-2 text-sm text-down">Couldn&apos;t get quotes right now: {data.error}</p>}
        {quotes.length > 0 && (
          <ul className="divide-y divide-line">
            {quotes.map((q) => (
              <li key={q.token_id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <TokenIcon symbol={q.symbol} size={16} chain />
                  <span className="font-semibold">{q.symbol}</span>
                  <span className="num caption text-xs">{Math.round(q.share * 100)}%</span>
                </span>
                <span className="num text-right">
                  {q.status === "ok" ? (
                    <>
                      arrives as {Number.isFinite(Number(q.amountOut)) ? fmtQty(Number(q.amountOut)) : q.amountOut}{" "}
                      <span className="text-muted">
                        ≈ ${q.usdOut?.toFixed(2)} · {q.seconds}s
                      </span>
                    </>
                  ) : (
                    <span className="font-semibold text-down" title={q.message}>
                      {q.status === "no_liquidity" ? "no route right now" : /timeout/i.test(q.message ?? "") ? "1Click timed out" : (q.message ?? "error").slice(0, 40)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {quotes.length > 0 && (
          <p className="caption mt-2 text-xs">
            <span className="num font-semibold text-ink-2">{Math.round(covered * 100)}%</span> of this basket is reachable from {data && "origin" in data ? data.origin : "here"} right
            now{data && "checked_at" in data ? `, checked ${new Date(data.checked_at).toLocaleTimeString()}` : ""}.
          </p>
        )}
      </div>
    </section>
  );
}
