"use client";
import { useEffect, useState } from "react";

import { EXPLORER_ACCOUNT, NET } from "@/lib/config";
import { usd } from "@/lib/money";
import { useMediaQuery } from "@/lib/hooks";
import { BasketLegend, BasketPie, fill } from "../coin-bits";
import { IconCheck } from "../icons";
import { STAGES, cx, shortAccount, stageOf } from "../ui";
import { useCoin, useNumbers } from "./context";
import { TokenIcon } from "../token-icon";

/**
 * What backs the coin, on the yellow band: the vault is the one thing on the page that is wholly
 * backed, so it wears the floor's own colour. The donut sits on a light disc so every asset
 * colour keeps its contrast.
 */
export function BasketPanel() {
  const { snap, bu, rows } = useCoin();
  const wide = useMediaQuery("(min-width: 640px)");
  const n = useNumbers();
  const c = snap.config;
  return (
    <section className="band-floor min-w-0 overflow-hidden" aria-labelledby="basket-h">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 sm:p-7">
        <div className="flex flex-col items-center gap-3 sm:order-last sm:items-end">
          <span className="rounded-full bg-card p-2.5 shadow-[0_1px_0_rgb(12_14_18/0.12)]">
            <BasketPie
              slices={rows.map((r) => ({ key: r.token_id, symbol: r.symbol, share: r.share ?? 0 }))}
              size={wide ? 168 : 120}
              label={`Basket: ${rows.map((r) => `${r.symbol} ${Math.round((r.share ?? 0) * 100)}%`).join(", ")}`}
            >
              <span className="caption text-[11px] font-semibold uppercase tracking-[0.08em]">{rows.length} assets</span>
            </BasketPie>
          </span>
        </div>
        <div className="min-w-0">
          <h2 id="basket-h" className="h-section">
            What backs it
          </h2>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2.5">
            <span className="display text-[2.5rem] leading-none sm:text-[3rem]">{usd(n.vaultUsd)}</span>
            <span className="font-semibold text-ink-2">in the vault</span>
          </p>
          <p className="mt-2 max-w-md text-[15px] leading-snug text-ink-2">Every buy sends this basket into the coin&apos;s own vault. A sell pays out a share of it.</p>
          <BasketLegend
            className="mt-4 border-t border-line"
            rows={rows.map((r) => ({
              key: r.token_id,
              symbol: r.symbol,
              share: r.share,
              usd: r.usd,
              anchored: r.anchored,
              known: r.known,
              note:
                snap.auction?.target === r.token_id ? (
                  <span className="text-xs font-semibold text-ink-2">being swapped out</span>
                ) : snap.auction?.replacement === r.token_id ? (
                  <span className="text-xs font-semibold text-ink-2">joining</span>
                ) : undefined,
            }))}
          />
          <p className="caption mt-3 text-xs">
            At {NET.swapRoute === "oneclick" ? "1Click" : `the ${NET.label.toLowerCase()} swapper`}&apos;s prices: 1 basket unit (BU) = {usd(bu.e6 / 1e6)} {bu.live ? "now" : "at launch"}. Anchored assets can&apos;t be voted out.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-3 border-t border-line bg-[rgb(12_14_18/0.04)] px-5 py-4 text-sm sm:px-7">
        <div>
          <dt className="caption text-xs">Trade fee</dt>
          <dd className="num font-bold">{c.fee_bps / 100}%</dd>
        </div>
        <div>
          <dt className="caption text-xs">Each round</dt>
          <dd className="num font-bold">{c.epoch_len_ms >= 86_400_000 ? `${c.epoch_len_ms / 86_400_000} days` : `${c.epoch_len_ms / 60_000} min`}</dd>
        </div>
        <div className="min-w-0">
          <dt className="caption text-xs">Made by</dt>
          <dd className="truncate font-bold">
            <a className="hover:underline" href={EXPLORER_ACCOUNT(c.creator)} target="_blank" rel="noreferrer" title={c.creator}>
              {shortAccount(c.creator, 18)}
            </a>
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Fair launch → Growing → Graduated, drawn as one track with this coin's place on it. */
export function StagePanel() {
  const { snap } = useCoin();
  const n = useNumbers();
  const st = snap.state;
  const at = STAGES.findIndex((s) => s.mode === st.mode);
  const pct = n.progress * 100;
  return (
    <section className="min-w-0 px-1 py-2" aria-labelledby="stage-h">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="stage-h" className="h2">
          Where it is in life
        </h2>
        <p className="text-sm text-ink-2">
          <span className="font-semibold text-ink">{stageOf(st.mode).label}:</span> {stageOf(st.mode).blurb}
        </p>
      </div>
      <ol className="mt-4 grid grid-cols-3 gap-1.5" aria-label="Stages">
        {STAGES.map((s, i) => {
          const done = i < at;
          const now = i === at;
          return (
            <li key={s.mode} className="min-w-0" aria-current={now ? "step" : undefined}>
              <div className={cx("relative h-3 overflow-hidden rounded-full", done ? "bg-ink" : "bg-line")}>
                {now && (
                  <div
                    className="anim-w absolute inset-0 bg-ink"
                    style={fill(st.mode === "curve" ? Math.max(pct, 3) : 100, "left", 999)}
                    {...(st.mode === "curve"
                      ? { role: "progressbar", "aria-label": "Progress to graduation", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(pct * 10) / 10 }
                      : {})}
                  />
                )}
              </div>
              <p className={cx("mt-2 flex items-center gap-1.5 truncate text-sm font-semibold", now ? "text-ink" : done ? "text-ink-2" : "text-muted")}>
                {done && <IconCheck size={13} />}
                {s.label}
              </p>
            </li>
          );
        })}
      </ol>
      {st.mode === "curve" && (
        <p className="caption mt-1">
          <span className="num font-semibold text-ink">{pct.toFixed(1)}%</span> of the way: it graduates at <span className="num">{usd(n.gradUsd)}</span> in the curve.
        </p>
      )}
      {st.mode === "index" && st.graduated_ms && (
        <p className="caption mt-1">Graduated on {new Date(st.graduated_ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.</p>
      )}
      {st.mode === "index" && <RheaLink coin={snap.id} />}
    </section>
  );
}

/** "Also trading on Rhea": shown once the keeper has opened the graduated coin's Rhea pool (read live). */
function RheaLink({ coin }: { coin: string }) {
  const [pool, setPool] = useState<{ pool: number; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/rhea/${encodeURIComponent(coin)}`)
      .then((r) => r.json())
      .then((j: { pool: number | null; url?: string }) => live && j.pool !== null && j.url && setPool({ pool: j.pool, url: j.url }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [coin]);
  if (!pool) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ECECEC] px-3 py-1 font-semibold">
        <TokenIcon symbol="RHEA" size={16} />
        Also trading on Rhea
      </span>
      <a className="font-semibold underline underline-offset-2" href={pool.url} target="_blank" rel="noopener">
        pool #{pool.pool} ↗
      </a>
      <span className="caption">Listed automatically at graduation. If it trades below the floor, buying there and redeeming here pays the difference.</span>
    </p>
  );
}
