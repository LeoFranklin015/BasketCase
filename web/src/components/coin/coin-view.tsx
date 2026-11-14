"use client";

import { useEffect, useState } from "react";
import { coinGlow } from "@/lib/assets";
import { useMediaQuery } from "@/lib/hooks";
import { Sheet } from "../sheet";
import { ErrorNote, Skeleton } from "../ui";
import { LiveFeedPanel, MorePanel } from "./activity-panel";
import { AuctionPanel } from "./auction-panel";
import { ChartPanel } from "./chart-panel";
import { EmbedShare } from "./embed-share";
import { CoinProvider, useCoin, useCoinSnapshot, useHistoryFeed } from "./context";
import { BasketPanel, StagePanel } from "./main-panels";
import { MarketHeader } from "./market-header";
import { RitualPanel } from "./ritual-panel";
import { LaunchPanel, PositionPanel } from "./side-panels";
import { TradePanel, type TradeMode } from "./trade-panel";

/**
 * The coin page. The story runs top to bottom: what it is worth and how much is backed, the
 * chart, what backs it, where it is in life, the fight over the basket, and the live feed.
 * Desktop docks the trade card on the right; a phone gets a sticky Buy / Sell bar and a sheet.
 */
export function CoinView({ id }: { id: string }) {
  const q = useCoinSnapshot(id);
  const history = useHistoryFeed(id);
  // After navigating to another coin, don't show the previous one while it loads.
  if (!q.data || q.data.id !== id) {
    if (q.error) {
      return (
        <ErrorNote>
          <p className="font-semibold">Couldn&apos;t load {id}. Retrying every 10 seconds.</p>
          <p className="mt-1 break-words text-sm text-ink-2">{q.error.message}</p>
        </ErrorNote>
      );
    }
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading coin">
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-9 w-44" />
        </div>
        <Skeleton className="h-[72px] w-80 max-w-full" />
        <Skeleton className="h-14 rounded-[16px]" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-[440px]" />
          <Skeleton className="hidden h-[440px] lg:block" />
        </div>
      </div>
    );
  }
  return (
    <CoinProvider snap={q.data} refresh={q.refresh} history={history}>
      <CoinLayout error={q.error} loadedAt={q.data.loadedAt} />
    </CoinProvider>
  );
}

function CoinLayout({ error, loadedAt }: { error?: Error; loadedAt: number }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const { snap } = useCoin();
  const snapId = snap.id;
  const ticker = snap.config.ticker;
  // The header's Buy / Sell pills open the trade card here (desktop) or the sheet (phone).
  const [deskMode, setDeskMode] = useState<{ mode: TradeMode; n: number }>({ mode: "buy", n: 0 });
  useEffect(() => {
    if (!desktop) return;
    const on = (e: Event) => {
      const mode = (e as CustomEvent<TradeMode>).detail;
      setDeskMode((d) => ({ mode, n: d.n + 1 }));
      document.getElementById("trade")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("backed:trade", on);
    return () => window.removeEventListener("backed:trade", on);
  }, [desktop]);
  // The page glows in the coin's own colour; other pages fall back to mint.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--glow-c", coinGlow(ticker));
    return () => {
      root.style.removeProperty("--glow-c");
    };
  }, [ticker]);
  return (
    <div className="pb-20 lg:pb-0">
      {error && (
        <div className="mb-4">
          <ErrorNote error={`Showing data from ${new Date(loadedAt).toLocaleTimeString()}: ${error.message}`} />
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <div className="min-w-0 space-y-6 lg:space-y-8">
          {/* The demo order: what it is and how much is backed, (the trade panel docks beside it), the chart, what backs it, the fight. */}
          <MarketHeader />
          {!desktop && <LaunchPanel />}
          {!desktop && <PositionPanel hideWhenSignedOut />}
          <ChartPanel />
          <BasketPanel />
          <RitualPanel />
          <AuctionPanel />
          <StagePanel />
          <LiveFeedPanel />
          <MorePanel />
          <EmbedShare id={snapId} ticker={ticker} />
        </div>
        {/* The trade column stays pinned while the page scrolls, but never taller than the screen: it scrolls on its own. */}
        <aside className="hidden scroll-mt-24 lg:block" aria-label="Trade" id="trade">
          {desktop && (
            <div className="sticky top-24 -mx-3 -mt-2 max-h-[calc(100dvh-6.5rem)] space-y-4 overflow-y-auto overscroll-contain px-3 pt-2 pb-6 [scrollbar-width:thin]">
              <LaunchPanel />
              <TradePanel key={deskMode.n} initialMode={deskMode.mode} />
              <PositionPanel hideWhenSignedOut />
            </div>
          )}
        </aside>
      </div>
      {!desktop && <TradeDock />}
    </div>
  );
}

/** Phone: a Buy and a Sell at the thumb; either opens the trade sheet. */
function TradeDock() {
  const { snap } = useCoin();
  const [open, setOpen] = useState<TradeMode | null>(null);
  const t = snap.config.ticker;
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent<TradeMode>).detail);
    window.addEventListener("backed:trade", on);
    return () => window.removeEventListener("backed:trade", on);
  }, []);
  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-card/95 px-4 py-2.5 backdrop-blur-md md:bottom-0 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-[1280px] gap-2.5">
          <button type="button" className="btn btn-buy btn-lg flex-[1.6] text-[1.0625rem] font-bold" onClick={() => setOpen("buy")} data-testid="dock-buy">
            Buy ${t}
          </button>
          <button type="button" className="btn btn-sell btn-lg flex-1" onClick={() => setOpen("sell")}>
            Sell
          </button>
        </div>
      </div>
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={`Trade $${t}`}>
        {open && <TradePanel initialMode={open} bare />}
      </Sheet>
    </>
  );
}
