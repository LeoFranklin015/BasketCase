"use client";

import { useMemo, useState } from "react";
import { autoLogScale, pickTimeframe, tfSeconds, TIMEFRAMES, toCandles, type TimeframeId } from "@/lib/history";
import type { PriceUnit } from "@/lib/money";
import { PriceChart, TradingViewCredit, type ChartMarker, type ChartStyle } from "../charts/price-chart";
import { IconCandles, IconChartLine } from "../icons";
import { Skeleton, cx } from "../ui";
import { useCoin, useMarket } from "./context";

/** Price over time as candles with volume, and the floor as a yellow line rising beneath it. A line on request. */
export function ChartPanel() {
  const { snap, bu, history } = useCoin();
  const { trades } = useMarket();
  const [style, setStyle] = useState<ChartStyle>("line");
  const [tfChoice, setTf] = useState<TimeframeId | null>(null);
  const [unit, setUnit] = useState<PriceUnit>("usd");
  const [logChoice, setLog] = useState<boolean | null>(null);
  const tf = tfChoice ?? pickTimeframe(trades);

  const candles = useMemo(() => toCandles(trades, tfSeconds(tf)), [trades, tf]);
  // A graduation jump spans decades of price: start on a log scale so the floor stays in view.
  const log = logChoice ?? autoLogScale(candles);
  const markers = useMemo<ChartMarker[]>(() => {
    const sec = tfSeconds(tf);
    const bucket = (ts: number) => Math.floor(ts / 1000 / sec) * sec;
    const out = new Map<string, ChartMarker>();
    for (const t of trades) {
      const kind = t.kind === "graduate" ? "graduate" : t.kind === "settle" ? "launch" : t.kind === "burn" || t.kind === "redeem" ? "burn" : null;
      if (!kind) continue;
      const time = bucket(t.ts);
      // Graduation and launch outrank a burn in the same bar.
      const key = `${time}`;
      const prev = out.get(key);
      if (!prev || (prev.kind === "burn" && kind !== "burn")) out.set(key, { time, kind });
    }
    return [...out.values()].sort((a, b) => a.time - b.time);
  }, [trades, tf]);

  const st = snap.state;
  const loading = !history?.data && !history?.error;

  return (
    <section className="card flex min-w-0 flex-col overflow-hidden" aria-label="Price chart">
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-4 sm:px-6 sm:pt-5">
        <div className="switch shrink-0" role="group" aria-label="Chart style">
          <button type="button" aria-pressed={style === "line"} onClick={() => setStyle("line")} className="inline-flex items-center gap-1.5 max-sm:px-2.5" title="Line">
            <IconChartLine size={14} />
            <span className="max-sm:sr-only">Line</span>
          </button>
          <button type="button" aria-pressed={style === "candles"} onClick={() => setStyle("candles")} className="inline-flex items-center gap-1.5 max-sm:px-2.5" title="Candles">
            <IconCandles size={14} />
            <span className="max-sm:sr-only">Candles</span>
          </button>
        </div>
        <div className="-mr-1 flex min-w-0 gap-0.5 overflow-x-auto pr-1 [scrollbar-width:none] sm:gap-1" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tf === t.id}
              onClick={() => setTf(t.id)}
              className={cx(
                "num h-8 shrink-0 rounded-full px-2.5 text-[13px] font-bold transition-colors sm:px-3",
                tf === t.id ? "bg-ink text-white" : "text-muted hover:bg-pill hover:text-ink",
              )}
            >
              {t.id}
            </button>
          ))}
        </div>
      </header>

      <div className="relative h-[280px] sm:h-[400px] xl:h-[460px]">
        {loading ? (
          <Skeleton className="absolute inset-4" />
        ) : (
          <PriceChart
            className="h-full"
            candles={candles}
            unit={unit}
            buE6={bu.e6}
            logScale={log}
            style={style}
            markers={markers}
            title={`$${snap.config.ticker}`}
            interval={tf}
            empty={
              <div className="max-w-xs px-4 text-center">
                <p className="font-semibold text-ink-2">{st.mode === "launch" ? "Fair launch in progress" : "No trades yet"}</p>
                <p className="caption mt-1">
                  {st.mode === "launch"
                    ? "Buys are queued and priced together when the window closes. The chart starts then."
                    : history?.error
                      ? `History is unavailable: ${history.error.message}`
                      : "The first buy draws the first point."}
                </p>
              </div>
            }
          />
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <p className="caption flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            {style === "candles" ? (
              <span aria-hidden className="inline-flex gap-[2px]">
                <span className="h-3 w-[5px] rounded-[1px] bg-up" />
                <span className="mt-1 h-2.5 w-[5px] rounded-[1px] bg-down" />
              </span>
            ) : (
              <span aria-hidden className="h-0.5 w-3.5 rounded-full bg-up-line" />
            )}
            price{style === "candles" ? ": up in green, down in red" : ""}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0 w-3.5 border-t-2 border-dashed border-floor-deep" />
            floor: what the vault backs per token
          </span>
          {markers.some((m) => m.kind === "burn") && (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full bg-ink-2" />
              burn
            </span>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <div className="switch" role="group" aria-label="Price unit">
            <button type="button" aria-pressed={unit === "usd"} onClick={() => setUnit("usd")} title="Dollars per token">
              USD
            </button>
            <button type="button" aria-pressed={unit === "bu"} onClick={() => setUnit("bu")} title="Basket units per token">
              BU
            </button>
          </div>
          <div className="switch" role="group" aria-label="Scale">
            <button type="button" aria-pressed={log} onClick={() => setLog(!log)} title="Logarithmic price scale">
              Log
            </button>
          </div>
        </div>
      </footer>
      <p className={cx("caption px-4 pb-4 text-xs sm:px-6 sm:pb-5")} title={history?.data?.note}>
        {history?.data
          ? `${history.data.trades.length} trades from ${history.data.source === "chain" ? "NEARBlocks and NEAR RPC" : history.data.source === "log" ? "the contract log" : "fixture data"}${history.data.complete ? "" : " (partial)"}.`
          : history?.error
            ? "History is unavailable."
            : "Loading history…"}
        {unit === "usd" && ` Dollars at today's basket value (1 BU = $${(bu.e6 / 1e6).toFixed(bu.e6 < 1e5 ? 4 : 2)}).`}{" "}
        <TradingViewCredit />.
      </p>
    </section>
  );
}
