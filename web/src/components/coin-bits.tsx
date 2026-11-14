import { formatTiny, toNumber } from "@backed/client";
import type { ReactNode } from "react";
import { assetColor, coinColor } from "@/lib/assets";
import { fill } from "@/lib/backing";
import { avatarSpec } from "@/lib/avatar";
import { usd } from "@/lib/money";
import { arcs, donutPath } from "@/lib/pie";
import { IconAnchor } from "./icons";
import { cx } from "./ui";
import { TokenIcon } from "./token-icon";

export { fill } from "@/lib/backing";

/**
 * The block every coin is drawn as: the solid yellow part is what the vault backs (floor x tokens
 * out there), the hatched rest is what the market pays above it.
 */
export function FloorBar({
  share,
  backedUsd,
  hypeUsd,
  backedBy,
  preview,
  size = "lg",
  className,
}: {
  share: number;
  backedUsd: number;
  hypeUsd: number;
  backedBy: string;
  /** A buy being typed: the backed total after it. */
  preview?: { backedUsd: number } | null;
  size?: "lg" | "md";
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, share)) * 100);
  const w = Math.max(0, Math.min(100, share * 100));
  const lg = size === "lg";
  return (
    <div className={className} data-testid="floor-bar">
      <div
        role="img"
        aria-label={`${usd(backedUsd)} backed by ${backedBy}, ${pct}% of the market cap. ${usd(hypeUsd)} above the floor.`}
        className={cx("relative flex w-full overflow-hidden rounded-full hatch ring-1 ring-line", lg ? "h-12 sm:h-14" : "h-9")}
      >
        <div className="anim-w absolute inset-0 bg-floor" style={fill(w)} />
        {/* The floor line: where backed ends and hype begins, as in the brand mark. */}
        {w > 0 && w < 100 && (
          <div aria-hidden className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-ink transition-[left] duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ left: `${w}%` }} />
        )}
        {/* "92% backed" sits in the yellow when it fits; on a thin share it rides just past the floor line on a card pill. */}
        {w >= 42 ? (
          <span className={cx("relative flex h-full items-center gap-1.5 pl-5 text-floor-ink", lg ? "text-[15px] sm:text-base" : "text-[13px]")}>
            <span className="display text-[1.35em] tracking-[-0.03em]">{pct}%</span>
            <span className="font-semibold">backed</span>
          </span>
        ) : (
          <span className="absolute inset-y-0 flex items-center pl-2.5" style={{ left: `${w}%` }}>
            <span className={cx("flex items-baseline gap-1 rounded-full bg-card px-2.5 py-0.5 text-ink ring-1 ring-line", lg ? "text-[14px]" : "text-[12px]")}>
              <span className="display text-[1.2em] tracking-[-0.03em]">{pct}%</span>
              <span className="font-semibold">backed</span>
            </span>
          </span>
        )}
        {100 - w >= 12 && w >= 42 && (
          <span className={cx("relative ml-auto flex h-full items-center pr-3 font-semibold text-ink-2", lg ? "text-[14px]" : "text-[12px]")}>
            <span className="rounded-full bg-card px-2 py-0.5">hype</span>
          </span>
        )}
        {w < 42 && (
          <span className={cx("absolute inset-y-0 right-0 flex items-center pr-3 font-semibold text-ink-2 max-sm:hidden", lg ? "text-[14px]" : "text-[12px]")}>
            <span className="rounded-full bg-card px-2 py-0.5">hype</span>
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="flex min-w-0 items-baseline gap-2">
          <span aria-hidden className="size-2.5 shrink-0 translate-y-[1px] rounded-[3px] bg-floor ring-1 ring-floor-deep" />
          <span className="min-w-0">
            <span className="num font-bold text-ink" data-testid="backed-usd">
              {usd(backedUsd)}
            </span>
            {preview && preview.backedUsd > backedUsd && (
              <span className="num font-semibold text-ink">
                {" "}
                → {usd(preview.backedUsd)}
              </span>
            )}{" "}
            <span className="text-ink-2">backed by {backedBy}</span>
            <span className="num text-muted"> · {pct}%</span>
          </span>
        </span>
        <span className="flex items-baseline gap-2 text-ink-2">
          <span aria-hidden className="hatch size-2.5 shrink-0 translate-y-[1px] rounded-[3px] ring-1 ring-line-2" />
          <span>
            <span className="num font-semibold">{usd(hypeUsd)}</span> hype
          </span>
        </span>
      </div>
    </div>
  );
}

/** The same block, small, for a list row. */
export function MiniFloorBar({ share, className, label }: { share: number; className?: string; label: string }) {
  const w = Math.max(0, Math.min(100, share * 100));
  return (
    <span role="img" aria-label={label} className={cx("hatch relative block h-3 overflow-hidden rounded-full", className)}>
      <span className="anim-w absolute inset-0 bg-floor" style={fill(w)} />
      {w > 2 && w < 98 && <span aria-hidden className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-bg" style={{ left: `${w}%` }} />}
    </span>
  );
}

export function AssetDot({ symbol, size = 10, className }: { symbol: string; size?: number; className?: string }) {
  return <span aria-hidden className={cx("inline-block shrink-0 rounded-full", className)} style={{ width: size, height: size, background: assetColor(symbol) }} />;
}

export type PieSlice = { key: string; symbol: string; share: number };

/** The basket as a donut, each asset in its own colour. `children` sits in the middle. */
export function BasketPie({ slices, size = 180, thickness, children, label, className }: { slices: PieSlice[]; size?: number; thickness?: number; children?: ReactNode; label: string; className?: string }) {
  const t = thickness ?? Math.max(6, Math.round(size * 0.16));
  const r1 = size / 2;
  const r0 = r1 - t;
  const a = arcs(
    slices.map((s) => s.share),
    size >= 80 ? 0.035 : 0.06,
  );
  return (
    <div className={cx("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="block">
        {slices.length === 0 || slices.every((s) => !(s.share > 0)) ? (
          <path d={donutPath(r1, r1, r0, r1, 0, Math.PI * 2)} fill="var(--sunk)" />
        ) : (
          slices.map((s, i) => <path key={s.key} d={donutPath(r1, r1, r0, r1, a[i]!.start, a[i]!.end)} fill={assetColor(s.symbol)} />)
        )}
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>}
    </div>
  );
}

/** Asset, share and dollar value, one row each. */
export function BasketLegend({ rows, className }: { rows: { key: string; symbol: string; share: number | null; usd?: number | null; anchored?: boolean; note?: ReactNode; known?: boolean }[]; className?: string }) {
  return (
    <ul className={cx("divide-y divide-line", className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2.5">
            <TokenIcon symbol={r.symbol} size={18} chain />
            <span className="truncate font-semibold">{r.symbol}</span>
            {r.anchored && (
              <span className="inline-flex items-center gap-1 text-xs text-muted" title="Anchored: holders can't vote it out">
                <IconAnchor size={12} />
                anchored
              </span>
            )}
            {r.known === false && <span className="rounded-full bg-down-soft px-2 text-xs font-semibold text-down">unverified</span>}
            {r.note}
          </span>
          <span className="num flex shrink-0 items-baseline gap-3 text-sm">
            {r.usd !== undefined && <span className="text-muted">{r.usd === null ? "no price" : usd(r.usd)}</span>}
            <span className="w-11 text-right font-semibold">{r.share === null ? "–" : `${Math.round(r.share * 100)}%`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A row of coloured dots with symbols: the basket at a glance. */
export function AssetDots({ symbols, max = 4, className }: { symbols: string[]; max?: number; className?: string }) {
  const shown = symbols.slice(0, max);
  return (
    <span className={cx("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2", className)}>
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <TokenIcon symbol={s} size={16} chain />
          <span className="font-semibold">{s}</span>
        </span>
      ))}
      {symbols.length > shown.length && <span className="text-muted">+{symbols.length - shown.length}</span>}
    </span>
  );
}

/** A BU-per-token number with its exact value on hover. */
export function Bu({ v, suffix = "BU" }: { v: string; suffix?: string }) {
  const n = toNumber(v, 18);
  return (
    <span className="num" title={`${n} ${suffix}`}>
      {formatTiny(n)} <span className="text-muted">{suffix}</span>
    </span>
  );
}

/** The coin's icon from its config, or its first letters on a colour picked from the ticker. */
export function Monogram({ ticker, icon, size = 40 }: { ticker: string; icon?: string | null; size?: number }) {
  if (icon && icon.startsWith("data:image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold tracking-[-0.04em] text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, background: coinColor(ticker) }}
    >
      {ticker.slice(0, 2)}
    </span>
  );
}

/** A generated face for an account: a shape on a colour, both picked from the account's hash. */
export function Avatar({ account, size = 32, className }: { account: string; size?: number; className?: string }) {
  const s = avatarSpec(account);
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cx("shrink-0 rounded-full", className)}>
      <circle cx="16" cy="16" r="16" fill={s.bg} />
      <g transform={`rotate(${s.rotate} 16 16)`} fill={s.fg}>
        {s.shape === "half" && <path d="M4 16a12 12 0 0 1 24 0Z" />}
        {s.shape === "band" && <rect x="-4" y="12" width="40" height="8" />}
        {s.shape === "ring" && <circle cx="16" cy="16" r="8" fill="none" stroke={s.fg} strokeWidth="4.5" />}
        {s.shape === "diamond" && <rect x="10" y="10" width="12" height="12" rx="2" transform="rotate(45 16 16)" />}
        {s.shape === "dots" && (
          <>
            <circle cx="11" cy="12" r="3.5" />
            <circle cx="21" cy="12" r="3.5" />
            <circle cx="16" cy="21" r="3.5" />
          </>
        )}
      </g>
    </svg>
  );
}
