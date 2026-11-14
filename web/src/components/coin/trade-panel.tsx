"use client";

import {
  faucetTx,
  formatTokens,
  intentsDepositTx,
  formatUnits,
  parseUnits,
  planSell,
  prepareBuy,
  redeemTx,
  toNumber,
  usdToBu,
  type BuyPlan,
  type BuyQuote,
  type SellQuote,
} from "@backed/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { splitBuy } from "@/lib/backing";
import { FAUCET_AMOUNT, NET, PAY_TOKEN_ID, tokenInfo } from "@/lib/config";
import { mainnetQuoteIn, swapLegsViaOneClick } from "@/lib/mainnet-buy";
import { getReader, swapperId, verifierId } from "@/lib/data";
import { useDebounced, usePoll } from "@/lib/hooks";
import { assetAmount, buFloatUsd, buToUsdN, fmtQty, usd } from "@/lib/money";
import { recordBuy } from "@/lib/mybuys";
import { GUEST_ENABLED, useWallet } from "@/lib/wallet";
import { TxStatus, TxSteps, useTx } from "../tx";
import { IconChevron, IconDrop } from "../icons";
import { Row, cx, pctText } from "../ui";
import { TryFreeButton, WalletButton } from "../wallet-button";
import { fill } from "../coin-bits";
import { useCoin, useNumbers } from "./context";
import { XChainBuy } from "./xchain-buy";
import { minBuyMessage, minBuyUsd } from "@/lib/minbuy";
import { isOndoStock } from "@/lib/icons";
import { TokenIcon } from "../token-icon";

type Mode = "buy" | "sell" | "redeem";
/** "test USDC" on testnet, "USDC" on mainnet. */
const PAY_NAME = NET.testTokens ? "test USDC" : "USDC";
/** The two steps of a buy, as the wallet prompt and the step list both name them. */
const BUY_STEPS = [`Swap ${PAY_NAME} into the basket`, "Send the basket to the coin"] as const;
const SLIPPAGE = [50, 100, 300];

export type TradeMode = "buy" | "sell" | "redeem";

/** `tight`: the X player, which must fit a post; drops the buy split bar (the price card above shows the backed share). */
export function TradePanel({ compact, initialMode = "buy", bare, tight }: { compact?: boolean; initialMode?: TradeMode; bare?: boolean; tight?: boolean }) {
  const { snap } = useCoin();
  const [mode, setMode] = useState<TradeMode>(initialMode);
  const [slip, setSlip] = useState(100);
  const options: { id: TradeMode; label: string }[] = [
    { id: "buy", label: "Buy" },
    { id: "sell", label: "Sell" },
  ];
  if (snap.state.mode === "index") options.push({ id: "redeem", label: "Redeem" });
  const active = options.some((o) => o.id === mode) ? mode : "buy";

  return (
    <section className={cx(!bare && "card p-4 sm:p-5")} aria-label="Trade">
      <div role="tablist" aria-label="Trade" className="switch flex w-full">
        {options.map((o) => (
          <button key={o.id} role="tab" type="button" aria-selected={active === o.id} onClick={() => setMode(o.id)} className="h-9 flex-1 text-sm">
            {o.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {active === "buy" && <BuyForm slip={slip} compact={compact} tight={tight} />}
        {active === "sell" && <SellForm slip={slip} />}
        {active === "redeem" && <RedeemForm />}
        {active !== "redeem" && (
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
            <span className="caption">Max slippage</span>
            <div className="flex gap-1" role="group" aria-label="Max slippage">
              {SLIPPAGE.map((s) => (
                <button key={s} type="button" aria-pressed={slip === s} onClick={() => setSlip(s)} className="chip num h-7 min-h-0 px-2.5 text-xs">
                  {s / 100}%
                </button>
              ))}
            </div>
          </div>
        )}
        <FaucetLink />
        <FundingNote />
      </div>
    </section>
  );
}

/** A new guest wallet funds itself (gas, then test USDC); say so while it happens. */
function FundingNote() {
  const { funding } = useWallet();
  if (!funding || funding.state === "done") return null;
  return (
    <p role="status" className={cx("mt-3 flex items-center gap-2 rounded-[12px] px-3 py-2 text-sm", funding.state === "error" ? "bg-down-soft text-ink" : "bg-floor-soft text-ink")}>
      {funding.state === "working" && <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-ink border-t-transparent" />}
      {funding.message}
    </p>
  );
}

/** Free test USDC, so anyone can try a buy. */
function FaucetLink() {
  const { refresh } = useCoin();
  const { accountId } = useWallet();
  const tx = useTx();
  if (!accountId || !NET.testTokens) return null;
  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink disabled:opacity-50"
        disabled={tx.busy}
        onClick={() => void tx.run([{ title: "Get 100 test USDC from the faucet", txs: [faucetTx(verifierId(), { token_id: PAY_TOKEN_ID, amount: FAUCET_AMOUNT })] }], refresh)}
      >
        <IconDrop size={14} />
        Get test USDC
      </button>
      <TxStatus s={tx} />
    </div>
  );
}

/** Details that matter but not first: tucked under one line. */
function Tucked({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-sm text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        {summary}
        <IconChevron size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="pt-1">{children}</div>
    </details>
  );
}

/** The buy split: how much of what you pay the floor backs today, and how much rides above it. */
export function SplitBar({ payUsd, floorValueUsd, backedBy, queued }: { payUsd: number; floorValueUsd: number; backedBy: string; queued?: boolean }) {
  const s = splitBuy(payUsd, floorValueUsd);
  const w = s.share * 100;
  return (
    <div data-testid="buy-split">
      <div
        className="hatch flex h-4 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`${usd(s.backed)} of ${usd(payUsd)} backed, ${usd(s.above)} above the floor`}
      >
        <div className="anim-w h-full w-full bg-floor" style={fill(w)} />
      </div>
      <p className="mt-2.5 text-[15px] leading-snug">
        of your <span className="num font-semibold">{usd(payUsd)}</span>, <span className="num rounded-[5px] bg-floor px-1 font-bold text-floor-ink">{usd(s.backed)}</span> is
        backed by {backedBy}
      </p>
      <p className="caption mt-0.5">
        {queued ? "Estimate: the fair launch prices everyone together when the window closes. " : ""}
        The other <span className="num">{usd(s.above)}</span> rides above the floor{s.above > 0 ? " and covers the fee and the curve" : ""}.
      </p>
    </div>
  );
}

function useQuote<T>(fn: (() => Promise<T>) | null, key: string) {
  const k = useDebounced(key, 300);
  return usePoll(async () => (fn ? fn() : null), [k], 0);
}

function Presets({ items, onPick, label }: { items: { label: string; value: string; active?: boolean }[]; onPick: (v: string) => void; label: string }) {
  return (
    <div className="mt-2.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} role="group" aria-label={label}>
      {items.map((p) => (
        <button key={p.label} type="button" onClick={() => onPick(p.value)} aria-pressed={p.active ?? false} className="chip num">
          {p.label}
        </button>
      ))}
    </div>
  );
}

function BuyForm({ slip, compact, tight }: { slip: number; compact?: boolean; tight?: boolean }) {
  const { snap, bu, rows, refresh, setPreview, setBuyPreview } = useCoin();
  const n = useNumbers();
  const { accountId, signNep413, send, ensureFunded, method } = useWallet();
  const [planning, setPlanning] = useState(false);
  const buyingRef = useRef(false);
  const tx = useTx();
  const faucetTx_ = useTx();
  const [amount, setAmount] = useState("20");
  // The coin's floor bar previews a buy only once the viewer has picked an amount.
  const [touched, setTouched] = useState(false);
  const pick = (v: string) => {
    setTouched(true);
    setAmount(v);
  };
  const [plan, setPlan] = useState<(BuyPlan & { quote: BuyQuote }) | null>(null);
  const [planErr, setPlanErr] = useState<string>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  let buIn: string | null = null;
  try {
    buIn = Number(amount) > 0 ? usdToBu(amount, bu.e6) : null;
  } catch {
    buIn = null;
  }
  const quote = useQuote(buIn ? () => getReader().coin(snap.id).quoteBuy(buIn!) : null, buIn ?? "");
  // Ignore a quote still in flight for an earlier amount.
  const q = quote.data && quote.data.bu_in === buIn ? quote.data : null;

  useEffect(() => {
    setPreview(q && !q.queued ? toNumber(q.net, 18) : null);
  }, [q, setPreview]);
  useEffect(() => () => setPreview(null), [setPreview]);

  const st = snap.state;
  const tokens = q ? toNumber(q.tokens_out, 18) : 0;
  const payUsd = Number(amount) || 0;
  const minUsd = minBuyUsd(rows);
  const tooSmall = minUsd > 0 && payUsd > 0 && payUsd < minUsd;
  const priceBu = toNumber(st.price, 18);
  const floorBu = toNumber(st.floor, 18);
  const avgBu = q && tokens > 0 ? toNumber(q.net, 18) / tokens : null;
  // The curve never sells below its marginal price; a negative figure only means the snapshot is a few seconds old.
  const impact = avgBu && priceBu > 0 ? Math.max(0, (avgBu / priceBu - 1) * 100) : null;
  const floorUsd = buFloatUsd(tokens * floorBu, bu.e6);
  useEffect(() => {
    setBuyPreview(touched && q && payUsd > 0 ? { payUsd, tokens, floorValueUsd: floorUsd } : null);
  }, [touched, q, payUsd, tokens, floorUsd, setBuyPreview]);
  useEffect(() => () => setBuyPreview(null), [setBuyPreview]);
  const needsSwap = snap.basket.some((b) => b.token_id !== PAY_TOKEN_ID && BigInt(b.q) > 0n);

  const buy = async () => {
    // One buy at a time: planning (funding + reads) takes seconds before the wallet step shows as busy.
    if (!accountId || !buIn || buyingRef.current) return;
    buyingRef.current = true;
    setPlanning(true);
    try {
      await buyOnce();
    } finally {
      buyingRef.current = false;
      setPlanning(false);
    }
  };

  const buyOnce = async () => {
    if (!accountId || !buIn) return;
    setPlanErr(undefined);
    let p: BuyPlan & { quote: BuyQuote };
    try {
      // A brand-new guest is still receiving its gas and test USDC: plan the buy once they land.
      await ensureFunded();
      // The free RPCs drop a read now and then; a buy plan is all reads, so retry those.
      p = await retryNetwork(() =>
        prepareBuy(getReader(), {
          verifier: verifierId(),
          swapper: swapperId(),
          // Mainnet prices each basket leg with a 1Click dry quote instead of the testnet swapper.
          quoteIn: NET.swapRoute === "oneclick" ? mainnetQuoteIn(accountId) : undefined,
          coin: snap.id,
          account_id: accountId,
          pay_token: PAY_TOKEN_ID,
          bu_in: buIn,
          slippage_bps: slip,
        }),
      );
    } catch (e) {
      setPlanErr(plainQuoteError(e as Error));
      return;
    }
    setPlan(p);
    if (BigInt(p.payShortfall) > 0n) return;
    await tx.run(
      [
        NET.swapRoute === "oneclick" && p.swapLegs.length
          ? {
              title: BUY_STEPS[0],
              txs: [],
              run: async (progress) => void (await swapLegsViaOneClick(p.swapLegs, { account: accountId, signNep413, send }, progress)),
            }
          : { title: BUY_STEPS[0], txs: p.step1 ? [p.step1] : [] },
        { title: p.step2.length > 1 ? `Register with the coin and ${BUY_STEPS[1].toLowerCase()}` : BUY_STEPS[1], txs: p.step2 },
      ],
      (r) => {
        // The part of a buy capped at graduation comes back, so it isn't cost.
        const cost = (BigInt(p.quote.bu_in) - BigInt(p.quote.unused)).toString();
        recordBuy(accountId, snap.id, { tokens: p.quote.tokens_out, bu: cost, ts: Date.now(), tx: r.hashes.at(-1) });
        const got = toNumber(p.quote.tokens_out, 18);
        setReceipt({ tokens: got, payUsd, floorUsd: buFloatUsd(got * floorBu, bu.e6), queued: p.quote.queued });
        setPlan(null);
        refresh();
      },
    );
  };

  // Mainnet: move USDC from the wallet's own NEP-141 balance into NEAR Intents, where the swaps and the buy spend it.
  const deposit = (amount: string) =>
    accountId &&
    faucetTx_.run([{ title: `Move ${PAY_NAME} into NEAR Intents`, txs: [intentsDepositTx(verifierId(), PAY_TOKEN_ID.replace(/^nep141:/, ""), amount)] }], () => setPlan(null));

  const faucet = () =>
    accountId &&
    faucetTx_.run([{ title: "Get 100 test USDC", txs: [faucetTx(verifierId(), { token_id: PAY_TOKEN_ID, amount: FAUCET_AMOUNT })] }], () => setPlan(null));

  if (receipt) {
    return (
      <BuyReceipt
        r={receipt}
        tx={tx}
        onAgain={() => {
          setReceipt(null);
          tx.reset();
        }}
      />
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void buy();
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">You pay</span>
          <span className="caption inline-flex items-center gap-1.5">
            <TokenIcon symbol="USDC" size={16} chain />
            {PAY_NAME}
          </span>
        </span>
        <div className="relative mt-1.5">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[1.75rem] font-bold text-muted">$</span>
          <input
            className="field num h-16 pl-10 text-[1.75rem] font-bold tracking-[-0.02em]"
            inputMode="decimal"
            value={amount}
            onChange={(e) => pick(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-describedby="buy-bu"
            data-testid="buy-amount"
          />
          <span id="buy-bu" className="num pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted">
            {buIn ? `${formatTokens(buIn)} BU` : ""}
          </span>
        </div>
        <Presets label="Amount presets" items={["5", "20", "50", "100"].map((v) => ({ label: `$${v}`, value: v, active: amount === v }))} onPick={pick} />
      </label>

      <div aria-live="polite" className={tight ? "min-h-[3.5rem]" : "min-h-[7.5rem]"}>
        {q ? (
          <>
            <p className="caption">{q.queued ? "you get about" : "you get"}</p>
            <p className="num text-[1.625rem] font-bold leading-tight tracking-[-0.02em]">
              {fmtQty(tokens)} <span className="text-base font-semibold text-muted">{snap.config.ticker}</span>
            </p>
            {payUsd > 0 && !tight && (
              <div className="mt-3">
                <SplitBar payUsd={payUsd} floorValueUsd={floorUsd} backedBy={n.backedBy} queued={q.queued} />
              </div>
            )}
          </>
        ) : (
          <p className="caption py-2">{!buIn ? "Enter an amount" : quote.loading ? "Working out your tokens…" : quote.error ? plainQuoteError(quote.error) : "No quote"}</p>
        )}
      </div>

      {q && (
        <div className="border-t border-line pt-2">
          <Tucked summary={<span>Fee {usd(buToUsdN(q.fee, bu.e6))} · {q.queued ? "queued until the window closes" : `at least ${fmtQty(tokens * (1 - slip / 10_000))} tokens`}</span>}>
            {avgBu !== null && <Row k="Average price" v={usd(buFloatUsd(avgBu, bu.e6))} />}
            {impact !== null && !q.queued && <Row k="Price impact" v={<span className={impact > 5 ? "font-semibold text-down" : undefined}>{pctText(impact, 2)}</span>} />}
            <Row k={`Fee ${snap.config.fee_bps / 100}%`} v={usd(buToUsdN(q.fee, bu.e6))} />
            {!q.queued && <Row k="Minimum received" v={`${fmtQty(tokens * (1 - slip / 10_000))}`} />}
            {!compact && (
              <>
                <p className="caption mt-2 text-xs">Basket you send ({q.token_ids.length} assets)</p>
                <ul className="num mt-1 space-y-0.5 text-sm">
                  {q.token_ids.map((t, i) => (
                    <li key={t} className="flex justify-between">
                      <span className="text-ink-2">{tokenInfo(t).symbol}</span>
                      <span>{assetAmount(t, q.amounts[i] ?? "0")}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Tucked>
        </div>
      )}

      {q?.graduates && <p className="text-sm font-semibold">This buy reaches graduation. It is capped there and the rest comes back to you.</p>}

      {plan && BigInt(plan.payShortfall) > 0n && (
        <div role="alert" className="rounded-[14px] bg-floor-soft px-3.5 py-2.5 text-sm text-ink">
          {NET.testTokens ? (
            <>
              You need {formatUnits(plan.payShortfall, tokenInfo(PAY_TOKEN_ID).decimals, { maxFraction: 2 })} more test USDC on the verifier.{" "}
              <button type="button" className="link font-semibold" onClick={() => void faucet()}>
                Get 100 from the faucet
              </button>
            </>
          ) : (
            <>
              You need {formatUnits(plan.payShortfall, tokenInfo(PAY_TOKEN_ID).decimals, { maxFraction: 2 })} more USDC in your NEAR Intents balance.{" "}
              <button type="button" className="link font-semibold" onClick={() => void deposit(plan.payShortfall)}>
                Move it in from your wallet
              </button>
            </>
          )}
        </div>
      )}
      {planErr && (
        <p role="alert" className="text-sm text-down">
          {planErr}
        </p>
      )}

      {rows.some((r) => isOndoStock(r.symbol)) && (
        <p className="caption text-xs">
          {rows.filter((r) => isOndoStock(r.symbol)).map((r) => r.symbol).join(", ")} is Ondo's tokenized stock, for eligible non-US users only. Not an offer.
        </p>
      )}
      {tooSmall && (
        <p role="alert" className="text-sm font-semibold text-down">
          {minBuyMessage(snap.config.ticker, minUsd, rows)}
        </p>
      )}
      {NET.swapRoute === "oneclick" && (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">Pay from another chain</p>
          <XChainBuy coin={snap.id} ticker={snap.config.ticker} usd={payUsd} minUsd={minUsd} />
          <p className="caption pt-1 text-center text-xs">or with a NEAR wallet</p>
        </div>
      )}

      {!compact && accountId && (
        <TxSteps
          s={tx}
          steps={[
            { title: BUY_STEPS[0], detail: needsSwap ? `${snap.basket.length} assets ${NET.swapRoute === "oneclick" ? "through 1Click" : `at the ${NET.label.toLowerCase()} swapper`}` : "The basket is USDC only", skip: !needsSwap },
            { title: BUY_STEPS[1], detail: "Your first buy also registers you with the coin" },
          ]}
        />
      )}

      {accountId ? (
        <button type="submit" className="btn btn-buy btn-lg w-full text-[1.0625rem] font-bold" disabled={!q || tx.busy || planning || tooSmall}>
          {planning && !tx.busy ? "Getting ready…" : tx.busy ? (method === "guest" ? "Buying…" : "Waiting for the wallet…") : q?.queued ? "Join the fair launch" : `Buy $${snap.config.ticker}`}
        </button>
      ) : (
        // The wallet menu comes first in the DOM (keyboard and tests reach Connect first); the free try is drawn on top.
        <div className="flex flex-col gap-2.5">
          <WalletButton wide />
          {GUEST_ENABLED ? (
            <div className="order-first space-y-2">
              <TryFreeButton block className="btn-lg w-full text-[1.0625rem]" label={`Try it free: buy $${snap.config.ticker}`} note={false} />
              <p className="caption text-center text-xs">No wallet, no sign-up: a guest wallet is made in this browser with free gas and {PAY_NAME}.</p>
            </div>
          ) : (
            <div className="order-first">
              <FirstBuySteps />
            </div>
          )}
        </div>
      )}
      <TxStatus s={tx} />
      <TxStatus s={faucetTx_} />
    </form>
  );
}

type Receipt = { tokens: number; payUsd: number; floorUsd: number; queued: boolean };

/** Before connecting: what a first buy takes, so the two wallet prompts are no surprise. */
function FirstBuySteps() {
  return (
    <ol className="grid grid-cols-3 gap-1.5 text-center text-xs font-semibold text-ink-2" aria-label="Your first buy">
      {["Connect a wallet or email", NET.testTokens ? "Get free test USDC" : "Have USDC on NEAR", "Buy in two signatures"].map((t, i) => (
        <li key={t} className="flex flex-col items-center gap-1.5 rounded-[12px] bg-sunk px-1.5 py-2.5">
          <span aria-hidden className="num inline-flex size-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-card">
            {i + 1}
          </span>
          <span className="leading-tight">{t}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The moment after a buy lands: what you hold, what the floor alone pays for it today, and a link
 * to share. Drawn as an ink ticket with the floor's yellow inside it.
 */
function BuyReceipt({ r, tx, onAgain }: { r: Receipt; tx: ReturnType<typeof useTx>; onAgain: () => void }) {
  const { snap } = useCoin();
  const n = useNumbers();
  const [copied, setCopied] = useState(false);
  const t = snap.config.ticker;
  const s = splitBuy(r.payUsd, r.floorUsd);
  const url = typeof window !== "undefined" ? `${window.location.origin}/c/${snap.id}` : `/c/${snap.id}`;
  const text = `I just bought $${t}. ${Math.round(n.backing.share * 100)}% of it is backed by ${n.backedBy} in its own vault.`;
  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: `$${t}`, text, url });
        return;
      } catch {
        /* closed the share sheet: fall through to the post link */
      }
    }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <div className="slab overflow-hidden rounded-[18px]">
        <div className="p-5">
          <p className="meme text-[1.75rem] leading-none text-ink">{r.queued ? "You're in the fair launch" : "You're in"}</p>
          <p className="display mt-2 text-[2.25rem] leading-none">
            {r.queued ? "≈ " : ""}
            {fmtQty(r.tokens)}
            <span className="ml-2 text-base tracking-[-0.01em] text-ink-2">${t}</span>
          </p>
          <p className="caption mt-1.5">for {usd(r.payUsd)} of {PAY_NAME}</p>
        </div>
        <div className="border-t border-dashed border-line-2 p-5 pt-4">
          <p className="text-sm text-ink-2">The floor alone pays at least</p>
          <p className="mt-1">
            <span className="display floor-tag rise inline-block py-1 text-[1.75rem] leading-none">{usd(r.floorUsd)}</span>
          </p>
          <div className="hatch mt-4 flex h-3 overflow-hidden rounded-full" role="img" aria-label={`${usd(s.backed)} of ${usd(r.payUsd)} backed`}>
            <div className="rise h-full bg-floor" style={{ width: `${s.share * 100}%`, ["--d" as string]: "200ms" }} />
          </div>
          <p className="caption mt-2.5 text-xs">
            for these tokens today, before the fee. It is backed by {n.backedBy}, so it moves with their prices; it is not a guarantee.
          </p>
        </div>
      </div>
      <TxStatus s={tx} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-ink" onClick={() => void share()}>
          Share ${t}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => void copy()}>
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <button type="button" className="btn btn-line btn-sm w-full" onClick={onAgain}>
        Buy more
      </button>
    </div>
  );
}

function useBalance() {
  const { snap } = useCoin();
  const { accountId } = useWallet();
  return usePoll(async () => (accountId ? getReader().coin(snap.id).ftBalanceOf(accountId) : "0"), [accountId, snap.id, snap.loadedAt], 0);
}

function TokenAmountInput({ value, onChange, balance, label }: { value: string; onChange: (v: string) => void; balance?: string; label: string }) {
  const { snap } = useCoin();
  const pick = (pct: number) => {
    if (!balance) return;
    const raw = (BigInt(balance) * BigInt(pct)) / 100n;
    onChange(formatUnits(raw.toString(), 18));
  };
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{label}</span>
        {balance !== undefined && <span className="num caption">You hold {formatTokens(balance)}</span>}
      </span>
      <div className="relative mt-1.5">
        <input
          className="field num h-16 pr-24 text-[1.75rem] font-bold tracking-[-0.02em]"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">{snap.config.ticker}</span>
      </div>
      {balance !== undefined && BigInt(balance) > 0n && (
        <Presets
          label="Share of balance"
          items={[25, 50, 75, 100].map((p) => ({ label: p === 100 ? "Max" : `${p}%`, value: String(p) }))}
          onPick={(v) => pick(Number(v))}
        />
      )}
    </label>
  );
}

function parseTokens(v: string): string | null {
  try {
    const raw = parseUnits(v, 18);
    return raw > 0n ? raw.toString() : null;
  } catch {
    return null;
  }
}

function SellForm({ slip }: { slip: number }) {
  const { snap, bu, refresh } = useCoin();
  const { accountId, method } = useWallet();
  const bal = useBalance();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const raw = parseTokens(amount);
  const quote = useQuote(raw ? () => getReader().coin(snap.id).quoteSell(raw) : null, raw ?? "");
  const q: SellQuote | null = quote.data && quote.data.amount === raw ? quote.data : null;
  const tooMuch = raw !== null && bal.data !== undefined && BigInt(raw) > BigInt(bal.data);
  const floorPays = raw ? buFloatUsd(toNumber(raw, 18) * toNumber(snap.state.floor, 18), bu.e6) : 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (q) void tx.run([{ title: `Sell ${formatTokens(q.amount)} ${snap.config.ticker}`, txs: [planSell(snap.id, q, slip)] }], () => refresh());
      }}
    >
      <TokenAmountInput label="You sell" value={amount} onChange={setAmount} balance={accountId ? bal.data : undefined} />
      <div aria-live="polite" className="min-h-[5.5rem]">
        {q ? (
          <>
            <p className="caption">you get</p>
            <p className="num text-[1.625rem] font-bold leading-tight tracking-[-0.02em]">{usd(buToUsdN(q.out_bu, bu.e6))}</p>
            <p className="caption">paid in the basket assets, to your balance on the verifier</p>
            <p className="mt-2 text-sm">
              <span className="num rounded-[5px] bg-floor px-1 font-semibold text-floor-ink">the floor pays at least {usd(floorPays)}</span> for these tokens
            </p>
          </>
        ) : (
          <p className="caption py-2">{raw ? (quote.loading ? "Working it out…" : (quote.error?.message ?? "No quote")) : accountId ? "Enter how many tokens to sell" : "Connect to see what you hold"}</p>
        )}
      </div>
      {q && (
        <div className="border-t border-line pt-2">
          <Tucked summary={<span>Fee {usd(buToUsdN(q.fee, bu.e6))} · at least {usd(buToUsdN(q.out_bu, bu.e6) * (1 - slip / 10_000))}</span>}>
            <Row k="Fee" v={usd(buToUsdN(q.fee, bu.e6))} />
            <Row k="Minimum received" v={usd(buToUsdN(q.out_bu, bu.e6) * (1 - slip / 10_000))} />
            {snap.state.mode === "index" && <Row k="Paid via" v={q.path === "pool" ? "pool (pays more)" : "redeem (pays more)"} />}
            <p className="caption mt-2 text-xs">Assets you receive</p>
            <ul className="num mt-1 space-y-0.5 text-sm">
              {q.token_ids.map((t, i) => (
                <li key={t} className="flex justify-between">
                  <span className="text-ink-2">{tokenInfo(t).symbol}</span>
                  <span>{assetAmount(t, q.amounts[i] ?? "0")}</span>
                </li>
              ))}
            </ul>
          </Tucked>
        </div>
      )}
      {tooMuch && <p className="text-sm font-semibold text-down">That is more than you hold.</p>}
      {accountId ? (
        <button type="submit" className="btn btn-sell btn-lg w-full" disabled={!q || tx.busy || tooMuch}>
          {tx.busy ? (method === "guest" ? "Selling…" : "Waiting for the wallet…") : `Sell $${snap.config.ticker}`}
        </button>
      ) : (
        <WalletButton wide />
      )}
      <TxStatus s={tx} />
    </form>
  );
}

function RedeemForm() {
  const { snap, bu, rows, refresh } = useCoin();
  const { accountId } = useWallet();
  const bal = useBalance();
  const tx = useTx();
  const [amount, setAmount] = useState("");
  const raw = parseTokens(amount);
  const st = snap.state;
  // Pro-rata share of the reserve, minus the 0.5% redeem fee that stays in the vault.
  const gross = raw && BigInt(st.supply) > 0n ? (BigInt(raw) * BigInt(st.reserve)) / BigInt(st.supply) : 0n;
  const fee = (gross * BigInt(snap.config.redeem_fee_bps) + 9_999n) / 10_000n;
  const out = gross - fee;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (raw) void tx.run([{ title: `Redeem ${formatTokens(raw)} ${snap.config.ticker}`, txs: [redeemTx(snap.id, { amount: raw })] }], () => refresh());
      }}
    >
      <p className="text-sm text-ink-2">
        Burn tokens for their share of the vault, paid in the basket assets. {snap.config.redeem_fee_bps / 100}% stays in the vault for those who hold.
      </p>
      <TokenAmountInput label="You redeem" value={amount} onChange={setAmount} balance={accountId ? bal.data : undefined} />
      <div>
        <p className="caption">you get about</p>
        <p className="num text-[1.625rem] font-bold leading-tight tracking-[-0.02em]">{usd(buToUsdN(out.toString(), bu.e6))}</p>
        <ul className="num mt-2 space-y-0.5 text-sm">
          {rows.map((r) => (
            <li key={r.token_id} className="flex justify-between">
              <span className="text-ink-2">{r.symbol}</span>
              <span>{assetAmount(r.token_id, BigInt(st.b_total) > 0n ? ((BigInt(r.held) * out) / BigInt(st.b_total)).toString() : "0")}</span>
            </li>
          ))}
        </ul>
      </div>
      {accountId ? (
        <button type="submit" className="btn btn-ink btn-lg w-full" disabled={!raw || tx.busy}>
          {tx.busy ? "Waiting for the wallet…" : "Redeem for the basket"}
        </button>
      ) : (
        <WalletButton wide />
      )}
      <TxStatus s={tx} />
    </form>
  );
}

/** A dropped connection or rate limit says so in words; a contract refusal (e.g. amount too small) is shown as is. */
const NETWORKISH = /network error|failed to fetch|429|rate limit|timed? ?out|all NEAR RPC endpoints failed/i;

/** Run reads again (up to 3 tries, backing off) when they fail for network reasons. */
async function retryNetwork<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= tries || !NETWORKISH.test(e instanceof Error ? e.message : String(e))) throw e;
      await new Promise((r) => setTimeout(r, 1_500 * i));
    }
  }
}

function plainQuoteError(e: Error): string {
  return /network error|failed to fetch|429|rate limit|timed? ?out/i.test(e.message) ? "Couldn't reach NEAR for a price just now; trying again shortly." : e.message;
}
