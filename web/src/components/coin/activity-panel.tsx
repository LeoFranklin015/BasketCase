"use client";

import { formatTokens, toNumber } from "@backed/client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { displayName, isTestTrader } from "@/lib/avatar";
import { EXPLORER_ACCOUNT, NET, tokenInfo } from "@/lib/config";
import { getReader } from "@/lib/data";
import { useNow, usePoll } from "@/lib/hooks";
import { assetAmount, buFloatUsd, type PriceUnit, usd } from "@/lib/money";
import { useWallet } from "@/lib/wallet";
import { CurveChart } from "../charts/curve-chart";
import { Avatar } from "../coin-bits";
import { FeedRow, useArrivals, type FeedItem } from "../feed";
import { IconAnchor } from "../icons";
import { Card, ChipTabs, Empty, Skeleton, cx } from "../ui";
import { useCoin, useMarket } from "./context";
import { CrossChainPanel } from "./crosschain-panel";
import { TokenIcon } from "../token-icon";

/** Every buy, sell and burn on this coin as a social feed, newest first. */
export function LiveFeedPanel({ limit = 10 }: { limit?: number }) {
  const [all, setAll] = useState(false);
  const { trades } = useMarket();
  return (
    <Card
      title="Live trades"
      id="feed-h"
      caption={NET.testTokens ? "Straight from the chain. Accounts tagged test trader are our own, running the demo." : "Straight from the chain."}
      aside={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-xs font-semibold text-ink-2">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-up" />
          live
        </span>
      }
    >
      <TradesFeed limit={all ? 80 : limit} />
      {!all && trades.length > limit && (
        <button type="button" className="btn btn-quiet btn-sm mt-2 w-full" onClick={() => setAll(true)}>
          Show more trades
        </button>
      )}
    </Card>
  );
}

export function TradesFeed({ limit = 80 }: { limit?: number }) {
  const { snap, bu, history } = useCoin();
  const { trades } = useMarket();
  const now = useNow(5_000);
  const { accountId } = useWallet();
  const items = useMemo<FeedItem[]>(
    () =>
      trades.slice(0, limit).map((t, i) => ({
        key: `${t.ts}-${t.seq}-${t.kind}-${i}`,
        trade: t,
        usd: t.kind === "fill" ? null : buFloatUsd(t.bu, bu.e6),
        ticker: snap.config.ticker,
      })),
    [trades, limit, bu.e6, snap.config.ticker],
  );
  const fresh = useArrivals(items.map((i) => i.key));
  if (!history?.data && !history?.error) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading trades">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (trades.length === 0) {
    return <Empty title="No trades yet">{history?.error ? `History is unavailable: ${history.error.message}` : "Buys, sells and burns show up here as they land on chain."}</Empty>;
  }
  return (
    <ul className="-mx-2" data-testid="trades-feed">
      {items.map((it) => (
        <FeedRow key={it.key} item={it} now={now} you={accountId} fresh={fresh.has(it.key)} />
      ))}
    </ul>
  );
}

type Tab = "holders" | "basket" | "pro" | "chains" | "removed";

/** The rest: holders, the basket in detail, the bonding curve, other chains, voted-out assets. */
export function MorePanel() {
  const { snap } = useCoin();
  const [tab, setTab] = useState<Tab>("holders");
  const options: { id: Tab; label: string }[] = [
    { id: "holders", label: "Holders" },
    { id: "basket", label: "Basket details" },
    { id: "pro", label: "Pro: bonding curve" },
    { id: "chains", label: "Pay from any chain" },
  ];
  if (snap.tombstones.length) options.push({ id: "removed", label: `Voted out (${snap.tombstones.length})` });
  return (
    <section id="more" className="card min-w-0 scroll-mt-24 p-4 sm:p-6" aria-label="More about this coin">
      <ChipTabs label="More about this coin" value={tab} onChange={setTab} options={options} />
      <div className="mt-4">
        {tab === "holders" && <Holders />}
        {tab === "basket" && <BasketDetail />}
        {tab === "pro" && <ProCurve />}
        {tab === "chains" && <CrossChainPanel bare />}
        {tab === "removed" && <Removed />}
      </div>
    </section>
  );
}

/** Balances read from the contract for every account seen trading, plus the creator and you. */
function Holders() {
  const { snap, bu } = useCoin();
  const { trades, loaded } = useMarket();
  const { accountId } = useWallet();
  const accounts = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) if (t.account && t.account !== "fair launch" && t.account !== "pool") set.add(t.account);
    set.add(snap.config.creator);
    if (accountId) set.add(accountId);
    if (snap.state.mode === "index") set.add(snap.id);
    return [...set].slice(0, 40);
  }, [trades, snap.config.creator, snap.id, snap.state.mode, accountId]);

  const q = usePoll(
    async () => {
      const c = getReader().coin(snap.id);
      let failed = 0;
      const bals = await Promise.all(
        accounts.map((a) =>
          c.ftBalanceOf(a).catch(() => {
            failed++;
            return "0";
          }),
        ),
      );
      // Every read failing means the RPC is down, not that nobody holds: say so instead of "no holders".
      if (accounts.length > 0 && failed === accounts.length) throw new Error("Couldn't read balances from NEAR right now; retrying shortly.");
      const held = accounts.map((a, i) => ({ account: a, balance: bals[i]! })).filter((h) => BigInt(h.balance) > 0n);
      // Some reads failed and none of the rest hold: we don't know that nobody holds.
      if (held.length === 0 && failed > 0) throw new Error("Couldn't read every balance from NEAR right now; retrying shortly.");
      return held;
    },
    // Balances move slowly; re-read them once a minute, not on every 10 s snapshot.
    [snap.id, accounts.join(","), Math.floor(snap.loadedAt / 60_000)],
    0,
  );

  if (!loaded || (!q.data && !q.error)) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading holders">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  const list = [...(q.data ?? [])].sort((a, b) => {
    const x = BigInt(a.balance);
    const y = BigInt(b.balance);
    return x === y ? 0 : y > x ? 1 : -1;
  });
  const supply = toNumber(snap.state.supply, 18);
  const floor = toNumber(snap.state.floor, 18);
  if (list.length === 0) return q.error ? <Empty title="Holders unavailable">{q.error.message}</Empty> : <Empty title="No holders yet" />;
  return (
    <>
      <ul className="divide-y divide-line">
        {list.map((h, i) => {
          const n = toNumber(h.balance, 18);
          const share = supply > 0 ? n / supply : 0;
          const tag = h.account === snap.id ? "pool" : h.account === accountId ? "you" : h.account === snap.config.creator ? "creator" : isTestTrader(h.account) ? "test trader" : null;
          return (
            <li key={h.account} className="flex items-center gap-3 py-2.5">
              <span className="num w-5 shrink-0 text-right text-sm text-muted">{i + 1}</span>
              <Avatar account={h.account} size={32} />
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <a href={EXPLORER_ACCOUNT(h.account)} target="_blank" rel="noreferrer" className="max-w-full truncate font-semibold hover:underline" title={h.account}>
                    {displayName(h.account)}
                  </a>
                  {tag && <span className="shrink-0 rounded-full bg-sunk px-2 py-px text-[11px] font-semibold text-ink-2">{tag}</span>}
                </p>
                <span className="mt-1 flex items-center gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-sunk sm:block">
                    <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </span>
                  <span className="num caption text-xs">{(share * 100).toFixed(1)}% of tokens</span>
                </span>
              </div>
              <div className="shrink-0 text-right">
                <p className="num text-sm font-semibold">{formatTokens(h.balance)}</p>
                <p className="num caption text-xs">floor pays {usd(buFloatUsd(n * floor, bu.e6))}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="caption mt-3 text-xs">
        Accounts seen in this coin&apos;s trades, with balances read from the contract. Tokens received by transfer from someone who never traded aren&apos;t listed.
      </p>
    </>
  );
}

export function BasketDetail() {
  const { snap, rows, bu } = useCoin();
  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">Vault composition</h3>
        <span className="num caption">
          {usd(total)} · 1 BU = {usd(bu.e6 / 1e6)}
        </span>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.token_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 py-3">
            <span className="flex min-w-0 items-center gap-2">
              <TokenIcon symbol={r.symbol} size={18} chain />
              <span className="font-semibold">{r.symbol}</span>
              {!r.known && (
                <span className="rounded-full bg-down-soft px-2 text-[11px] font-semibold text-down" title="Not on the known token list">
                  unverified
                </span>
              )}
              <span className="caption truncate text-xs">
                {snap.auction?.target === r.token_id ? (
                  "being swapped out"
                ) : snap.auction?.replacement === r.token_id ? (
                  "joining"
                ) : r.anchored ? (
                  <span className="inline-flex items-center gap-1">
                    <IconAnchor size={12} /> anchored
                  </span>
                ) : (
                  `seat open since round ${r.joined_epoch}`
                )}
              </span>
            </span>
            <span className="num text-right font-semibold">{r.usd === null ? <span className="text-muted">no price</span> : usd(r.usd)}</span>
            <span className="caption num pl-5 text-xs">
              holds {assetAmount(r.token_id, r.held)} · {assetAmount(r.token_id, r.q)} per BU
            </span>
            <span className="num caption text-right text-xs">{r.share === null ? "–" : `${(r.share * 100).toFixed(1)}%`}</span>
            <span className="mono col-span-2 truncate pl-5 text-[11px] text-muted">{r.token_id}</span>
          </li>
        ))}
      </ul>
      <p className="caption mt-3 text-xs">
        Values use {NET.swapRoute === "oneclick" ? "1Click" : `the ${NET.label.toLowerCase()} swapper`}&apos;s prices. A buy sends &ldquo;per BU&rdquo; of each asset for every basket unit; a sell pays a pro-rata share of what is held.
        Anchored seats can&apos;t be challenged.
      </p>
    </div>
  );
}

/** The bonding curve, for those who want the mechanism: the floor is the yellow block under it. */
function ProCurve() {
  const { snap, bu, preview } = useCoin();
  const [unit, setUnit] = useState<PriceUnit>("usd");
  const st = snap.state;
  const curve = { x0: toNumber(snap.config.x0, 18), y0: toNumber(snap.config.y0, 18), grad: toNumber(snap.config.grad_reserve, 18) };
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="caption max-w-xl">
          The price of the next token is set by this curve: it climbs as tokens are sold, until graduation. The yellow block is the floor; it rises with fees
          and burns. Type an amount in the buy card to see where it lands.
        </p>
        <div className="switch" role="group" aria-label="Curve unit">
          <button type="button" aria-pressed={unit === "usd"} onClick={() => setUnit("usd")}>
            USD
          </button>
          <button type="button" aria-pressed={unit === "bu"} onClick={() => setUnit("bu")}>
            BU
          </button>
        </div>
      </div>
      <div className="mt-3">
        <CurveChart
          curve={curve}
          sold={toNumber(st.sold, 18)}
          s={toNumber(st.surplus_per_token, 18)}
          floor={toNumber(st.floor, 18)}
          graduated={st.mode === "index"}
          unit={unit}
          buE6={bu.e6}
          previewNet={preview}
          height={340}
        />
      </div>
      <p className={cx("caption num mt-2 text-xs")}>
        x0 {fmtN(curve.x0)} BU · y0 {fmtN(curve.y0)} tokens · graduates at {fmtN(curve.grad)} BU in the curve
      </p>
    </div>
  );
}

const fmtN = (n: number) => new Intl.NumberFormat("en-US", { notation: n >= 1e6 ? "compact" : "standard", maximumFractionDigits: 3 }).format(n);

function Removed() {
  const { snap } = useCoin();
  return (
    <div>
      <ul className="divide-y divide-line">
        {snap.tombstones.map((t) => {
          const sym = tokenInfo(t.token_id).symbol;
          return (
            <li key={`${t.token_id}-${t.removed_epoch}`} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2">
                <TokenIcon symbol={sym} size={18} chain />
                <span className="font-semibold">{sym}</span>
                <span className="caption text-xs">
                  held rounds {t.joined_epoch}–{t.removed_epoch}
                </span>
              </span>
              <span className="caption text-right text-xs">
                challenged by {displayName(t.challenger)} · {new Date(t.ts_ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="caption mt-3 text-xs">
        Every coin&apos;s voted-out assets are in the{" "}
        <Link href="/graveyard" className="link">
          graveyard
        </Link>
        .
      </p>
    </div>
  );
}
