"use client";

import { toNumber, type AuctionView, type BasketEntry, type CoinConfig, type Tombstone } from "@backed/client";
import Link from "next/link";
import { NET, tokenInfo } from "@/lib/config";
import { getReader } from "@/lib/data";
import { usePoll } from "@/lib/hooks";
import { fmtQty } from "@/lib/money";
import { inferReplacement } from "@/lib/graves";
import { displayName, isTestTrader } from "@/lib/avatar";
import { Avatar } from "./coin-bits";
import { IconArrowRight, IconSwap, IconTomb } from "./icons";
import { Empty, ErrorNote, PageHead, Skeleton } from "./ui";
import { TokenIcon } from "./token-icon";

type Grave = Tombstone & { coin: string; ticker: string; replacement: string | null };
type Burying = AuctionView & { coin: string; ticker: string };


async function load() {
  const r = getReader();
  const coins = await r.listAllCoins();
  const per = await Promise.all(
    coins.map(async (info) => {
      const c = r.coin(info.account_id);
      const [tombs, basket, auction, config] = await Promise.all([
        c.getTombstones(0, 100).catch(() => [] as Tombstone[]),
        c.getBasket().catch(() => [] as BasketEntry[]),
        c.getAuction().catch(() => null),
        c.getConfig().catch(() => null as CoinConfig | null),
      ]);
      const ticker = config?.ticker ?? info.ticker;
      return {
        graves: tombs.map((t) => ({ ...t, coin: info.account_id, ticker, replacement: inferReplacement(t, basket, tombs) })),
        burying: auction ? [{ ...auction, coin: info.account_id, ticker }] : [],
      };
    }),
  );
  const graves: Grave[] = per.flatMap((p) => p.graves).sort((a, b) => b.ts_ms - a.ts_ms);
  const burying: Burying[] = per.flatMap((p) => p.burying);
  const board = new Map<string, number>();
  for (const g of graves) board.set(g.challenger, (board.get(g.challenger) ?? 0) + 1);
  return { graves, burying, board: [...board.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10) };
}

function humanRate(rate: string, target: string, replacement: string | null): string | null {
  if (!replacement) return null;
  const t = tokenInfo(target);
  const r = tokenInfo(replacement);
  const v = (toNumber(rate, 18) * 10 ** t.decimals) / 10 ** r.decimals;
  return `${fmtQty(v)} ${r.symbol} per ${t.symbol}`;
}

export function Graveyard() {
  const q = usePoll(load, [], 30_000);
  const d = q.data;
  return (
    <div className="space-y-8">
      <PageHead title="Graveyard">
        Every asset holders voted out of a basket, across all coins. Each one lost a challenge, and the coin sold it in an auction for the asset that won.
        {d && (
          <span className="caption mt-2 block">
            <span className="num font-semibold text-ink">{d.graves.length}</span> voted out · <span className="num font-semibold text-ink">{d.burying.length}</span>{" "}
            auctions live · <span className="num font-semibold text-ink">{d.board.length}</span> winning challengers
          </span>
        )}
      </PageHead>
      {q.error && !d && <ErrorNote error={q.error} />}
      {!d ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0 space-y-8">
            {d.burying.length > 0 && (
              <section aria-labelledby="burying-h">
                <h2 id="burying-h" className="text-xl font-bold tracking-[-0.02em]">
                  Being swapped out now
                </h2>
                <ul className="card mt-3 divide-y divide-line">
                  {d.burying.map((a) => {
                    const left = Number((BigInt(a.target_left) * 1000n) / (BigInt(a.target_total) || 1n)) / 10;
                    const t = tokenInfo(a.target).symbol;
                    const r = tokenInfo(a.replacement).symbol;
                    return (
                      <li key={`${a.coin}-${a.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                        <div>
                          <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
                            <TokenIcon symbol={t} size={18} chain />
                            {t} <IconSwap className="text-muted" /> <TokenIcon symbol={r} size={18} chain />
                            {r}
                            <span className="text-sm font-normal text-ink-2">
                              in{" "}
                              <Link href={`/c/${a.coin}`} className="font-semibold text-ink hover:underline">
                                ${a.ticker}
                              </Link>
                            </span>
                          </p>
                          <p className="caption mt-1">
                            {left}% of the {t} still to sell. Won by {displayName(a.challenger)}.
                          </p>
                        </div>
                        <Link href={`/c/${a.coin}`} className="btn btn-ink btn-sm self-start sm:self-auto">
                          Fill the auction
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section aria-labelledby="graves-h">
              <h2 id="graves-h" className="text-xl font-bold tracking-[-0.02em]">
                Voted out
              </h2>
              {d.graves.length === 0 ? (
                <div className="card mt-3">
                  <Empty title="No asset has been voted out yet">When a challenge wins and its auction fills, the removed asset shows up here.</Empty>
                </div>
              ) : (
                <ul className="card mt-3 divide-y divide-line" data-testid="tombstones">
                  {d.graves.map((g) => {
                    const sym = tokenInfo(g.token_id).symbol;
                    const rep = g.replacement ? tokenInfo(g.replacement).symbol : null;
                    const rate = humanRate(g.rate, g.token_id, g.replacement);
                    return (
                      <li key={`${g.coin}-${g.token_id}-${g.removed_epoch}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5">
                        <span className="relative flex size-12 items-center justify-center rounded-full bg-sunk text-ink-2" aria-hidden>
                          <IconTomb size={22} />
                          <TokenIcon symbol={sym} size={18} chain className="absolute bottom-1 right-1 ring-2 ring-card" />
                        </span>
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-lg font-bold tracking-[-0.02em] text-ink-2 line-through decoration-2">{sym}</span>
                            {rep && (
                              <span className="inline-flex items-center gap-1.5 text-lg font-bold">
                                <IconArrowRight className="self-center text-muted" />
                                <TokenIcon symbol={rep} size={16} chain className="self-center" />
                                {rep}
                              </span>
                            )}
                            <span className="text-sm text-ink-2">
                              in{" "}
                              <Link href={`/c/${g.coin}`} className="font-semibold text-ink hover:underline">
                                ${g.ticker}
                              </Link>
                            </span>
                          </p>
                          <p className="caption mt-0.5">
                            {rep ? <>replaced by {rep} · </> : null}challenged by {displayName(g.challenger)}
                            {rate && <> · sold at {rate}</>}
                          </p>
                        </div>
                        <p className="caption col-start-2 text-xs sm:col-start-3 sm:text-right">
                          <span className="num">
                            held rounds {g.joined_epoch}–{g.removed_epoch}
                          </span>
                          <br className="hidden sm:block" />
                          <span className="sm:hidden"> · </span>
                          {new Date(g.ts_ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section aria-labelledby="board-h" className="card p-5 lg:sticky lg:top-24">
            <h2 id="board-h" className="h2">
              Winning challengers
            </h2>
            <p className="caption mt-0.5">Who has voted the most assets out. {NET.testTokens ? "Test traders are our own test accounts." : ""}</p>
            {d.board.length === 0 ? (
              <Empty title="No winners yet" />
            ) : (
              <ol className="mt-3 divide-y divide-line">
                {d.board.map(([who, n], i) => (
                  <li key={who} className="flex items-center gap-3 py-2.5">
                    <span className="num w-4 text-right text-sm text-muted">{i + 1}</span>
                    <Avatar account={who} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold" title={who}>
                        {displayName(who)}
                      </span>
                      {isTestTrader(who) && <span className="rounded-full bg-sunk px-2 py-px text-[11px] font-semibold text-ink-2">test trader</span>}
                    </span>
                    <span className="num text-sm font-semibold">
                      {n} seat{n > 1 ? "s" : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
