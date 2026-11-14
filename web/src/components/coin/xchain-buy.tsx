"use client";
// Buy with USDC on Base (MetaMask) or Solana (Phantom), and sell back, without any account of ours holding funds.
// The buyer's wallet owns a NEAR Intents account (its own address). One token transfer brings USDC there; then the
// wallet signs the swaps and the buy as messages, and the coin mints into that same account. Selling is one more
// signed message, and cashing out swaps the basket back to USDC on the wallet's chain (src/lib/server/xbuy.ts).
// Every message is checked here, against limits the wallet can see, before the wallet is asked to sign it.
import { NEAR_USDC_ASSET, ONECLICK_URL, USDC_ASSET, checkOneClickDeposit, checkPayloads, intentsIdFor, sentTo, type SignedIntent } from "@backed/client";
import { useEffect, useRef, useState } from "react";
import { EXPLORER_TX, deployment } from "@/lib/config";
import { fmtMin } from "@/lib/minbuy";
import { useXWallet } from "@/lib/xwallet";
import { connectMetaMask, connectPhantom, hasMetaMask, hasPhantom, sendUsdcOnBase, sendUsdcOnSolana, signWithMetaMask, signWithPhantom } from "@/lib/xwallets";
import { ChainIcon, WalletIcon } from "../token-icon";

type Chain = "base" | "solana";
type ToSign = { kind: string; payload: string; label: string; depositAddress?: string };
type Rules = { signer: string; verifier: string; receivers: string[]; coin: string; maxSpend: Record<string, string>; latest: string };
type Order = {
  id: string;
  kind: "buy" | "sell" | "cashout";
  status: string;
  step?: string;
  error?: string;
  tokens?: string;
  txs: string[];
  intentsId: string;
  held?: string | null;
  toSign?: ToSign[];
  rules?: Rules;
};

const BUY_STEPS = ["Send USDC from your wallet", "USDC lands in your own NEAR Intents account", "Sign the swaps and the buy", "1Click fills the swaps", "The coin mints to your NEAR Intents account"];
const STAGE: Record<string, number> = { awaiting_deposit: 1, funded: 2, sign: 2, swapping: 3, executing: 4, done: 5 };

function fmtTokens(raw?: string | null): string {
  if (!raw) return "0";
  const n = Number(BigInt(raw) / 10n ** 12n) / 1e6;
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2);
}

const chainName = (c: Chain) => (c === "base" ? "Base" : "Solana");
const friendly = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return /reject|denied|cancel/i.test(m) ? "Cancelled in the wallet." : m;
};

export function XChainBuy({ coin, ticker, usd, minUsd = 0, className }: { coin: string; ticker: string; usd: number; minUsd?: number; className?: string }) {
  const below = minUsd > 0 && usd < minUsd;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [order, setOrder] = useState<Order | null>(null);
  const orderId = order?.id;
  const { xwallet: wallet, connectX } = useXWallet();
  const [holding, setHolding] = useState<string | null>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [sentTx, setSentTx] = useState<{ chain: Chain; hash: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const signing = useRef<string | null>(null);
  const [wallets, setWallets] = useState({ mm: false, ph: false });
  useEffect(() => setWallets({ mm: hasMetaMask(), ph: hasPhantom() }), []);
  // A connected wallet (header or here): show what it holds right away.
  useEffect(() => {
    if (wallet) void refreshHolding(wallet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.chain, wallet?.user]);
  // A new order: start its clock and bring its progress into view (the pay buttons sit low on the page).
  useEffect(() => {
    if (!orderId) return setStartedAt(null);
    setStartedAt(Date.now());
    requestAnimationFrame(() => statusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [orderId]);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  /** The header's wallet when it is on this chain; otherwise ask this chain's wallet to connect. */
  const connect = async (chain: Chain) => (wallet?.chain === chain ? wallet : connectX(chain));

  const refreshHolding = async (w: { chain: Chain; user: string }) => {
    try {
      const r = (await (await fetch(`/api/xbuy?coin=${encodeURIComponent(coin)}&chain=${w.chain}&user=${encodeURIComponent(w.user)}`)).json()) as {
        held?: string;
        assets?: Record<string, string>;
      };
      setHolding(r.held ?? null);
      setAssets(r.assets ?? {});
    } catch {
      setHolding(null);
    }
  };

  /**
   * Check every message, have the wallet sign them, and hand the signatures back. Returns false when nothing was
   * signed (the user said no, or a check failed), so the caller doesn't ask again on its own.
   */
  const signAll = async (o: Order, w: { chain: Chain; user: string }): Promise<boolean> => {
    if (!o.toSign || !o.rules || signing.current === o.toSign.map((t) => t.payload).join("|")) return false;
    signing.current = o.toSign.map((t) => t.payload).join("|");
    setBusy("sign");
    try {
      // Who signs, for which contract and which coin come from this page and the wallet, never from the server;
      // the spending caps cover all the messages together.
      const signer = intentsIdFor(w.chain, w.user);
      const rules = { ...o.rules, signer, verifier: deployment.verifier, coin, latest: new Date(o.rules.latest) };
      checkPayloads(
        o.toSign.map((t) => t.payload),
        rules,
      );
      // Every address a swap pays must be a real 1Click quote, asked of 1Click directly so our server can't slip in
      // an address of its own: it pays and refunds only this wallet, into a basket asset of this buy (or USDC on the
      // wallet's own chain for a cash-out), with at most 3% slippage, for at least what the message sends.
      const buy = o.toSign.find((t) => t.kind === "buy");
      const basket = buy ? Object.keys((JSON.parse(buy.payload) as { intents: { tokens: Record<string, string> }[] }).intents[0]!.tokens) : [];
      const destinations = o.kind === "cashout" ? [USDC_ASSET[w.chain]] : basket;
      const checks = o.toSign.flatMap((t) =>
        rules.receivers.filter((x) => x !== coin && t.payload.includes(`"${x}"`)).map(async (r) => {
          const res = await fetch(`${ONECLICK_URL}/v0/status?depositAddress=${encodeURIComponent(r)}`);
          if (!res.ok) throw new Error(`Refusing to sign: 1Click doesn't know the deposit address ${r.slice(0, 12)}….`);
          checkOneClickDeposit(await res.json(), { route: o.kind === "cashout" ? "cashout" : "swap", ...sentTo(t.payload, r), intentsId: signer, wallet: w.user, destinations });
        }),
      );
      await Promise.all(checks);
      const signed: SignedIntent[] = [];
      for (const t of o.toSign) {
        signed.push(w.chain === "base" ? await signWithMetaMask(w.user, t.payload) : await signWithPhantom(t.payload));
      }
      const r = await fetch(`/api/xbuy/${o.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signed }) });
      const next = (await r.json()) as Order & { error?: string };
      if (!r.ok) throw new Error(next.error ?? "Couldn't submit the signatures.");
      setOrder((cur) => ({ ...(cur ?? next), ...next }));
      return true;
    } catch (e) {
      setErr(friendly(e));
      signing.current = null;
      if (timer.current) clearInterval(timer.current);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const poll = (id: string, w: { chain: Chain; user: string }) => {
    if (timer.current) clearInterval(timer.current);
    const tick = async () => {
      try {
        const o = (await (await fetch(`/api/xbuy/${id}`)).json()) as Order;
        setOrder(o);
        if (o.status === "sign") void signAll(o, w);
        if (["done", "refunded", "error"].includes(o.status)) {
          if (timer.current) clearInterval(timer.current);
          void refreshHolding(w);
        }
      } catch {
        // keep polling
      }
    };
    void tick();
    timer.current = setInterval(tick, 4000);
  };

  const pay = async (chain: Chain) => {
    setErr(undefined);
    setOrder(null);
    setSentTx(null);
    signing.current = null;
    setBusy(chain);
    try {
      const w = await connect(chain);
      const r = await fetch("/api/xbuy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, chain, user: w.user, usd }) });
      const q = (await r.json()) as { id?: string; depositAddress: string; amount: string; token: string; decimals: number; error?: string };
      if (!r.ok || !q.id) throw new Error(q.error ?? "Couldn't start the buy.");
      // Before any USDC leaves the wallet: the deposit address must be a real 1Click quote (asked of 1Click directly)
      // that delivers this USDC into the wallet's own NEAR Intents account and refunds to the wallet on its chain.
      const st = await fetch(`${ONECLICK_URL}/v0/status?depositAddress=${encodeURIComponent(q.depositAddress)}`);
      if (!st.ok) throw new Error("Refusing to send: 1Click doesn't know this deposit address.");
      checkOneClickDeposit(await st.json(), {
        route: "deposit",
        token: USDC_ASSET[chain],
        amount: q.amount,
        intentsId: intentsIdFor(chain, w.user),
        wallet: w.user,
        destinations: [NEAR_USDC_ASSET],
      });
      const hash = chain === "base" ? await sendUsdcOnBase(w.user, q.token, q.depositAddress, BigInt(q.amount)) : await sendUsdcOnSolana(w.user, q.token, q.depositAddress, BigInt(q.amount), q.decimals);
      setSentTx({ chain, hash });
      void fetch(`/api/xbuy/${q.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash }) });
      setOrder({ id: q.id, kind: "buy", status: "awaiting_deposit", step: "Waiting for your USDC", txs: [], intentsId: "" });
      poll(q.id, w);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const startAction = async (action: "sell" | "cashout", chain?: Chain) => {
    setErr(undefined);
    signing.current = null;
    setBusy(action);
    try {
      const w = wallet ?? (chain ? await connect(chain) : null);
      if (!w) throw new Error("Connect a wallet first.");
      const r = await fetch("/api/xbuy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, coin, chain: w.chain, user: w.user, amount: "all" }) });
      const o = (await r.json()) as Order & { error?: string };
      if (!r.ok) throw new Error(o.error ?? `Couldn't start the ${action}.`);
      setSentTx(null);
      setOrder(o);
      setBusy(null);
      if (await signAll(o, w)) poll(o.id, w);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const checkHolding = async (chain: Chain) => {
    setErr(undefined);
    try {
      await refreshHolding(await connect(chain));
    } catch (e) {
      setErr(friendly(e));
    }
  };

  const hasHolding = holding !== null && BigInt(holding || "0") > 0n;
  const hasAssets = Object.keys(assets).length > 0;
  const stage = order?.kind === "buy" ? (STAGE[order.status] ?? 1) : 0;
  const working = !!order && !["done", "refunded", "error"].includes(order.status);

  return (
    <div className={className}>
      <style>{`@keyframes xb-spin{to{transform:rotate(360deg)}}.xb-spin{animation:xb-spin .9s linear infinite}
@keyframes xb-bar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.xb-bar{background:linear-gradient(90deg,transparent,#111 40%,#FFE14D 60%,transparent);width:40%;animation:xb-bar 1.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.xb-spin,.xb-bar{animation:none}}`}</style>
      {!order ? (
        <div className="grid gap-2.5">
          <PayButton onClick={() => void pay("base")} disabled={!!busy || !(usd > 0) || below} wallet="metamask" chain="base" label={busy === "base" ? "Confirm in MetaMask…" : `MetaMask · $${usd || 0} USDC on Base`} missing={!wallets.mm} />
          <PayButton onClick={() => void pay("solana")} disabled={!!busy || !(usd > 0) || below} wallet="phantom" chain="solana" label={busy === "solana" ? "Confirm in Phantom…" : `Phantom · $${usd || 0} USDC on Solana`} missing={!wallets.ph} />
          {below && <p className="text-sm font-semibold text-[#E5484D]">Smallest buy here is ${fmtMin(minUsd)}.</p>}
          <p className="text-xs leading-snug text-[color:var(--muted,#6E6E73)]">
            One USDC transfer into NEAR Intents under your own wallet&apos;s address, then you sign the swaps and the buy as messages. Your wallet
            controls the funds at every step; our account only pays NEAR gas.
          </p>
          {wallet && hasAssets && (
            <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[#F6F6F6] px-4 py-3 text-sm">
              <span>USDC or basket assets are waiting in your NEAR Intents account</span>
              <ActionPill onClick={() => void startAction("cashout")} disabled={!!busy} label={busy === "cashout" ? "Preparing…" : "Cash out"} />
            </div>
          )}
          {hasHolding && wallet ? (
            <HoldingRow ticker={ticker} held={holding} busy={busy} onSell={() => void startAction("sell")} />
          ) : (
            <p className="text-xs text-[#6E6E73]">
              Already hold ${ticker}?{" "}
              {wallets.mm && (
                <button type="button" className="font-semibold underline" onClick={() => void checkHolding("base")}>
                  Check MetaMask
                </button>
              )}
              {wallets.mm && wallets.ph && " · "}
              {wallets.ph && (
                <button type="button" className="font-semibold underline" onClick={() => void checkHolding("solana")}>
                  Check Phantom
                </button>
              )}
              {holding === "0" && " — none held by this wallet."}
            </p>
          )}
        </div>
      ) : (
        <div ref={statusRef} className="relative scroll-mt-24 overflow-hidden rounded-[18px] bg-[#F6F6F6] p-4" role="status" aria-live="polite">
          {working && <div aria-hidden className="xb-bar absolute inset-x-0 top-0 h-[3px]" />}
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">
              {order.kind === "buy" ? `Buying $${ticker}` : order.kind === "sell" ? `Selling $${ticker}` : `Cashing out to USDC on ${wallet ? chainName(wallet.chain) : "your chain"}`}
            </p>
            {working && startedAt && <Elapsed since={startedAt} />}
          </div>
          {order.kind === "buy" && (
            <ol className="grid gap-2.5">
              {BUY_STEPS.map((s, i) => {
                const done = i < stage || order.status === "done";
                const current = !done && i === stage && working;
                return (
                  <li key={s} className="flex items-center gap-2.5 text-sm">
                    <span className="relative grid size-6 shrink-0 place-items-center">
                      {current && <span aria-hidden className="xb-spin absolute inset-0 rounded-full border-2 border-[#FFE14D] border-t-[#111]" />}
                      <span
                        className={`grid size-5 place-items-center rounded-full text-[11px] font-bold ${done ? "bg-[#111] text-white" : current ? "bg-white text-[#111]" : "bg-[#E3E3E3] text-[#8E8E93]"}`}
                      >
                        {done ? "✓" : i + 1}
                      </span>
                    </span>
                    <span className={done || current ? "text-[#111]" : "text-[#8E8E93]"}>
                      {s}
                      {current && <span className="ml-1.5 text-[#6E6E73]">· {stageHint(order.status, busy === "sign")}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {working && (
            <p className="mt-3 text-xs text-[#6E6E73]">
              {friendlyStep(order.step, busy === "sign")}
              {" · "}usually about {order.kind === "buy" ? "1–2 minutes" : "a minute"}. You can leave this open; nothing moves without your signature.
            </p>
          )}
          {order.status === "sign" && order.toSign && (
            <ul className="mt-3 grid gap-1 text-xs text-[#6E6E73]">
              {order.toSign.map((t) => (
                <li key={t.payload}>✎ {t.label}</li>
              ))}
            </ul>
          )}

          {order.status === "done" && order.kind === "buy" && (
            <p className="mt-3 text-[15px]">
              <b>You&apos;re in:</b> {fmtTokens(order.tokens)} ${ticker} in NEAR Intents, under your wallet&apos;s own address.
            </p>
          )}
          {order.status === "done" && order.kind === "sell" && <p className="mt-3 text-[15px]">Sold. The basket assets are in your NEAR Intents account.</p>}
          {order.status === "done" && order.kind === "cashout" && <p className="mt-3 text-[15px]">Sent. USDC is on its way to your wallet on {wallet ? chainName(wallet.chain) : "your chain"}.</p>}
          {order.status === "refunded" && <p className="mt-3 text-sm">1Click sent your USDC back to your wallet.</p>}
          {order.status === "error" && <p className="mt-3 text-sm text-[#E5484D]">{order.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {order.status === "sign" && busy !== "sign" && wallet && (
              <ActionPill
                onClick={() => {
                  setErr(undefined);
                  poll(order.id, wallet);
                }}
                disabled={false}
                label="Sign in wallet"
              />
            )}
            {order.status === "done" && hasHolding && <ActionPill onClick={() => void startAction("sell")} disabled={!!busy} label={busy === "sell" ? "Preparing…" : `Sell all $${ticker}`} />}
            {(order.status === "error" || (order.status === "done" && order.kind !== "cashout")) && order.kind !== "sell" && hasAssets && (
              <ActionPill onClick={() => void startAction("cashout")} disabled={!!busy} label={busy === "cashout" ? "Preparing…" : "Cash out"} />
            )}
            {order.status === "done" && order.kind === "sell" && <ActionPill onClick={() => void startAction("cashout")} disabled={!!busy} label={busy === "cashout" ? "Preparing…" : `Cash out to USDC on ${wallet ? chainName(wallet.chain) : ""}`} />}
            {["done", "refunded", "error"].includes(order.status) && (
              <button type="button" className="h-9 rounded-full bg-[#ECECEC] px-4 text-sm font-semibold" onClick={() => setOrder(null)}>
                Back
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {sentTx && (
              <a className="underline" target="_blank" rel="noopener" href={sentTx.chain === "base" ? `https://basescan.org/tx/${sentTx.hash}` : `https://solscan.io/tx/${sentTx.hash}`}>
                your transfer ↗
              </a>
            )}
            {order.txs.map((h, i) => (
              <a key={h} className="underline" target="_blank" rel="noopener" href={EXPLORER_TX(h)}>
                NEAR tx {i + 1} ↗
              </a>
            ))}
          </div>
        </div>
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-[#E5484D]">
          {err}
        </p>
      )}
    </div>
  );
}

function HoldingRow({ ticker, held, busy, onSell }: { ticker: string; held: string | null; busy: string | null; onSell: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[18px] bg-[#F6F6F6] px-4 py-3 text-sm">
      <span>
        <b>{fmtTokens(held)}</b> ${ticker} in your NEAR Intents account
      </span>
      <ActionPill onClick={onSell} disabled={!!busy} label={busy === "sell" ? "Preparing…" : "Sell all"} />
    </div>
  );
}

function ActionPill({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="h-9 rounded-full bg-[#111] px-4 text-sm font-semibold text-white disabled:opacity-60">
      {label}
    </button>
  );
}

function PayButton({ onClick, disabled, wallet, chain, label, missing }: { onClick: () => void; disabled: boolean; wallet: "metamask" | "phantom"; chain: "base" | "solana"; label: string; missing: boolean }) {
  if (missing) {
    return (
      <a
        className="flex h-[52px] items-center gap-3 rounded-full bg-[#ECECEC] px-4 text-[15px] font-semibold text-[#6E6E73]"
        href={wallet === "metamask" ? "https://metamask.io/download/" : "https://phantom.com/download"}
        target="_blank"
        rel="noopener"
      >
        <WalletIcon kind={wallet} size={28} />
        Install {wallet === "metamask" ? "MetaMask" : "Phantom"} to pay from {chain === "base" ? "Base" : "Solana"}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex h-[52px] items-center gap-3 rounded-full bg-[#111] px-4 text-[15px] font-semibold text-white disabled:opacity-60">
      <span className="relative inline-flex">
        <WalletIcon kind={wallet} size={28} />
        <span className="absolute -bottom-0.5 -right-1">
          <ChainIcon chain={chain} size={13} />
        </span>
      </span>
      {label}
    </button>
  );
}

/** What the current step is waiting on, in a few words. */
function stageHint(status: string, signing: boolean): string {
  if (signing || status === "sign") return "check your wallet";
  if (status === "awaiting_deposit") return "waiting for your USDC";
  if (status === "funded") return "preparing the swaps";
  if (status === "swapping") return "1Click is filling";
  if (status === "executing") return "minting";
  return "working";
}

/** The server's step text, without retry internals (those stay in the order record). */
function friendlyStep(step: string | undefined, signing: boolean): string {
  if (signing) return "Approve the messages in your wallet";
  if (!step) return "Working";
  if (/retrying/i.test(step)) return "Taking a little longer than usual, still working";
  return step.replace(/\s*\(retrying.*$/i, "");
}

/** m:ss since the order started. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="num text-xs font-semibold tabular-nums text-[#6E6E73]">{`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`}</span>;
}
