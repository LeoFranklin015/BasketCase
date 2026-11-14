"use client";

import { auctionIn, auctionOut, auctionRateAt, ceilDiv, fillAuctionTx, formatUnits, minusBps, parseUnits, swapTx, toNumber } from "@backed/client";
import { useState } from "react";
import { CURVE, NET, PAY_TOKEN_ID, tokenInfo } from "@/lib/config";
import { getReader, swapperId, verifierId } from "@/lib/data";
import { useNow, usePoll } from "@/lib/hooks";
import { assetAmount, fmtQty, rawToUsd, usd } from "@/lib/money";
import { useWallet } from "@/lib/wallet";
import { TxStatus, useTx } from "../tx";
import { IconSwap } from "../icons";
import { displayName } from "@/lib/avatar";
import { fill as fillBar } from "../coin-bits";
import { countdown } from "../ui";
import { WalletButton } from "../wallet-button";
import { useCoin } from "./context";
import { TokenIcon } from "../token-icon";

/** The open Dutch auction that swaps a losing asset for the challenge winner. */
export function AuctionPanel({ compact }: { compact?: boolean }) {
  const { snap, refresh } = useCoin();
  const { accountId } = useWallet();
  const now = useNow(1000);
  const tx = useTx();
  const a = snap.auction;
  const [want, setWant] = useState("");
  const balance = usePoll(
    async () => (accountId && a ? getReader().verifier.mtBalanceOf(accountId, a.replacement) : "0"),
    [accountId, a?.replacement, snap.loadedAt],
    0,
  );
  if (!a) return null;

  const tgt = tokenInfo(a.target);
  const rep = tokenInfo(a.replacement);
  const rate = now > 0 ? auctionRateAt(a, CURVE.auction_premium_bps, now) : a.rate_now;
  const premium = Number(((BigInt(rate) - BigInt(a.fair_rate)) * 10_000n) / BigInt(a.fair_rate)) / 100;
  const leftPct = Number((BigInt(a.target_left) * 1000n) / (BigInt(a.target_total) || 1n)) / 10;
  // One target unit in replacement units, human-scaled.
  const humanRate = (toNumber(rate, 18) * 10 ** tgt.decimals) / 10 ** rep.decimals;

  let targetRaw: string | null = null;
  try {
    const v = parseUnits(want || "0", tgt.decimals);
    targetRaw = v > 0n ? (v > BigInt(a.target_left) ? a.target_left : v.toString()) : null;
  } catch {
    targetRaw = null;
  }
  const payRaw = targetRaw ? auctionIn(targetRaw, rate) : null;
  const getRaw = payRaw ? auctionOut(payRaw, rate) : null;
  const payUsd = payRaw ? rawToUsd(a.replacement, payRaw, snap.usdPrices) : null;
  const getUsd = getRaw ? rawToUsd(a.target, getRaw, snap.usdPrices) : null;

  const fill = async () => {
    if (!accountId || !payRaw || !getRaw) return;
    const have = BigInt(balance.data ?? "0");
    const need = BigInt(payRaw);
    const steps = [];
    if (have < need) {
      const shortfall = (need - have).toString();
      const quoteIn = await getReader().swapper.quoteIn(PAY_TOKEN_ID, a.replacement, shortfall);
      const padded = ceilDiv(BigInt(quoteIn) * 10_100n, 10_000n).toString();
      steps.push({
        title: `Swap ${NET.testTokens ? "test " : ""}USDC into ${rep.symbol}`,
        txs: [swapTx(verifierId(), swapperId(), [{ token_in: PAY_TOKEN_ID, amount_in: padded, want: a.replacement, amount_out: shortfall }])],
      });
    }
    steps.push({
      title: `Fill: send ${assetAmount(a.replacement, payRaw)} ${rep.symbol} for ${assetAmount(a.target, getRaw)} ${tgt.symbol}`,
      txs: [fillAuctionTx(verifierId(), snap.id, { token_id: a.replacement, amount: payRaw, min_out: minusBps(getRaw, 100) })],
    });
    await tx.run(steps, () => {
      setWant("");
      refresh();
    });
  };

  const rampFrac = now > 0 ? Math.min(1, Math.max(0, (now - a.start_ms) / Math.max(1, a.ramp_end_ms - a.start_ms))) : 0;

  return (
    <section className="card p-5" aria-labelledby="auction-h">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="auction-h" className="h2">
            Swap auction live
          </h2>
          <p className="mt-1 flex items-center gap-2 text-lg font-bold">
            <TokenIcon symbol={tgt.symbol} size={18} chain />
            {tgt.symbol} <IconSwap className="text-muted" /> <TokenIcon symbol={rep.symbol} size={18} chain />
            {rep.symbol}
          </p>
        </div>
        <span className="rounded-full bg-floor-soft px-2.5 py-1 text-xs font-semibold">
          {now > 0 && now < a.ramp_end_ms ? `at fair price in ${countdown(a.ramp_end_ms - now)}` : "at fair price until filled"}
        </span>
      </div>
      {!compact && (
        <p className="caption mt-2">
          A challenge won, so the coin sells its {tgt.symbol} for {rep.symbol}. The rate starts {CURVE.auction_premium_bps / 100}% above the reporter&apos;s fair
          rate and falls to fair, then waits there. Anyone can fill it, in part or in full.
        </p>
      )}

      {!compact && <RateRamp frac={rampFrac} premiumPct={CURVE.auction_premium_bps / 100} />}

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <dt className="caption text-xs">Rate now</dt>
          <dd className="num font-bold">
            {fmtQty(humanRate)} <span className="text-xs font-normal text-muted">{rep.symbol} per {tgt.symbol}</span>
          </dd>
          <dd className="num caption text-xs">{premium > 0 ? `fair +${premium.toFixed(2)}%` : "at fair"}</dd>
        </div>
        <div>
          <dt className="caption text-xs">{tgt.symbol} left to sell</dt>
          <dd className="num font-bold">{assetAmount(a.target, a.target_left)}</dd>
          <dd className="num caption text-xs">
            {leftPct}% of {assetAmount(a.target, a.target_total)}
          </dd>
        </div>
      </dl>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Auction filled" aria-valuenow={Math.round(100 - leftPct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="anim-w h-full w-full bg-ink" style={fillBar(100 - leftPct, "left", 999)} />
      </div>
      <p className="caption mt-2 text-xs">
        Won by {displayName(a.challenger)}. {assetAmount(a.replacement, a.replacement_received)} {rep.symbol} received so far.
      </p>

      <form
        className="mt-4 space-y-2.5 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void fill();
        }}
      >
        <label className="block">
          <span className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">Buy {tgt.symbol}</span>
            <button type="button" className="text-xs font-semibold text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={() => setWant(formatUnits(a.target_left, tgt.decimals))}>
              all that&apos;s left
            </button>
          </span>
          <input className="field num mt-1.5" inputMode="decimal" value={want} onChange={(e) => setWant(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
        </label>
        {payRaw && getRaw && (
          <p className="text-sm text-ink-2">
            You send <span className="num font-semibold text-ink">{assetAmount(a.replacement, payRaw)} {rep.symbol}</span>
            {payUsd !== null && <> ({usd(payUsd)})</>} and get <span className="num font-semibold text-ink">{assetAmount(a.target, getRaw)} {tgt.symbol}</span>
            {getUsd !== null && <> ({usd(getUsd)} at swapper prices)</>}.
            {accountId && BigInt(balance.data ?? "0") < BigInt(payRaw) && <> You hold less {rep.symbol} than that, so {NET.testTokens ? "test " : ""}USDC is swapped first.</>}
          </p>
        )}
        {accountId ? (
          <button type="submit" className="btn btn-ink w-full" disabled={!payRaw || tx.busy}>
            {tx.busy ? "Waiting for the wallet…" : "Fill the auction"}
          </button>
        ) : (
          <WalletButton wide />
        )}
        <TxStatus s={tx} />
      </form>
    </section>
  );
}

/** The Dutch auction's rate over time: a straight fall from fair + premium to fair, then flat. */
function RateRamp({ frac, premiumPct }: { frac: number; premiumPct: number }) {
  const W = 300;
  const H = 64;
  const rampEnd = W * 0.72;
  const yTop = 10;
  const yFair = H - 14;
  const x = frac * rampEnd;
  const y = yTop + frac * (yFair - yTop);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img" aria-label={`Rate is ${(premiumPct * (1 - frac)).toFixed(1)}% above fair and falling`}>
      <line x1="0" x2={W} y1={yFair} y2={yFair} stroke="var(--line-2)" strokeDasharray="3 3" />
      <path d={`M0,${yTop} L${rampEnd},${yFair} L${W},${yFair}`} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />
      <path d={`M0,${yTop} L${x},${y}`} fill="none" stroke="var(--ink)" strokeWidth="2" />
      <circle cx={x} cy={y} r="4" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" />
      <text x="2" y={yTop - 2} fontSize="10" fill="var(--muted)">
        fair +{premiumPct}%
      </text>
      <text x={W - 2} y={yFair - 4} fontSize="10" fill="var(--muted)" textAnchor="end">
        fair
      </text>
    </svg>
  );
}
