"use client";

import { graduationProgress, toNumber, type CoinMode } from "@backed/client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { backedByLabel, backing } from "@/lib/backing";
import { getReader, loadSummary, type CoinSummary } from "@/lib/data";
import { changeLabel, changeOver, sparkPoints, type Trade } from "@/lib/history";
import { fetchHistory } from "./coin/context";
import { useNow, usePoll } from "@/lib/hooks";
import { basketRows, buFloatUsd, buToUsdN, buUsdE6, priceToUsd, priceUnit, usd, type BasketRow } from "@/lib/money";
import { NET } from "@/lib/config";
import { OTHER_NETWORK_URL } from "@/lib/network";
import { GUEST_ENABLED, useWallet } from "@/lib/wallet";
import { TryFreeButton } from "./wallet-button";
import { Sparkline } from "./charts/sparkline";
import { CoinTile, TileSkeleton, ourAccount, type TileCoin } from "./coin-tile";
import { MemeCookingStrip } from "./memecooking-strip";
import { Monogram } from "./coin-bits";
import { useArrivals } from "./feed";
import { IconArrowRight } from "./icons";
import { TokenIcon } from "./token-icon";
import { originChain } from "@/lib/icons";
import { displayName, isTestTrader } from "@/lib/avatar";
import { Change, Empty, ErrorNote, Money, Skeleton, STAGES, cx, timeAgo } from "./ui";

type Filter = "all" | CoinMode;
type SortKey = "trending" | "mcap" | "change" | "backed" | "volume" | "age" | "progress";
type Tab = "trending" | "new" | "soon" | "graduated";
type Backing = "near-memes" | "solana" | "ethereum" | "bitcoin";

type Market = {
  s: CoinSummary;
  rows: BasketRow[];
  buE6: number;
  priceUsd: number;
  floorUsd: number;
  mcapUsd: number;
  backedUsd: number;
  share: number;
  backedBy: string;
  vaultUsd: number;
  change: number | null;
  changeWhen: string;
  volumeUsd: number | null;
  spark: { price: { t: number; p: number }[]; floor: { t: number; p: number }[] } | null;
  progress: number | null;
  trades24h: number;
  tile: TileCoin;
};

/** Trades per coin, fetched once the coin list is known and refreshed every 30 s. */
function useHistories(ids: string[]) {
  const [map, setMap] = useState<Record<string, Trade[] | null>>({});
  const [complete, setComplete] = useState<Record<string, boolean>>({});
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    const run = () =>
      ids.forEach((id) =>
        fetchHistory(id)
          .then((h) => {
            if (!alive) return;
            setMap((m) => ({ ...m, [id]: h.trades }));
            setComplete((c) => ({ ...c, [id]: h.complete }));
          })
          .catch(() => alive && setMap((m) => ({ ...m, [id]: m[id] ?? null }))),
      );
    run();
    const t = setInterval(run, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { histories: map, complete };
}

export function Explore() {
  const reader = getReader();
  const coins = usePoll(async () => {
    const [infos, prices] = await Promise.all([reader.listAllCoins(), reader.swapper.getPrices().catch(() => [] as [string, string][])]);
    const summaries = await Promise.all(infos.map((i) => loadSummary(reader, i).catch(() => null)));
    // Coins exist but none could be read: the RPC is failing, which is not the same as "no coins".
    if (infos.length > 0 && summaries.every((x) => x === null)) throw new Error("Couldn't read the coins from NEAR right now. Retrying every 15 seconds.");
    return { list: summaries.filter((s): s is CoinSummary => s !== null), prices: Object.fromEntries(prices), at: Date.now() };
  }, [], 15_000);
  const ids = (coins.data?.list ?? []).map((c) => c.info.account_id);
  // Assets voted out across every coin: a nice-to-have, read once a minute.
  const graves = usePoll(
    async () => {
      const n = await Promise.all(ids.map((id) => reader.coin(id).getTombstones(0, 100).then((t) => t.length).catch(() => null)));
      return n.every((x) => x === null) ? null : n.reduce<number>((a, x) => a + (x ?? 0), 0);
    },
    [ids.join(",")],
    60_000,
  );
  const [tab, setTab] = useState<Tab>("trending");
  const [filter, setFilter] = useState<Filter>("all");
  const [backer, setBacker] = useState<Backing | null>(null);
  const [sort, setSort] = useState<SortKey>("trending");
  const { histories, complete } = useHistories(ids);
  const now = useNow(30_000);

  const markets = useMemo<Market[]>(() => {
    if (!coins.data) return [];
    const at = coins.data.at;
    return coins.data.list.map((s) => {
      const bu = buUsdE6(s.config, s.basket, coins.data!.prices).e6;
      const p = toNumber(s.state.price, 18);
      const trades = histories[s.info.account_id];
      const chg = trades ? changeOver(trades, at, p, undefined, complete[s.info.account_id] ?? false) : null;
      const day = trades ? trades.filter((t) => t.ts > at - 86_400_000 && (t.kind === "buy" || t.kind === "sell")) : null;
      const vol = day ? day.reduce((a, t) => a + t.bu, 0) : null;
      // Sparkline over the coin's last day, or its whole life if it is younger.
      const first = trades?.at(-1)?.ts;
      const windowMs = first ? Math.max(3_600_000, Math.min(86_400_000, at - first)) : 86_400_000;
      const priceUsd = priceToUsd(s.state.price, bu);
      const floorUsd = priceToUsd(s.state.floor, bu);
      const b = backing({ priceUsd, floorUsd, circulating: toNumber(s.state.circulating, 18) });
      const rows = basketRows(s.basket, coins.data!.prices);
      const spark = trades
        ? {
            price: sparkPoints(trades, at, windowMs, 40),
            floor: sparkPoints(
              trades.map((t) => ({ ...t, price: t.floor })),
              at,
              windowMs,
              40,
            ),
          }
        : null;
      const progress = s.state.mode === "curve" ? graduationProgress(s.state, s.config.grad_reserve) : null;
      const m = {
        s,
        rows,
        buE6: bu,
        priceUsd,
        floorUsd,
        mcapUsd: b.mcapUsd,
        backedUsd: b.backedUsd,
        share: b.share,
        backedBy: backedByLabel(rows),
        vaultUsd: buToUsdN(s.state.b_total, bu),
        change: chg?.pct ?? null,
        changeWhen: changeLabel(chg, at),
        volumeUsd: vol === null ? null : buFloatUsd(vol, bu),
        spark,
        progress,
        trades24h: day?.length ?? 0,
      };
      const tile: TileCoin = {
        id: s.info.account_id,
        ticker: s.config.ticker,
        name: s.config.name,
        icon: s.config.icon ?? null,
        mode: s.state.mode,
        mcapUsd: m.mcapUsd,
        backedUsd: m.backedUsd,
        share: m.share,
        symbols: rows.map((r) => r.symbol),
        change: m.change,
        changeWhen: m.changeWhen,
        spark,
        progress,
        createdMs: s.info.created_ms,
        creator: s.info.creator,
      };
      return { ...m, tile };
    });
  }, [coins.data, histories, complete]);

  const shown = useMemo(() => {
    const val = (m: Market): number => {
      switch (sort) {
        case "trending":
          return (m.volumeUsd ?? 0) * 1000 + (m.change ?? 0);
        case "mcap":
          return m.mcapUsd;
        case "change":
          return m.change ?? -Infinity;
        case "backed":
          return m.share;
        case "volume":
          return m.volumeUsd ?? -1;
        case "age":
          return m.s.info.created_ms;
        case "progress":
          return m.progress ?? (m.s.state.mode === "index" ? -1 : -2);
      }
    };
    let list = markets;
    if (tab === "graduated") list = list.filter((m) => m.s.state.mode === "index");
    else if (filter !== "all") list = list.filter((m) => m.s.state.mode === filter);
    if (backer) list = list.filter((m) => backedFrom(m.rows.map((r) => r.symbol), backer));
    return [...list].sort((a, b) => val(b) - val(a) || a.s.config.ticker.localeCompare(b.s.config.ticker));
  }, [markets, filter, sort, tab, backer]);

  const totals = useMemo(() => {
    const vols = markets.map((m) => m.volumeUsd);
    return {
      coins: markets.length,
      vault: markets.reduce((a, m) => a + m.vaultUsd, 0),
      trades: markets.reduce((a, m) => a + m.trades24h, 0),
      volume: vols.every((v) => v !== null) ? vols.reduce((a: number, v) => a + (v ?? 0), 0) : null,
    };
  }, [markets]);
  // King of the hill: the coin closest to graduating (or the biggest, if none is on the curve).
  const king = useMemo(() => {
    const onCurve = markets.filter((m) => m.progress !== null);
    const pool = onCurve.length ? onCurve : markets;
    return [...pool].sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0) || b.mcapUsd - a.mcapUsd)[0] ?? null;
  }, [markets]);

  const loading = coins.loading && !coins.data;
  const { accountId } = useWallet();
  const pickTab = (t: Tab) => {
    setTab(t);
    setSort(t === "new" ? "age" : t === "soon" ? "progress" : t === "graduated" ? "mcap" : "trending");
    if (t === "graduated") setFilter("all");
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="meme text-[2.25rem] sm:text-[3rem]">Coins with a floor</h1>
          <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[15px]" aria-busy={loading || undefined}>
            <Stat v={loading ? null : String(totals.coins)} k="coins live" />
            <Stat v={loading ? null : usd(totals.vault)} k="in vaults" />
            <Stat v={loading ? null : String(totals.trades)} k="trades in 24h" />
            {graves.data !== null && graves.data !== undefined && <Stat v={String(graves.data)} k="voted out" />}
          </p>
          <p className="caption mt-2 text-xs">{NET.chain}{NET.testTokens ? ", test tokens only. Most trades come from our own test traders." : "."}</p>
        </div>
        <div className={cx("flex shrink-0 flex-wrap items-start gap-2", !(GUEST_ENABLED && !accountId) && "max-sm:hidden")}>
          <TryFreeButton />
          <Link href="/launch" className={cx("btn shrink-0 max-sm:hidden", GUEST_ENABLED && !accountId ? "btn-quiet" : "btn-ink")}>
            Launch a coin
            <IconArrowRight />
          </Link>
        </div>
      </section>

      {king && <KingOfTheHill m={king} />}
      <MemeCookingStrip />
      {loading && <Skeleton className="h-56 rounded-[24px]" />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0" aria-labelledby="markets-h">
          <h2 id="markets-h" className="sr-only">
            All coins
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="switch max-w-full overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Board">
              {(
                [
                  ["trending", "Trending"],
                  ["new", "New"],
                  ["soon", "About to graduate"],
                  ["graduated", "Graduated"],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={tab === id} onClick={() => pickTab(id)} className="shrink-0">
                  {label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="caption">Sort</span>
              <select className="field h-9 min-h-0 w-auto rounded-full py-0 pr-9 text-sm font-semibold" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort coins">
                <option value="trending">Trending</option>
                <option value="age">Newest</option>
                <option value="progress">Closest to graduating</option>
                <option value="mcap">Biggest</option>
                <option value="change">Hot today</option>
                <option value="backed">Most backed</option>
                <option value="volume">Most traded</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]" role="group" aria-label="Filter coins by stage">
              {(["all", ...STAGES.filter((x) => x.mode !== "index").map((x) => x.mode)] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className="chip shrink-0"
                  aria-pressed={tab !== "graduated" && filter === f}
                  onClick={() => {
                    if (tab === "graduated") pickTab("trending");
                    setFilter(f);
                  }}
                >
                  {f === "all" ? "All stages" : STAGES.find((x) => x.mode === f)!.label}
                </button>
              ))}
            </div>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]" role="group" aria-label="Filter coins by what backs them">
              {BACKINGS.map((b) => (
                <button key={b.id} type="button" className="chip shrink-0 pl-1.5" aria-pressed={backer === b.id} onClick={() => setBacker(backer === b.id ? null : b.id)}>
                  <TokenIcon symbol={b.icon} size={22} />
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {coins.error && !coins.data && (
            <div className="mt-4">
              <ErrorNote error={coins.error} />
            </div>
          )}
          {loading ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading coins">
              {[0, 1, 2, 3].map((i) => (
                <TileSkeleton key={i} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="card mt-5">
              {markets.length ? (
                <Empty title="No coins match">Try another tab or filter, or show them all.</Empty>
              ) : (
                <Empty
                  title={`No coins on ${NET.chain} yet`}
                  action={
                    <>
                      <Link href="/launch" className="btn btn-ink btn-sm">
                        Launch the first one
                      </Link>
                      {OTHER_NETWORK_URL && NET.id === "mainnet" && (
                        <a href={OTHER_NETWORK_URL} className="btn btn-quiet btn-sm">
                          See the coins on testnet
                        </a>
                      )}
                    </>
                  }
                >
                  Every coin launched here shows up on this board with its floor, its basket and the last day of trading.
                </Empty>
              )}
            </div>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="coin-list">
              {shown.map((m) => (
                <li key={m.s.info.account_id} className="min-w-0">
                  <CoinTile c={m.tile} now={now} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="min-w-0" aria-labelledby="feed-h">
          <div className="xl:sticky xl:top-24">
            <GlobalFeed markets={markets} histories={histories} ready={!!coins.data} />
          </div>
        </aside>
      </div>
    </div>
  );
}

const BACKINGS: { id: Backing; label: string; icon: string }[] = [
  { id: "near-memes", label: "NEAR memes", icon: "BLACKDRAGON" },
  { id: "solana", label: "Solana", icon: "SOL" },
  { id: "ethereum", label: "Ethereum", icon: "ETH" },
  { id: "bitcoin", label: "Bitcoin", icon: "BTC" },
];
const NEAR_MEMES = new Set(["BLACKDRAGON", "SHITZU", "JAMBO"]);

/** Does this basket hold anything from that corner of crypto? */
function backedFrom(symbols: string[], b: Backing): boolean {
  if (b === "near-memes") return symbols.some((s) => NEAR_MEMES.has(s.toUpperCase()));
  return symbols.some((s) => originChain(s) === b);
}

function Stat({ v, k }: { v: string | null; k: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="num font-semibold text-ink">{v ?? <span aria-hidden className="inline-block h-4 w-10 animate-pulse rounded-full bg-pill align-middle" />}</span>
      <span className="label">{k}</span>
    </span>
  );
}

/** The coin closest to graduating, made big. */
function KingOfTheHill({ m }: { m: Market }) {
  const c = m.s.config;
  const pct = Math.round(m.share * 100);
  const prog = m.progress;
  return (
    <section aria-label="King of the hill" className="card relative isolate overflow-hidden p-6 sm:p-8">
      <div aria-hidden className="absolute inset-0 -z-10" style={{ background: `radial-gradient(60% 90% at 0% 0%, var(--glow), transparent 70%)` }} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-xs font-semibold text-white">King of the hill</span>
          <div className="mt-5 flex items-center gap-4">
            <Monogram ticker={c.ticker} icon={c.icon} size={72} />
            <div className="min-w-0">
              <p className="truncate text-[1.5rem] font-bold tracking-[-0.02em]">${c.ticker}</p>
              <p className="truncate text-sm text-muted">{c.name}</p>
            </div>
          </div>
          <p className="display mt-5 text-[2.75rem]">
            <Money text={usd(m.mcapUsd)} />
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
            <span className="caption">market cap</span>
            <Change pct={m.change} />
            <span className="caption">{m.changeWhen}</span>
          </p>
          <p className="mt-4 flex items-center gap-2 text-sm">
            <span className="flex -space-x-1.5">
              {m.rows.slice(0, 4).map((r) => (
                <TokenIcon key={r.token_id} symbol={r.symbol} size={24} chain className="rounded-full ring-2 ring-white" />
              ))}
            </span>
            <span>
              <span className="font-semibold">{pct}%</span> <span className="text-muted">backed by {m.backedBy}</span>
            </span>
          </p>
        </div>
        <div className="min-w-0">
          <div className="h-28">
            {m.spark ? <Sparkline price={m.spark.price} floor={m.spark.floor} width={480} height={112} fluid label={`$${c.ticker} price over the last day, with the floor`} /> : <Skeleton className="h-full" />}
          </div>
          {prog !== null ? (
            <>
              <p className="mt-5 text-[15px] text-muted">
                <span className="num font-semibold text-ink">{Math.round(prog * 100)}%</span> of the way to graduating
              </p>
              <span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-pill" aria-hidden>
                <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(2, prog * 100)}%` }} />
              </span>
            </>
          ) : (
            <p className="mt-5 text-[15px] text-muted">{m.s.state.mode === "index" ? "Graduated: each token is a share of the vault." : "In its fair launch."}</p>
          )}
          <Link href={`/c/${m.s.info.account_id}`} className="btn btn-ink btn-lg mt-6 w-full sm:w-auto">
            Buy ${c.ticker}
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Trades across every coin, newest first, as compact rows with the coin's avatar. */
function GlobalFeed({ markets, histories, ready }: { markets: Market[]; histories: Record<string, Trade[] | null>; ready: boolean }) {
  const now = useNow(5_000);
  const items = useMemo(() => {
    const all: { key: string; t: Trade; m: Market; usd: number | null }[] = [];
    for (const m of markets) {
      const trades = histories[m.s.info.account_id] ?? [];
      for (const [i, t] of trades.slice(0, 30).entries()) {
        if (t.kind === "graduate" || t.kind === "settle") continue;
        all.push({ key: `${m.s.info.account_id}-${t.ts}-${t.seq}-${i}`, t, m, usd: t.kind === "fill" ? null : buFloatUsd(t.bu, m.buE6) });
      }
    }
    return all.sort((a, b) => b.t.ts - a.t.ts || b.t.seq - a.t.seq).slice(0, 16);
  }, [markets, histories]);
  const fresh = useArrivals(items.map((i) => i.key));
  const loaded = ready && markets.every((m) => histories[m.s.info.account_id] !== undefined);
  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="feed-h" className="h2">
            Happening now
          </h2>
          <p className="caption mt-1">Trades on every coin.{NET.testTokens ? " Most come from our own test traders, tagged as such." : ""}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pill px-2.5 py-1 text-xs font-semibold">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-up-line" />
          live
        </span>
      </div>
      {!loaded && items.length === 0 ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Loading trades">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty title="No trades yet">The first buy on any coin lands here, live.</Empty>
      ) : (
        <ul className="-mx-2 mt-3" data-testid="global-feed">
          {items.map(({ key, t, m, usd: amount }) => {
            const test = isTestTrader(t.account);
            const verb = t.kind === "buy" ? "bought" : t.kind === "sell" ? "sold" : t.kind === "burn" ? "burned" : t.kind === "redeem" ? "redeemed" : "filled";
            return (
              <li key={key} className={cx("rounded-[14px]", fresh.has(key) && "row-in")}>
                <Link href={`/c/${m.s.info.account_id}`} className="flex items-center gap-3 rounded-[14px] px-2 py-2 hover:bg-[#f7f7f7]">
                  <Monogram ticker={m.s.config.ticker} icon={m.s.config.icon} size={34} />
                  <span className="min-w-0 flex-1 text-[13px] leading-snug">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold" title={t.account}>
                        {displayName(t.account || "pool")}
                      </span>
                      {test && <span className="shrink-0 rounded-full bg-pill px-1.5 py-px text-[10px] font-semibold text-ink-2">test trader</span>}
                    </span>
                    <span className="block truncate">
                      <span className={t.kind === "buy" ? "font-semibold text-up" : t.kind === "sell" ? "font-semibold text-down" : "text-muted"}>{verb}</span>
                      {amount !== null && <span className="num font-semibold"> {usd(amount)}</span>}
                      <span className="text-muted"> · ${m.s.config.ticker}</span>
                    </span>
                  </span>
                  <span className="num shrink-0 text-[12px] text-muted">{now ? `${timeAgo(t.ts, now)}` : ""}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
