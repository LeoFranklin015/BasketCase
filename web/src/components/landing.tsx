"use client";

import { formatCompact, graduationProgress, toNumber, type CoinMode } from "@backed/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { backedByLabel, backing } from "@/lib/backing";
import { BRAND, EXPLORER_ACCOUNT, NET, RHEA_POOLS, deployment, rheaPoolUrl } from "@/lib/config";
import { getReader, loadSummary } from "@/lib/data";
import { useNow, usePoll } from "@/lib/hooks";
import { sparkPoints, type Trade } from "@/lib/history";
import { basketRows, buToUsdN, buUsdE6, priceToUsd, priceUnit, usd, type BasketRow } from "@/lib/money";
import { Monogram } from "./coin-bits";
import { DataNotice, Mark, Wordmark } from "./chrome";
import { fetchHistory } from "./coin/context";
import { IconArrowDown, IconArrowRight, IconArrowUp, IconExternal } from "./icons";
import { ErrorNote, Money, Skeleton, StageChip, cx } from "./ui";
import { TryFreeButton } from "./wallet-button";
import { GUEST_ENABLED } from "@/lib/wallet";
import { ChainIcon, TokenIcon, WalletIcon } from "./token-icon";
import { CHAIN_NAME } from "@/lib/icons";

/** One live coin, in the dollars the landing page shows. */
type LiveCoin = {
  id: string;
  ticker: string;
  name: string;
  icon: string | null;
  mode: CoinMode;
  feeBps: number;
  priceUsd: number;
  floorUsd: number;
  circulating: number;
  mcapUsd: number;
  backedUsd: number;
  hypeUsd: number;
  share: number;
  vaultUsd: number;
  rows: BasketRow[];
  backedBy: string;
  buE6: number;
  createdMs: number;
  creator: string;
  progress: number | null;
};

type Live = { coins: LiveCoin[]; graves: number | null; symbols: string[] };

async function loadLive(): Promise<Live> {
  const r = getReader();
  const [infos, prices] = await Promise.all([r.listAllCoins(), r.swapper.getPrices().catch(() => [] as [string, string][])]);
  const usdPrices = Object.fromEntries(prices);
  const summaries = await Promise.all(infos.map((i) => loadSummary(r, i).catch(() => null)));
  if (infos.length > 0 && summaries.every((s) => s === null)) throw new Error(`Couldn't read the coins from ${NET.chain} just now. Retrying every 30 seconds.`);
  const ok = summaries.filter((s) => s !== null);
  const coins = ok.map((s): LiveCoin => {
    const bu = buUsdE6(s.config, s.basket, usdPrices).e6;
    const priceUsd = priceToUsd(s.state.price, bu);
    const floorUsd = priceToUsd(s.state.floor, bu);
    const circulating = toNumber(s.state.circulating, 18);
    const b = backing({ priceUsd, floorUsd, circulating });
    const rows = basketRows(s.basket, usdPrices);
    return {
      id: s.info.account_id,
      ticker: s.config.ticker,
      name: s.config.name,
      icon: s.config.icon ?? null,
      mode: s.state.mode,
      feeBps: s.config.fee_bps,
      priceUsd,
      floorUsd,
      circulating,
      ...b,
      vaultUsd: buToUsdN(s.state.b_total, bu),
      rows,
      backedBy: backedByLabel(rows),
      buE6: bu,
      createdMs: s.info.created_ms,
      creator: s.info.creator,
      progress: s.state.mode === "curve" ? graduationProgress(s.state, s.config.grad_reserve) : null,
    };
  });
  // The graveyard count is a nice-to-have: a failed read hides it rather than failing the page.
  const tombs = await Promise.all(ok.map((s) => r.coin(s.info.account_id).getTombstones(0, 100).then((t) => t.length).catch(() => null)));
  const graves = tombs.every((t) => t === null) ? null : tombs.reduce<number>((a, t) => a + (t ?? 0), 0);
  const symbols = [...new Set(coins.flatMap((c) => c.rows.filter((row) => row.known).map((row) => row.symbol)))];
  return { coins: coins
      .filter((c) => c.mcapUsd > 0)
      // Lead with the showcase coins (assets everyone knows: NVIDIA, ETH, SOL, BTC), then live curves before graduated
      // coins, then by size. The DEMO coins are our own walkthrough coins, so they go last.
      .sort(
        (a, b) =>
          Number(a.ticker.startsWith("DEMO")) - Number(b.ticker.startsWith("DEMO")) ||
          featuredRank(a.ticker) - featuredRank(b.ticker) ||
          Number(a.progress === null) - Number(b.progress === null) ||
          b.mcapUsd - a.mcapUsd,
      ), graves, symbols };
}

const FEATURED = ["GPU", "DEGEN", "CHIPS", "TRENCH", "MEMES"];
function featuredRank(ticker: string): number {
  const i = FEATURED.indexOf(ticker);
  return i < 0 ? FEATURED.length : i;
}

export function Landing() {
  const live = usePoll(loadLive, [], 30_000);
  const coins = live.data?.coins ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const coin = coins.find((c) => c.id === pick) ?? coins[0] ?? null;
  const state: LoadState = live.data ? "ok" : live.error ? "error" : "loading";
  const histories = useHistories(coins);

  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <div aria-hidden className="top-glow" />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2">
        Skip to content
      </a>
      <DataNotice />
      <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[56px] max-w-[1200px] items-center justify-between gap-3 px-5 md:h-16 lg:px-8">
          <Link href="/" aria-label={`${BRAND.name} home`}>
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-1 text-[15px] font-medium text-muted md:flex">
            <a href="#how-h" className="rounded-full px-3.5 py-2 hover:bg-pill hover:text-ink">
              How it works
            </a>
            <a href="#diff-h" className="rounded-full px-3.5 py-2 hover:bg-pill hover:text-ink">
              Why it&apos;s different
            </a>
            <a href="#x-h" className="rounded-full px-3.5 py-2 hover:bg-pill hover:text-ink">
              On X
            </a>
          </nav>
          <Link href="/app" className="btn btn-quiet btn-sm">
            Open the app
          </Link>
        </div>
      </header>

      <main id="main" className="flex-1">
        <Hero live={live.data} error={live.error} state={state} coins={coins} coin={coin} onPick={setPick} />
        <HowItWorks coin={coin} trades={coin ? histories[coin.id] : undefined} graduated={graduatedExample(coins)} />
        <WhyDifferent coin={coin} />
        <OnX coin={coins.find((c) => c.ticker === "GPU") ?? coin} />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-5 py-8 text-[13px] leading-relaxed text-muted lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <p className="max-w-3xl">
            {NET.testTokens ? `${NET.chain}: every token here is a test token with no value. Most trades come from our own test accounts, tagged as such. ` : `${NET.chain}. `}A
            floor is not a guarantee: it is backed by assets whose prices move.
          </p>
          <nav aria-label="Footer" className="flex shrink-0 flex-wrap gap-x-5 gap-y-1 font-medium text-ink-2">
            <Link href="/app" className="hover:text-ink">
              Markets
            </Link>
            <a href={EXPLORER_ACCOUNT(deployment.factory)} target="_blank" rel="noreferrer" className="hover:text-ink">
              Factory on NEARBlocks
            </a>
            <a href="/api/status" target="_blank" rel="noreferrer" className="hover:text-ink">
              /api/status
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** The step-4 example: $AI if it has graduated, else any graduated coin with a Rhea pool, else any graduated coin. */
function graduatedExample(coins: LiveCoin[]): LiveCoin | null {
  const index = coins.filter((c) => c.mode === "index");
  return index.find((c) => c.id.startsWith("ai-")) ?? index.find((c) => rheaPoolUrl(c.id)) ?? index[0] ?? null;
}

/** Each live coin's trades, newest first (one fetch per coin, refreshed every 30 s). */
function useHistories(coins: LiveCoin[]): Record<string, Trade[]> {
  const key = coins.map((c) => c.id).join(",");
  const res = usePoll(
    async () => {
      const all = await Promise.all(coins.map((c) => fetchHistory(c.id).then((h) => [c.id, h.trades] as const).catch(() => [c.id, [] as Trade[]] as const)));
      return Object.fromEntries(all) as Record<string, Trade[]>;
    },
    [key],
    30_000,
  );
  return res.data ?? {};
}

type LoadState = "loading" | "error" | "ok";

/* ---------------------------------------------------------------------------------------------- */
/* Hero                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

function Hero({ live, error, state, coins, coin, onPick }: { live: Live | undefined; error: Error | undefined; state: LoadState; coins: LiveCoin[]; coin: LiveCoin | null; onPick: (id: string) => void }) {
  const vault = coins.reduce((a, c) => a + c.vaultUsd, 0);
  return (
    <section aria-labelledby="hero-h" className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 pb-16 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-16 lg:px-8 lg:pb-24 lg:pt-20">
      <div className="min-w-0">
        <h1 id="hero-h" className="meme max-w-[12ch] text-[clamp(2.75rem,1.6rem+4vw,4.25rem)] leading-[1.02]">
          Buy the meme. Keep the index.
        </h1>
        <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-muted sm:text-[19px]">
          Most memecoins end at zero because nothing is underneath. Here every coin holds a real basket (like NVIDIA, ETH, SOL, BTC) in its own vault, so the hype sits on
          top of something you can sell back into.
        </p>
        <HeroCtas coin={coin} />
        <div className="mt-8" aria-live="polite">
          {state === "ok" && live && coin ? (
            <ul className="flex flex-col gap-2 text-[15px]">
              <li className="flex items-baseline gap-2">
                <span className="num font-semibold text-ink">{Math.round(coin.share * 100)}%</span>
                <span className="text-muted">of ${coin.ticker}&apos;s price is real assets</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="floor-tag text-[13px]">floor</span>
                <span className="text-muted">Sell any time for at least the floor</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="num font-semibold text-ink">0</span>
                <span className="text-muted">keys: nobody can take the basket</span>
              </li>
            </ul>
          ) : (
            <p className="caption">{state === "error" ? `${NET.chain} isn't answering right now. The numbers will appear when it does.` : `Reading the vaults on ${NET.chain}…`}</p>
          )}
          <p className="caption mt-2 text-xs">Live from {NET.chain}.{NET.testTokens ? " Test tokens, no real value." : ""}</p>
        </div>
      </div>

      <div className="relative min-w-0" role="group" aria-label="A live coin">
        <div aria-hidden className="absolute -inset-16 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(110,220,150,0.45),transparent)] blur-2xl" />
        <div className="mb-4 flex min-h-9 flex-wrap items-center gap-2" role="group" aria-label="Pick a live coin">
          {state === "ok" &&
            coins.slice(0, 4).map((c) => (
              <button key={c.id} type="button" className="chip" aria-pressed={coin?.id === c.id} onClick={() => onPick(c.id)}>
                ${c.ticker}
              </button>
            ))}
          {state === "loading" && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-20 rounded-full" />)}
        </div>
        {coin ? (
          <CoinCard coin={coin} />
        ) : state === "loading" ? (
          <Skeleton className="h-[440px] rounded-[32px]" />
        ) : (
          <div className="rounded-[32px] bg-white p-7 shadow-[var(--shadow-card)]">
            {error ? <ErrorNote error={error} /> : <p className="caption">The first coin launched on {NET.chain} shows up here.</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function usdShort(n: number): string {
  return n >= 1000 ? `$${formatCompact(n)}` : usd(n);
}

/** Try it free (a guest wallet, then straight to a live coin) where it is offered; otherwise launch. */
function HeroCtas({ coin }: { coin: LiveCoin | null }) {
  const router = useRouter();
  return (
    <div className="mt-8 flex flex-wrap items-start gap-3">
      {GUEST_ENABLED ? (
        <TryFreeButton className="btn-lg" onDone={() => router.push(coin ? `/c/${coin.id}` : "/app")} />
      ) : (
        <Link href="/launch" className="btn btn-ink btn-lg">
          Launch a coin
        </Link>
      )}
      <Link href="/app" className="btn btn-quiet btn-lg">
        Explore coins
      </Link>
    </div>
  );
}

function StatLine({ v, k }: { v: string; k: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="num font-semibold text-ink">{v}</span>
      <span className="label">{k}</span>
    </span>
  );
}

/** The floor's highlighter: yellow behind the word. */
function Hl({ children }: { children: ReactNode }) {
  return <span className="floor-tag">{children}</span>;
}

/** The top of a coin's screen, as a floating card: who it is, what it is worth, how much is backed. */
function CoinCard({ coin }: { coin: LiveCoin }) {
  const pct = Math.round(coin.share * 100);
  const unit = priceUnit(coin.priceUsd);
  const w = Math.max(0, Math.min(100, coin.share * 100));
  return (
    <div className="rounded-[32px] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-20px_rgba(0,0,0,0.18)] sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[1.125rem] font-bold uppercase">${coin.ticker}</span>
        <StageChip mode={coin.mode} />
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <span className="relative shrink-0">
          <Monogram ticker={coin.ticker} icon={coin.icon} size={72} />
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[3px]">
            <ChainIcon chain="near" size={20} />
          </span>
        </span>
        <span className="truncate rounded-full bg-pill px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.02em]">{coin.id.length > 20 ? `${coin.id.slice(0, 9)}…${coin.id.slice(-8)}` : coin.id}</span>
      </div>
      <p className="display mt-4 text-[2.75rem]">
        <Money text={usd(coin.mcapUsd)} />
      </p>
      <p className="caption mt-1">market cap</p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 text-[15px]">
        <span className="inline-flex items-baseline gap-1.5">
          <span className="floor-tag num">{usd(coin.floorUsd * unit.mult)}</span>
          <span className="label">floor {unit.label.replace("per ", "/ ").replace(" tokens", "").replace("token", "token")}</span>
        </span>
        <StatLine v={`${pct}%`} k="backed" />
      </p>
      <p className="mt-3 flex items-center gap-2 text-sm text-muted">
        <span className="flex -space-x-1">
          {coin.rows.slice(0, 4).map((r) => (
            <TokenIcon key={r.token_id} symbol={r.symbol} size={30} className="rounded-full ring-2 ring-white" />
          ))}
        </span>
        backed by {coin.backedBy}
      </p>
      <div
        role="img"
        aria-label={`$${coin.ticker}: ${usd(coin.backedUsd)} of its ${usd(coin.mcapUsd)} market cap is backed by ${coin.backedBy}, ${pct}%. ${usd(coin.hypeUsd)} is hype.`}
        className="hatch relative mt-5 h-3 overflow-hidden rounded-full"
      >
        <span className="anim-w absolute inset-0 rounded-full bg-floor" style={{ clipPath: `inset(0 ${100 - w}% 0 0 round 999px)` }} />
      </div>
      <p className="caption mt-2">
        yellow = the index (real assets, {usd(coin.backedUsd)}) · stripes = the meme (hype, {usd(coin.hypeUsd)})
      </p>
      <div className="mt-6 flex gap-3">
        <Link href={`/c/${coin.id}`} className="btn btn-quiet h-14 flex-1 text-base">
          <IconArrowUp size={18} />
          Buy
        </Link>
        <Link href={`/c/${coin.id}`} className="btn btn-quiet h-14 flex-1 text-base">
          <IconArrowDown size={18} />
          Sell
        </Link>
      </div>
    </div>
  );
}


/* ---------------------------------------------------------------------------------------------- */
/* How it works: one $20 buy, four steps in one line of tabs.                                     */
/* ---------------------------------------------------------------------------------------------- */

const STEP_MS = 4000;

function HowItWorks({ coin, trades, graduated }: { coin: LiveCoin | null; trades: Trade[] | undefined; graduated: LiveCoin | null }) {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    if (paused || reduced) return;
    const t = setInterval(() => setStep((s) => (s + 1) % 4), STEP_MS);
    return () => clearInterval(t);
  }, [paused, reduced]);
  const t = coin?.ticker ?? "DEGEN";
  const basket = coin?.rows.length ? coin.rows.map((r) => r.symbol).join(", ").replace(/, ([^,]*)$/, " and $1") : "the basket";
  const steps: { tab: string; short: string; caption: string; note?: string; visual: ReactNode }[] = [
    { tab: "Buy the basket", short: "Buy", caption: `Your $20 is swapped into ${basket} and locked in the coin's own vault.`, visual: <BuyVisual coin={coin} /> },
    { tab: "Floor is set", short: "Floor", caption: "Vault ÷ tokens = the floor: the least any sell pays.", note: "It moves with the assets' prices, so it isn't a guarantee.", visual: <FloorVisual coin={coin} /> },
    { tab: "Floor climbs", short: "Climbs", caption: "The price above the floor is the meme. Fees and burns stay in the vault, so the floor climbs.", visual: <ClimbVisual coin={coin} trades={trades} /> },
    { tab: "Becomes an index", short: "Index", caption: "Once the vault is big enough, each token is a share of the basket: redeem it, or trade it on Rhea.", visual: <IndexVisual coin={graduated} /> },
  ];
  return (
    <section aria-labelledby="how-h" className="scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-5 py-16 lg:px-8 lg:py-24">
        <h2 id="how-h" className="meme text-[clamp(2rem,1.4rem+2vw,3rem)]">
          How it works
        </h2>
        <p className="mt-3 max-w-xl text-[17px] text-muted">Follow one $20 buy of ${t}.</p>

        <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
          {/* Four steps in one line: a tab each, the active one fills as it plays. */}
          <div role="tablist" aria-label="Steps" className="mt-8 grid grid-cols-4 gap-1.5 sm:gap-2">
            {steps.map((st, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={step === i}
                onClick={() => setStep(i)}
                className={cx(
                  "relative flex min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-full px-2 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors sm:gap-2.5 sm:px-4 sm:py-3 sm:text-[15px]",
                  step === i ? "bg-ink text-white" : "bg-pill text-ink hover:bg-pill-hover",
                )}
              >
                <span className={cx("hidden size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold sm:flex", step === i ? "bg-white text-ink" : "bg-white/70 text-ink")}>{i + 1}</span>
                <span className="sm:hidden">{st.short}</span>
                <span className="hidden sm:inline">{st.tab}</span>
                {step === i && !paused && !reduced && (
                  <span key={`p${step}`} aria-hidden className="how-progress absolute bottom-0 left-0 h-[3px] bg-floor" style={{ animationDuration: `${STEP_MS}ms` }} />
                )}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-live="polite" className="card mt-4 grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <p className="text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] font-bold leading-tight tracking-[-0.03em]">{steps[step]!.caption}</p>
              {steps[step]!.note && <p className="caption mt-3">{steps[step]!.note}</p>}
            </div>
            <div className="flex min-h-[260px] items-center justify-center">{steps[step]!.visual}</div>
          </div>
        </div>

        <p className="mt-12 max-w-3xl text-[clamp(1.25rem,1rem+0.8vw,1.625rem)] font-semibold leading-snug tracking-[-0.02em]">
          A meme gives you the upside. An index leaves you something when the meme fades. Here it&apos;s one token.
        </p>
      </div>
    </section>
  );
}

/** Step 4: a coin that graduated, from live data: an index you can redeem, with its Rhea pool. */
function IndexVisual({ coin }: { coin: LiveCoin | null }) {
  if (!coin) return <Skeleton className="h-56 w-full max-w-sm" />;
  const pool = RHEA_POOLS[coin.id];
  const rhea = rheaPoolUrl(coin.id);
  return (
    <div className="w-full max-w-[360px] rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-16px_rgba(0,0,0,0.16)]">
      <div className="flex items-center gap-3">
        <Monogram ticker={coin.ticker} icon={coin.icon} size={44} />
        <span className="min-w-0">
          <span className="block font-bold">${coin.ticker}</span>
          <span className="block truncate text-[13px] text-muted">{coin.name}</span>
        </span>
      </div>
      <p className="display mt-4 text-[1.75rem]">
        <Money text={usd(coin.vaultUsd)} />
      </p>
      <p className="caption">in the basket</p>
      <span className="mt-3 flex -space-x-1.5">
        {coin.rows.slice(0, 5).map((r) => (
          <TokenIcon key={r.token_id} symbol={r.symbol} size={30} className="rounded-full ring-2 ring-white" />
        ))}
      </span>
      <span className="mt-4 flex flex-wrap gap-1.5">
        {coin.mode === "index" && <span className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-xs font-semibold text-white">Graduated · index</span>}
        {rhea && (
          <a href={rhea} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-pill px-2.5 text-xs font-semibold hover:bg-[var(--pill-hover)]">
            <TokenIcon symbol="RHEA" size={14} />
            On Rhea · pool #{pool}
          </a>
        )}
      </span>
      <Link href={`/c/${coin.id}`} className="btn btn-quiet mt-4 w-full">
        Redeem for the basket
      </Link>
    </div>
  );
}

function Arrow() {
  return <IconArrowRight size={22} className="shrink-0 text-faint" />;
}

/** Step 1: $20 → the basket → the vault grows by what is backed. */
function BuyVisual({ coin }: { coin: LiveCoin | null }) {
  const pay = 20;
  const backed = coin ? pay * (1 - coin.feeBps / 10_000) * coin.share : 19;
  const rows = coin?.rows.slice(0, 4) ?? [];
  return (
    <div className="flex w-full max-w-[560px] flex-wrap items-center justify-center gap-4 sm:gap-6">
      <span className="display rounded-full bg-ink px-5 py-3 text-[1.75rem] text-white">$20</span>
      <Arrow />
      <span className="flex flex-col items-center gap-2">
        <span className="flex -space-x-3">
          {(rows.length ? rows.map((r) => r.symbol) : ["BTC", "SOL"]).map((sym) => (
            <TokenIcon key={sym} symbol={sym} size={52} chain className="rounded-full ring-4 ring-white" />
          ))}
        </span>
        <span className="caption">{rows.length ? rows.map((r) => `${r.symbol} ${Math.round((r.share ?? 0) * 100)}%`).join(" · ") : "BTC 50% · SOL 50%"}</span>
      </span>
      <Arrow />
      <span className="flex flex-col items-start rounded-[20px] bg-[#f2f2f2] px-5 py-4">
        <span className="label">vault</span>
        <span className="display mt-1 text-[1.75rem]">
          <Money text={usd(coin?.vaultUsd ?? 0)} />
        </span>
        <span className="num mt-1 text-[15px] font-semibold text-up">+{usd(backed)} backed</span>
      </span>
    </div>
  );
}

/** Step 2: backed ÷ tokens = floor, from live numbers. */
function FloorVisual({ coin }: { coin: LiveCoin | null }) {
  if (!coin) return <Skeleton className="h-24 w-full max-w-md" />;
  const unit = priceUnit(coin.floorUsd);
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <p className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-2 text-[clamp(1.75rem,1.2rem+2vw,2.75rem)]">
        <span className="display">{usd(coin.backedUsd)}</span>
        <span className="display text-faint">÷</span>
        <span className="display">{formatCompact(coin.circulating)}</span>
        <span className="display text-faint">=</span>
        <span className="display floor-tag">{usd(coin.floorUsd * unit.mult)}</span>
      </p>
      <p className="flex flex-wrap justify-center gap-x-8 gap-y-1 text-sm">
        <span className="label">the vault backs</span>
        <span className="label">tokens out there</span>
        <span className="label">floor {unit.label}</span>
      </p>
      <p className="caption mt-2">Live: ${coin.ticker} right now.</p>
    </div>
  );
}

/** Step 3: the price line over the stepped yellow floor, from live history. */
function ClimbVisual({ coin, trades }: { coin: LiveCoin | null; trades: Trade[] | undefined }) {
  const now = useNow(60_000);
  if (!coin || !trades || trades.length < 2 || !now) return <Skeleton className="h-48 w-full max-w-lg" />;
  const first = trades.at(-1)!.ts;
  const windowMs = Math.max(3_600_000, now - first);
  const price = sparkPoints(trades, now, windowMs, 60);
  const floor = sparkPoints(
    trades.map((t) => ({ ...t, price: t.floor })),
    now,
    windowMs,
    60,
  );
  if (price.length < 2) return <p className="caption">No trades yet.</p>;
  const W = 560;
  const H = 240;
  const all = [...price, ...floor];
  const t0 = Math.min(...all.map((x) => x.t));
  const t1 = Math.max(...all.map((x) => x.t));
  const hi = Math.max(...all.map((x) => x.p)) * 1.04;
  const lo = Math.min(...all.map((x) => x.p)) * 0.96;
  const X = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const Y = (p: number) => H - ((p - lo) / Math.max(1e-30, hi - lo)) * H;
  const line = price.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`).join("");
  let step = "";
  floor.forEach((x, i) => {
    step += i ? `H${X(x.t).toFixed(1)}V${Y(x.p).toFixed(1)}` : `M${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`;
  });
  const area = floor.length ? `${step}V${H}H${X(floor[0]!.t).toFixed(1)}Z` : "";
  return (
    <figure className="w-full max-w-[600px]">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`$${coin.ticker}: the price line above its floor, which has stepped up since launch`}>
        {area && <path d={area} fill="#ffe14d" fillOpacity={0.35} />}
        {step && <path d={step} fill="none" stroke="#e0b400" strokeWidth={2.5} strokeDasharray="6 5" />}
        <path d={line} fill="none" stroke="#2dbe60" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="mt-3 flex justify-center gap-6 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-[3px] w-5 rounded-full bg-up-line" />
          price
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-0 w-5 border-t-2 border-dashed border-floor-deep" />
          floor
        </span>
        <span>${coin.ticker} since launch</span>
      </figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Why this is different: the pain points, one row each.                                           */
/* ---------------------------------------------------------------------------------------------- */

function DiffRow({ title, children, visual, i }: { title: string; children: ReactNode; visual: ReactNode; i: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 border-t border-line py-12 first:border-t-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:py-16">
      <div className={cx("min-w-0", i % 2 === 1 && "lg:order-last")}>
        <h3 className="text-[clamp(1.625rem,1.2rem+1.4vw,2.25rem)] font-bold leading-[1.1] tracking-[-0.035em]">{title}</h3>
        <div className="mt-4 max-w-[34rem] text-[17px] leading-relaxed text-muted">{children}</div>
      </div>
      <div className="card flex min-h-[220px] min-w-0 items-center justify-center p-8">{visual}</div>
    </li>
  );
}

function Flow() {
  return <IconArrowRight size={20} className="shrink-0 text-faint" />;
}

function WhyDifferent({ coin }: { coin: LiveCoin | null }) {
  const aiPool = rheaPoolUrl("ai-0.pad.backedlab.testnet");
  const checkId = coin?.id ?? deployment.factory;
  return (
    <section aria-labelledby="diff-h" className="scroll-mt-20">
      <div className="mx-auto max-w-[1200px] px-5 py-16 lg:px-8 lg:py-24">
        <h2 id="diff-h" className="meme max-w-[18ch] text-[clamp(2rem,1.4rem+2vw,3rem)]">
          Floors and baskets exist. Here&apos;s what doesn&apos;t.
        </h2>
        <ol className="mt-6">
          <DiffRow
            i={0}
            title="One vault, assets from every chain."
            visual={
              <div className="flex w-full flex-wrap items-center justify-center gap-5">
                <span className="flex flex-col gap-2.5">
                  {(["bitcoin", "ethereum", "solana", "base", "bsc"] as const).map((c) => (
                    <span key={c} className="flex items-center gap-2 text-sm font-medium">
                      <ChainIcon chain={c} size={26} />
                      {CHAIN_NAME[c]}
                    </span>
                  ))}
                </span>
                <Flow />
                <span className="flex flex-col items-center gap-3 rounded-[24px] bg-[#f2f2f2] px-6 py-5">
                  <span className="label">one vault</span>
                  <span className="flex -space-x-2.5">
                    {["NVDA", "ETH", "SOL", "BTC", "PEPE"].map((sym) => (
                      <TokenIcon key={sym} symbol={sym} size={40} chain className="rounded-full ring-[3px] ring-[#f2f2f2]" />
                    ))}
                  </span>
                  <span className="caption">held through NEAR Intents</span>
                </span>
              </div>
            }
          >
            A floor backed by one token on one chain rises and falls with that one token. Here a single vault holds a basket from Bitcoin, Ethereum, Solana, Base and BNB
            Chain, all through NEAR Intents.{NET.testTokens ? " On testnet they are test versions." : ""}
          </DiffRow>
          <DiffRow
            i={1}
            title="Buy from the wallet you already have."
            visual={
              <div className="flex w-full flex-col items-center gap-4">
                {(
                  [
                    ["metamask", "MetaMask", "USDC", "base"],
                    ["phantom", "Phantom", "USDC", "solana"],
                  ] as const
                ).map(([w, name, sym, chain]) => (
                  <span key={w} className="flex items-center gap-4">
                    <span className="flex w-32 items-center gap-2 text-sm font-semibold">
                      <WalletIcon kind={w} size={34} />
                      {name}
                    </span>
                    <TokenIcon symbol={sym} on={chain} size={30} />
                    <Flow />
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <ChainIcon chain="near" size={30} />
                      NEAR Intents
                    </span>
                  </span>
                ))}
              </div>
            }
          >
            Buying a NEAR memecoin from another chain usually means a bridge and a new wallet. On the mainnet build you pay with USDC from MetaMask on Base or Phantom on
            Solana in one transfer, and the tokens land in NEAR Intents under your own wallet&apos;s address; our executor completes the buy.
            <span className="mt-3 block text-[14px]">
              <span className="mr-1.5 rounded-full bg-pill px-2 py-0.5 text-[12px] font-semibold text-ink">Next</span>
              NEAR Chain Signatures, so one NEAR account can buy from any chain address. Not live yet.
            </span>
          </DiffRow>
          <DiffRow
            i={0}
            title="Made for NEAR's memes."
            visual={
              <div className="flex flex-col items-center gap-5">
                <span className="flex flex-wrap justify-center gap-4">
                  {["BLACKDRAGON", "SHITZU", "JAMBO"].map((sym) => (
                    <span key={sym} className="flex flex-col items-center gap-1.5">
                      <TokenIcon symbol={sym} size={56} />
                      <span className="text-[13px] font-semibold">{sym}</span>
                      {sym === "JAMBO" && <span className="caption -mt-1 text-[11px]">from meme.cooking</span>}
                    </span>
                  ))}
                </span>
                {aiPool && (
                  <a href={aiPool} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-pill px-3.5 py-1.5 text-sm font-semibold hover:bg-[var(--pill-hover)]">
                    <TokenIcon symbol="RHEA" size={18} />
                    $AI is on Rhea: pool #2977
                    <IconExternal size={13} />
                  </a>
                )}
              </div>
            }
          >
            NEAR&apos;s meme scene is split across launchpads and pools. Baskets here can hold NEAR memecoins like BLACKDRAGON, SHITZU and JAMBO from meme.cooking, and a coin
            that graduates gets a Rhea pool to trade in.
          </DiffRow>
          <DiffRow
            i={1}
            title="Nobody holds the keys."
            visual={
              <div className="flex flex-col items-center text-center">
                <span className="display text-[5rem] leading-none">0</span>
                <span className="label mt-2">access keys on each coin</span>
                <a href={EXPLORER_ACCOUNT(checkId)} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm mt-5">
                  Check it on NEARBlocks
                  <IconExternal size={13} />
                </a>
              </div>
            }
          >
            Memecoin treasuries usually sit with someone who can move them. Here each coin is its own NEAR contract with no access keys and no owner methods; the floor is
            computed on-chain from what the vault holds, and holders fight over the basket each round.
          </DiffRow>
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Buy it inside a post on X: the live card, framed.                                               */
/* ---------------------------------------------------------------------------------------------- */

function OnX({ coin }: { coin: LiveCoin | null }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const id = coin?.id ?? "gpu-0.pad.backedlab.testnet";
  const ticker = coin?.ticker ?? "GPU";
  const page = `${origin}/c/${encodeURIComponent(id)}`;
  const post = `$${ticker} has a floor: every token is backed by a basket of real assets on NEAR. ${page}`;
  return (
    <section aria-labelledby="x-h" className="scroll-mt-20">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)] items-center gap-12 px-5 py-16 lg:grid-cols-[minmax(0,1fr)_480px] lg:px-8 lg:py-24">
        <div className="min-w-0">
          <h2 id="x-h" className="meme max-w-[14ch] text-[clamp(2rem,1.4rem+2vw,3rem)]">
            Buy it inside a post on X
          </h2>
          <ol className="mt-8 space-y-5">
            {["Paste a coin link on X.", "The card shows the price, the floor and what backs it.", "Tap Buy without leaving X."].map((t, i) => (
              <li key={t} className="flex items-center gap-4 text-[17px]">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <a href={`https://x.com/intent/post?text=${encodeURIComponent(post)}`} target="_blank" rel="noreferrer" className="btn btn-ink btn-lg mt-8">
            Post on X
          </a>
          <p className="caption mt-3">The card is live: it reads the coin from {NET.chain}. The frame around it is ours, a preview of how a post looks.</p>
        </div>
        <figure className="mx-auto w-full max-w-[480px] rounded-[28px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-20px_rgba(0,0,0,0.18)] sm:p-5">
          <figcaption className="flex items-center gap-3 px-1">
            <Mark size={36} />
            <span className="min-w-0">
              <span className="block text-[15px] font-bold leading-tight">{BRAND.name}</span>
              <span className="block text-[13px] text-muted">Preview of a post · ${ticker}</span>
            </span>
          </figcaption>
          <p className="mt-3 px-1 text-[15px] leading-snug">${ticker} has a floor. Every token is backed by a basket of real assets.</p>
          <div className="mt-3 overflow-hidden rounded-[18px] border border-line">
            {origin ? (
              <iframe src={`/x/${encodeURIComponent(id)}`} title={`$${ticker} card, as it appears in a post on X`} className="block aspect-square w-full border-0" loading="lazy" />
            ) : (
              <Skeleton className="aspect-square w-full rounded-none" />
            )}
          </div>
        </figure>
      </div>
    </section>
  );
}
