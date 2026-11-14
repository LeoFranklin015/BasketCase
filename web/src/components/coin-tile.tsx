import type { CoinMode } from "@backed/client";
import Link from "next/link";
import { displayName, isTestTrader } from "@/lib/avatar";
import { rheaPoolUrl } from "@/lib/config";
import { usd } from "@/lib/money";
import { Sparkline } from "./charts/sparkline";
import { MiniFloorBar, Monogram } from "./coin-bits";
import { TokenIcon } from "./token-icon";
import { Change, Money, Skeleton, StageChip, cx, timeAgo } from "./ui";

type Pt = { t: number; p: number };

/** Everything a coin card shows, already in dollars. */
export type TileCoin = {
  id: string;
  ticker: string;
  name: string;
  icon: string | null;
  mode: CoinMode;
  mcapUsd: number;
  backedUsd: number;
  share: number;
  symbols: string[];
  /** Price change and its window ("in 24h", "since launch"); null while history loads. */
  change: number | null;
  changeWhen: string;
  spark: { price: Pt[]; floor: Pt[] } | null;
  /** 0..1 of the way to graduating, on the curve; null otherwise. */
  progress: number | null;
  createdMs: number;
  creator: string;
};

/** Accounts we run on testnet (the factory owner and the test traders); every place they appear says so. */
export function ourAccount(account: string): boolean {
  return isTestTrader(account) || /(^|\.)backedlab\.testnet$/.test(account);
}

/** A coin on the board: who it is, what it is worth, how it moved, how far to graduating, and what backs it. */
export function CoinTile({ c, now }: { c: TileCoin; now: number }) {
  const pct = Math.round(c.share * 100);
  const rhea = rheaPoolUrl(c.id);
  return (
    <div className="card group flex h-full min-w-0 flex-col p-5 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_16px_36px_-12px_rgba(0,0,0,0.14)]">
      <Link href={`/c/${c.id}`} className="block min-w-0">
      <div className="flex items-start gap-3">
        <Monogram ticker={c.ticker} icon={c.icon} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.0625rem] font-bold tracking-[-0.02em]" title={c.name}>
            ${c.ticker}
          </p>
          <p className="truncate text-[13px] text-muted">
            {c.name}
            {now > 0 && c.createdMs > 0 && <span> · {timeAgo(c.createdMs, now)} ago</span>}
          </p>
        </div>
        <div className="shrink-0 text-right" title={`Price change ${c.changeWhen}`}>
          <Change pct={c.change} className="text-[15px]" />
          <p className="label mt-0.5 text-[11px]">{c.changeWhen.replace(/^in /, "")}</p>
        </div>
      </div>

      <p className="display mt-4 text-[1.75rem]">
        <Money text={usd(c.mcapUsd)} />
      </p>
      <p className="caption">market cap</p>

      <div className="mt-3 h-14">
        {c.spark ? (
          <Sparkline price={c.spark.price} floor={c.spark.floor} width={300} height={56} fluid label={`$${c.ticker} price over the last day, with the floor`} />
        ) : (
          <Skeleton className="h-14 w-full" />
        )}
      </div>
      </Link>

      {/* Outside the card's link, so the Rhea chip can be its own link. */}
      <div className="mt-4">
        {c.mode === "index" ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-7 items-center rounded-full bg-ink px-3 text-xs font-semibold text-white">Graduated · index</span>
            {rhea && (
              <a href={rhea} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-pill px-2.5 text-xs font-semibold hover:bg-[var(--pill-hover)]" title={`$${c.ticker}'s pool on Rhea`}>
                <TokenIcon symbol="RHEA" size={14} />
                On Rhea
              </a>
            )}
          </span>
        ) : c.mode === "launch" ? (
          <StageChip mode={c.mode} />
        ) : (
          <>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-muted">
                <span className="num font-semibold text-ink">{Math.round((c.progress ?? 0) * 100)}%</span> of the way to graduating
              </span>
            </div>
            <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-pill" aria-hidden>
              <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(2, Math.min(100, (c.progress ?? 0) * 100))}%` }} />
            </span>
          </>
        )}
      </div>

      <Link href={`/c/${c.id}`} tabIndex={-1} className="mt-auto block pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold">{pct}% backed</span>
          <span className="flex -space-x-1.5" title={`backed by ${c.symbols.join(" + ")}`}>
            {c.symbols.slice(0, 4).map((s) => (
              <TokenIcon key={s} symbol={s} size={22} chain className="rounded-full ring-2 ring-white" />
            ))}
          </span>
        </div>
        <MiniFloorBar className="mt-2 h-1.5" share={c.share} label={`$${c.ticker}: ${usd(c.backedUsd)} of ${usd(c.mcapUsd)} backed`} />
        <p className="mt-3 truncate text-[12px] text-muted" title={c.creator}>
          by <span className="font-medium text-ink-2">{displayName(c.creator)}</span>
          {ourAccount(c.creator) && <span className="ml-1.5 rounded-full bg-pill px-1.5 py-px text-[11px] font-semibold text-ink-2">our account</span>}
        </p>
      </Link>
    </div>
  );
}

export function TileSkeleton() {
  return (
    <div className={cx("card p-5")} aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="mt-5 h-8 w-32" />
      <Skeleton className="mt-4 h-14" />
      <Skeleton className="mt-4 h-2" />
    </div>
  );
}
