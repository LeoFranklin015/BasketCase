"use client";

import { formatCompact } from "@backed/client";
import { useEffect, useRef, useState } from "react";
import { splitBuy, backedPct } from "@/lib/backing";
import { EXPLORER_ACCOUNT } from "@/lib/config";
import { priceUnit, usd } from "@/lib/money";
import { FloorBar, Monogram } from "../coin-bits";
import { IconArrowDown, IconArrowUp, IconArrowUpRight, IconCopy, IconExternal, IconMore, IconShare } from "../icons";
import { ChainIcon, TokenIcon } from "../token-icon";
import { Money, Stat, StageChip, cx, pctText, shortAccount } from "../ui";
import { changeLabel } from "@/lib/history";
import { useCoin, useMarket, useNumbers } from "./context";

/** Briefly tint a number when it moves. */
function useFlash(value: number): string {
  const prev = useRef(value);
  const [cls, setCls] = useState("");
  useEffect(() => {
    if (prev.current !== value) {
      setCls("row-in");
      prev.current = value;
      const t = setTimeout(() => setCls(""), 1600);
      return () => clearTimeout(t);
    }
  }, [value]);
  return cls;
}

/** Copy a value; says "Copied" for a moment. */
function CopyPill({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="inline-flex h-9 min-w-0 items-center gap-2 rounded-full bg-pill px-3.5 text-[13px] font-medium uppercase tracking-[0.02em] text-ink transition-colors hover:bg-[var(--pill-hover)]"
      title={`Copy ${value}`}
    >
      <span className="truncate">{done ? "Copied" : label}</span>
      <IconCopy size={14} className="shrink-0" />
    </button>
  );
}

/** Ask the trade card (desktop) or the trade sheet (phone) to open in a mode. */
function openTrade(mode: "buy" | "sell") {
  window.dispatchEvent(new CustomEvent("backed:trade", { detail: mode }));
}

/** Who the coin is, what it is worth, and how much of that the vault backs. */
export function MarketHeader() {
  const { snap, buyPreview, rows } = useCoin();
  const m = useMarket();
  const n = useNumbers();
  const c = snap.config;
  const st = snap.state;
  const flash = useFlash(n.backing.mcapUsd);
  // The floor bar previews a typed buy: the new tokens add their floor value to what is backed.
  const preview = buyPreview ? { backedUsd: n.backing.backedUsd + splitBuy(buyPreview.payUsd, buyPreview.floorValueUsd).backed } : null;
  const unit = priceUnit(n.priceUsd);
  const pct = backedPct(n.backing.share, n.backing.mcapUsd);
  const chg = m.change?.pct;

  return (
    <section aria-label="Market" className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h1 className="text-[1.375rem] font-bold uppercase tracking-[-0.01em]">${c.ticker}</h1>
          <StageChip mode={st.mode} />
        </div>
        <div className="flex shrink-0 gap-2.5">
          <a href="#share" className="icon-btn size-11" aria-label={`Share $${c.ticker}`} title="Share">
            <IconShare size={18} />
          </a>
          <a href={EXPLORER_ACCOUNT(snap.id)} target="_blank" rel="noreferrer" className="icon-btn size-11" aria-label={`${snap.id} on NEARBlocks`} title="Contract on NEARBlocks">
            <IconExternal size={17} />
          </a>
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <span className="relative shrink-0">
          <Monogram ticker={c.ticker} icon={c.icon} size={88} />
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[3px]">
            <ChainIcon chain="near" size={24} />
          </span>
        </span>
        <CopyPill value={snap.id} label={shortAccount(snap.id, 20)} />
      </div>
      <p className="mt-1.5 text-sm text-muted">{c.name}</p>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cx("display -mx-1 rounded-[12px] px-1 text-[3rem] sm:text-[3.75rem]", flash)} data-testid="mcap-usd">
          <Money text={usd(n.backing.mcapUsd)} />
        </span>
        {m.loaded ? (
          chg !== null && chg !== undefined && Number.isFinite(chg) ? (
            <span className={cx("inline-flex items-center gap-1 text-[15px] font-medium", chg < 0 ? "text-down" : "text-up")}>
              {chg < 0 ? <IconArrowDown size={14} /> : <IconArrowUpRight size={14} />}
              <span className="num">{pctText(Math.abs(chg)).replace(/^[+−]/, "")}</span>
              <span className="label">{changeLabel(m.change, snap.loadedAt).replace(/^in /, "")}</span>
            </span>
          ) : (
            <span className="label">no trades yet</span>
          )
        ) : (
          <span className="num text-muted">…</span>
        )}
      </div>
      <p className="caption mt-1">market cap: the price × {formatCompact(n.circulating)} tokens out there</p>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-[15px]">
        <Stat
          v={
            <span className="floor-tag" data-testid="floor-usd" title={`${usd(n.floorUsd)} per token`}>
              {usd(n.floorUsd * unit.mult)}
            </span>
          }
          k="floor"
        />
        {pct === null ? <Stat v="New" k="no buys yet" /> : <Stat v={`${pct}%`} k="backed" />}
        <Stat
          v={
            <span data-testid="price-usd" title={`${usd(n.priceUsd)} per token`}>
              {usd(n.priceUsd * unit.mult)}
            </span>
          }
          k={unit.mult > 1 ? `price ${unit.label.replace("per ", "/ ")}` : "price"}
        />
      </p>

      <p className="mt-3 flex items-center gap-2 text-sm text-muted">
        <span className="flex -space-x-1.5">
          {rows.slice(0, 4).map((r) => (
            <TokenIcon key={r.token_id} symbol={r.symbol} size={22} className="rounded-full ring-2 ring-[var(--bg)]" />
          ))}
        </span>
        backed by {n.backedBy}
      </p>

      <div className="mt-6 flex gap-3">
        <button type="button" className="btn btn-quiet h-14 flex-1 text-base sm:max-w-[10rem]" onClick={() => openTrade("buy")}>
          <IconArrowUp size={18} />
          Buy
        </button>
        <button type="button" className="btn btn-quiet h-14 flex-1 text-base sm:max-w-[10rem]" onClick={() => openTrade("sell")}>
          <IconArrowDown size={18} />
          Sell
        </button>
        <a href="#more" className="btn btn-quiet h-14 w-14 shrink-0 px-0" aria-label="Holders, details and more">
          <IconMore size={18} />
        </a>
      </div>

      <FloorBar className="mt-8" share={n.backing.share} backedUsd={n.backing.backedUsd} hypeUsd={n.backing.hypeUsd} backedBy={n.backedBy} preview={preview} />
      <p className="caption mt-3 max-w-2xl">
        The floor is the least a sell pays before the fee{unit.mult > 1 ? `, shown ${unit.label}` : ""}.{" "}
        {st.mode === "index" ? "It is the vault divided by every token; anyone can redeem for it." : `Fees and burns push it up; its dollar value moves with ${n.backedBy}. It is not a guarantee.`}
        {unit.mult > 1 && (
          <span className="num block text-xs">
            Each token: {usd(n.priceUsd)}, floor {usd(n.floorUsd)}.
          </span>
        )}
      </p>
    </section>
  );
}
