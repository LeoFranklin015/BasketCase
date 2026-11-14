import type { CoinMode } from "@backed/client";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

/** A coin's life, in user words. */
export const STAGES: { mode: CoinMode; label: string; blurb: string }[] = [
  { mode: "launch", label: "Fair launch", blurb: "First minutes: every buy is queued and everyone pays the same price." },
  { mode: "curve", label: "Growing", blurb: "The contract sets the price; it rises as people buy." },
  { mode: "index", label: "Graduated", blurb: "No new tokens. Each token is a share of the vault, and a pool trades it." },
];

export function stageOf(mode: CoinMode) {
  return STAGES.find((s) => s.mode === mode)!;
}

export function StageChip({ mode, className }: { mode: CoinMode; className?: string }) {
  const s = stageOf(mode);
  return (
    <span
      title={s.blurb}
      className={cx(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold",
        mode === "index" ? "border-ink bg-ink text-white" : "border-transparent bg-pill text-ink",
        className,
      )}
    >
      <span aria-hidden className={cx("size-1.5 rounded-full", mode === "index" ? "bg-white" : mode === "launch" ? "bg-faint" : "blink bg-up-line")} />
      {s.label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-[14px] bg-sunk", className)} />;
}

/** A titled card. The heading names the thing; a caption under it says what it means. */
export function Card({
  title,
  caption,
  aside,
  children,
  className,
  id,
  flush,
  as: Tag = "section",
}: {
  title?: ReactNode;
  caption?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  flush?: boolean;
  as?: "section" | "div" | "aside";
}) {
  return (
    <Tag className={cx("card min-w-0", className)} aria-labelledby={title ? id : undefined}>
      {title && (
        <header className="flex items-start justify-between gap-3 px-6 pt-6">
          <div className="min-w-0">
            <h2 id={id} className="h2">
              {title}
            </h2>
            {caption && <p className="caption mt-0.5">{caption}</p>}
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </header>
      )}
      <div className={flush ? "pt-3" : "p-6 pt-4"}>{children}</div>
    </Tag>
  );
}

export function ErrorNote({ error, children }: { error?: Error | string; children?: ReactNode }) {
  const msg = typeof error === "string" ? error : error?.message;
  return (
    <div role="alert" className="rounded-[14px] bg-down-soft px-4 py-3 text-sm text-ink">
      {children ?? <span className="break-words">{msg}</span>}
    </div>
  );
}

/**
 * An empty state: the coin block drawn small and still empty (all stripes, a yellow sliver at the
 * floor line), a plain title, a sentence, and an optional action.
 */
export function Empty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cx("flex flex-col items-center px-4 py-8 text-center", className)}>
      <span aria-hidden className="hatch relative mb-3 block h-9 w-7 overflow-hidden rounded-t-[8px] ring-1 ring-line-2">
        <span className="absolute inset-x-0 bottom-0 h-[5px] bg-floor" />
        <span className="absolute inset-x-0 bottom-[5px] h-[2px] bg-ink" />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {children && <div className="caption mx-auto mt-1 max-w-sm">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A pill switch (role=tablist). */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx("switch", className)}>
      {options.map((o) => (
        <button key={o.id} role="tab" type="button" aria-selected={value === o.id} onClick={() => onChange(o.id)} className="flex-1 whitespace-nowrap">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Chips that act as tabs, for a section with several views. */
export function ChipTabs<T extends string>({ value, options, onChange, label, className }: { value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx("-mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]", className)}>
      {options.map((o) => (
        <button key={o.id} role="tab" type="button" aria-selected={value === o.id} onClick={() => onChange(o.id)} className="chip shrink-0">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Row({ k, v, strong, className }: { k: ReactNode; v: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-1 text-sm", className)}>
      <span className="text-muted">{k}</span>
      <span className={cx("num text-right", strong ? "font-semibold text-ink" : "text-ink-2")}>{v}</span>
    </div>
  );
}

export function shortAccount(id: string, max = 22): string {
  if (id.length <= max) return id;
  return `${id.slice(0, max - 8)}…${id.slice(-7)}`;
}

export function timeAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function countdown(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** "+12.4%" / "−3.1%" with the sign as a real minus. */
export function pctText(p: number, digits = 1): string {
  if (!Number.isFinite(p)) return "–";
  const v = Math.abs(p).toFixed(digits);
  return p > 0 ? `+${v}%` : p < 0 ? `−${v}%` : `${v}%`;
}

/** A price change: green up, red down, always signed. */
export function Change({ pct, className }: { pct: number | null | undefined; className?: string }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return <span className={cx("num text-muted", className)}>–</span>;
  return <span className={cx("num font-semibold", pct < 0 ? "text-down" : pct > 0 ? "text-up" : "text-muted", className)}>{pctText(pct)}</span>;
}

/** The title block for a page: one heading and a sentence or two. */
export function PageHead({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-2 pt-2 sm:flex-row sm:items-end sm:justify-between lg:pt-4">
      <div className="max-w-2xl">
        <h1 className="meme text-[2.25rem] sm:text-[3.25rem]">{title}</h1>
        {children && <div className="mt-3 text-base leading-relaxed text-ink-2 sm:text-[17px]">{children}</div>}
      </div>
      {aside}
    </header>
  );
}

/** A money string with its trailing decimals in grey: "$560" + ".92". */
export function Money({ text, className }: { text: string; className?: string }) {
  const m = /^(.*\d)(\.\d+)$/.exec(text);
  return (
    <span className={className}>
      {m ? (
        <>
          {m[1]}
          <span className="cents">{m[2]}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

/** One stat of a stat line: a black value, then a grey capital label ("96% BACKED"). */
export function Stat({ v, k, className }: { v: ReactNode; k: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-baseline gap-1.5 whitespace-nowrap", className)}>
      <span className="num font-medium text-ink">{v}</span>
      <span className="label">{k}</span>
    </span>
  );
}
