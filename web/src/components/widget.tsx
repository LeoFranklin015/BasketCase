"use client";
import { formatCompact } from "@backed/client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BRAND, DATA_MODE } from "@/lib/config";
import { changeLabel, pickTimeframe, tfSeconds, toCandles } from "@/lib/history";
import { priceUnit, usd } from "@/lib/money";
import { PriceChart, TradingViewCredit } from "./charts/price-chart";
import { AssetDot, BasketPie, FloorBar, Monogram } from "./coin-bits";
import { CoinProvider, useCoin, useCoinSnapshot, useHistoryFeed, useMarket, useNumbers } from "./coin/context";
import { RitualPanel } from "./coin/ritual-panel";
import { TradePanel } from "./coin/trade-panel";
import { TestnetBadge, ThemeToggle, Wordmark } from "./chrome";
import { IconExternal } from "./icons";
import { Change, ErrorNote, Skeleton, StageChip, Tabs } from "./ui";
import { WalletButton } from "./wallet-button";

/**
 * True inside another site's iframe. There the card never signs anything: a framing page could lay
 * invisible buttons over it (clickjacking), so Buy opens the coin page in a new tab instead.
 * The X player (/x/<coin>) is the exception: its CSP lets only X frame it, so it trades in place.
 */
function useFramed(): boolean {
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);
  return framed;
}

/**
 * A compact buy card for opening from a link: what it's worth, how much is backed, by what, and Buy.
 * `player`: the X player card, which trades in place even inside X's frame and drops the chart to fit the post.
 */
export function Widget({ id, player }: { id: string; player?: boolean }) {
  const q = useCoinSnapshot(id);
  const history = useHistoryFeed(id);
  const framed = useFramed() && !player;
  return (
    <div className={player ? "mx-auto w-full max-w-[560px] space-y-2 p-2" : "mx-auto w-full max-w-[560px] space-y-3 p-3 sm:p-4"}>
      <div className="flex items-center justify-between gap-2">
        <Link href="/" aria-label={`${BRAND.name} home`}>
          <Wordmark className="text-base" />
        </Link>
        <span className="flex items-center gap-1">
          <TestnetBadge />
          <ThemeToggle />
          {!framed && <WalletButton compact />}
        </span>
      </div>
      {DATA_MODE === "fixture" && <p className="rounded-full bg-floor-soft px-3 py-1 text-center text-xs text-ink">Fixture data: nothing is sent.</p>}
      {q.data ? (
        <CoinProvider snap={q.data} refresh={q.refresh} history={history}>
          <WidgetBody framed={framed} player={player} />
        </CoinProvider>
      ) : q.error ? (
        <ErrorNote error={q.error} />
      ) : (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-48" />
          <Skeleton className="h-72" />
        </div>
      )}
    </div>
  );
}

function WidgetBody({ framed, player }: { framed: boolean; player?: boolean }) {
  const { snap, bu, rows } = useCoin();
  const m = useMarket();
  const n = useNumbers();
  const [tab, setTab] = useState<"trade" | "challenge">("trade");
  const unit = priceUnit(n.priceUsd);
  const candles = useMemo(() => toCandles(m.trades, tfSeconds(pickTimeframe(m.trades, 60))), [m.trades]);
  return (
    <>
      <section className="card overflow-hidden" aria-label="Price and floor">
        <div className="p-4 pb-3 sm:p-5 sm:pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <Monogram ticker={snap.config.ticker} icon={snap.config.icon} size={36} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h1 className="display text-[1.375rem] leading-none">${snap.config.ticker}</h1>
                    <StageChip mode={snap.state.mode} />
                  </div>
                  {!player && <p className="caption mt-0.5 truncate">{snap.config.name}</p>}
                </div>
              </div>
              <p className="display mt-4 text-[2.375rem] leading-[0.95] sm:text-[2.75rem]">{usd(n.backing.mcapUsd)}</p>
              {!player && <p className="caption mt-1">market cap: the price × {formatCompact(n.circulating)} tokens out there</p>}
              <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <span className="num font-bold" data-testid="price-usd" title={`${usd(n.priceUsd)} per token`}>
                  {usd(n.priceUsd * unit.mult)}
                </span>
                <span className="caption">{unit.label}</span>
                <Change pct={m.change?.pct} />
                <span className="caption">{changeLabel(m.change, snap.loadedAt)}</span>
              </p>
            </div>
            <div className="hidden shrink-0 flex-col items-center gap-1.5 min-[480px]:flex">
              <BasketPie slices={rows.map((r) => ({ key: r.token_id, symbol: r.symbol, share: r.share ?? 0 }))} size={104} label={`Basket: ${rows.map((r) => `${r.symbol} ${Math.round((r.share ?? 0) * 100)}%`).join(", ")}`}>
                <span className="display text-[0.875rem] leading-none">{usd(n.vaultUsd)}</span>
                <span className="caption text-[10px]">in the vault</span>
              </BasketPie>
            </div>
          </div>
        </div>
        {!player && <PriceChart className="h-[128px] sm:h-[150px]" candles={candles} unit="usd" buE6={bu.e6} compact />}
        <div className="p-4 sm:p-5">
          <FloorBar size="md" share={n.backing.share} backedUsd={n.backing.backedUsd} hypeUsd={n.backing.hypeUsd} backedBy={n.backedBy} />
          <p className="caption mt-2.5 text-xs">
            <span className="num floor-tag text-[0.8125rem]" data-testid="floor-usd" title={`${usd(n.floorUsd)} per token`}>
              floor {usd(n.floorUsd * unit.mult)}
            </span>{" "}
            {player ? `${unit.label}: the least a sell pays. Not a guarantee.` : `${unit.label}: the least a sell pays before the fee. It is backed by assets whose prices move, so it is not a guarantee.`}
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3 text-sm min-[480px]:hidden">
            {rows.map((r) => (
              <li key={r.token_id} className="inline-flex items-center gap-1.5">
                <AssetDot symbol={r.symbol} size={9} />
                <span className="font-semibold">{r.symbol}</span>
                <span className="num text-muted">{Math.round((r.share ?? 0) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {framed ? (
        <a className="btn btn-buy btn-lg w-full text-[1.0625rem] font-bold" href={`/c/${snap.id}`} target="_blank" rel="noopener">
          Buy ${snap.config.ticker}
          <IconExternal size={15} />
        </a>
      ) : player ? (
        <TradePanel compact tight />
      ) : (
        <>
      <Tabs
        label="Action"
        value={tab}
        onChange={setTab}
        className="flex w-full"
        options={[
          { id: "trade", label: "Buy or sell" },
          { id: "challenge", label: "Challenge" },
        ]}
      />
      {tab === "trade" ? <TradePanel compact /> : <RitualPanel compact />}
        </>
      )}
      <p className="text-center text-sm">
        <Link className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink" href={`/c/${snap.id}`} target="_blank">
          Open the full coin page
          <IconExternal size={13} />
        </Link>
      </p>
      <p className="caption text-center text-xs">
        <TradingViewCredit />
      </p>
    </>
  );
}
