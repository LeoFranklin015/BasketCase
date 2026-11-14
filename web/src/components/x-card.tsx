"use client";
// The X player card: what a coin link shows inside a post on X (/x/<coin>). Its own small product, not
// the site's widget: one coin, the numbers that sell it, an amount box and one button. On testnet the
// button makes a guest wallet (free gas + test USDC) and buys in one tap; a NEAR wallet works too.
// X draws the player in a small box (about 300–530 px, square or 16:9), so everything sizes off the box
// (container query units) and nothing scrolls. Only what a reader needs: the coin, its price over its
// floor, what backs it (token and chain logos), an amount and Buy. Wallet choice opens on Buy.
// Styles are scoped here, in the site's palette (DESIGN.md), so the site can change without breaking it.
import { backedPct } from "@/lib/backing";
import { faucetTx, planSell, prepareBuy, toNumber, usdToBu, type BuyPlan, type BuyQuote } from "@backed/client";
import { Inter } from "next/font/google";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BRAND, EXPLORER_TX, FAUCET_AMOUNT, NET, PAY_TOKEN_ID } from "@/lib/config";
import { getReader, swapperId, verifierId } from "@/lib/data";
import type { Trade } from "@/lib/history";
import { buFloatUsd, buToUsdN, priceUnit, usd } from "@/lib/money";
import { recordBuy } from "@/lib/mybuys";
import { GUEST_ENABLED, useWallet, type WalletMethod } from "@/lib/wallet";
import { useXWallet, type XChain } from "@/lib/xwallet";
import { hasMetaMask, hasPhantom } from "@/lib/xwallets";
import { ChainIcon, TokenIcon, WalletIcon } from "./token-icon";
import { CoinProvider, useCoin, useCoinSnapshot, useHistoryFeed, useMarket, useNumbers } from "./coin/context";
import { useTx } from "./tx";
import { XChainBuy } from "./coin/xchain-buy";
import { fmtMin, minBuyUsd } from "@/lib/minbuy";
import { isOndoStock } from "@/lib/icons";

// The card loads its own face so it never depends on what the site layout loads.
const inter = Inter({ subsets: ["latin"], variable: "--font-xc", display: "swap" });

const PRESETS = ["5", "20", "50"];
const SLIP_BPS = 100;
const MAX_USD = 1000;

export function XCard({ id }: { id: string }) {
  const q = useCoinSnapshot(id);
  const history = useHistoryFeed(id);
  return (
    <div className={`xc ${inter.variable}`}>
      <style>{CSS}</style>
      {q.data ? (
        <CoinProvider snap={q.data} refresh={q.refresh} history={history}>
          <Card />
        </CoinProvider>
      ) : (
        <div className="xc-load">
          <span className="xc-logo">{BRAND.name}</span>
          <span className="xc-dim">{q.error ? "Couldn't reach NEAR right now." : "Loading the coin…"}</span>
          {q.error && (
            <a className="xc-btn" href={`/c/${id}`} target="_blank" rel="noopener">
              Open the coin ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

type Done = { kind: "buy"; tokens: number; floorUsd: number; tx?: string } | { kind: "sell"; usd: number; tx?: string };

function Card() {
  const { snap, bu, rows, refresh } = useCoin();
  const n = useNumbers();
  const m = useMarket();
  const { accountId, connect, disconnect, ensureFunded, method, funding } = useWallet();
  const { xwallet, connectX, disconnectX } = useXWallet();
  const crossChain = NET.swapRoute === "oneclick";
  // In a post on X the card is a frame on another site, where wallet extensions can't sign. On mainnet, Buy is then
  // a plain link that opens the coin page in a new tab with the amount filled (links open even when scripts can't).
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);
  const [has, setHas] = useState({ mm: false, ph: false });
  useEffect(() => setHas({ mm: hasMetaMask(), ph: hasPhantom() }), []);
  // MetaMask or Phantom from the Connect sheet: the same wallet the site's header connects.
  const pickX = async (chain: XChain) => {
    setErr(undefined);
    // Inside a post on X the card is a frame on another site, where MetaMask and Phantom can't sign:
    // continue on the coin page in a new tab instead.
    let framed = true;
    try {
      framed = window.self !== window.top;
    } catch {
      framed = true;
    }
    if (framed) {
      window.open(`${window.location.origin}/c/${encodeURIComponent(snap.id)}?pay=${chain}&usd=${pay || 20}`, "_blank", "noopener");
      setMenu(false);
      return;
    }
    try {
      await connectX(chain);
      setMenu(false);
    } catch (e) {
      setErr(/reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled in the wallet." : plain(e));
    }
  };
  const tx = useTx();
  const [amount, setAmount] = useState("20");
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<Done | null>(null);
  const [held, setHeld] = useState<string>("0");
  const [menu, setMenu] = useState(false);
  // Opened from Buy, picking a wallet goes on into the buy; opened from Connect, it only connects.
  const [buyAfter, setBuyAfter] = useState(false);
  const pending = useRef(false);
  const busyRef = useRef(false);
  const ticker = snap.config.ticker;
  const unit = priceUnit(n.priceUsd);
  const backedPctN = backedPct(n.backing.share, n.backing.mcapUsd);
  const change = m.change?.pct;
  const pay = Number(amount);
  const minUsd = minBuyUsd(rows);
  const amountOk = pay > 0 && pay <= MAX_USD && pay >= minUsd;

  // What this account holds of the coin (for Sell).
  useEffect(() => {
    if (!accountId) return setHeld("0");
    let live = true;
    getReader()
      .coin(snap.id)
      .ftBalanceOf(accountId)
      .then((b) => live && setHeld(b))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId, snap.id, snap.loadedAt]);

  const plan = (account: string, buIn: string) =>
    prepareBuy(getReader(), { verifier: verifierId(), swapper: swapperId(), coin: snap.id, account_id: account, pay_token: PAY_TOKEN_ID, bu_in: buIn, slippage_bps: SLIP_BPS });

  const buy = async () => {
    if (!accountId || busyRef.current || !amountOk) return;
    busyRef.current = true;
    setErr(undefined);
    try {
      setStage(method === "guest" ? "Getting your free gas…" : "Getting ready…");
      await ensureFunded();
      setStage("Pricing your buy…");
      const buIn = usdToBu(amount, bu.e6);
      let p: (BuyPlan & { quote: BuyQuote }) | undefined;
      for (let i = 0; i < 4 && !p; i++) {
        try {
          p = await plan(accountId, buIn);
        } catch (e) {
          if (i === 3 || !/network|fetch|429|rate|timed? ?out/i.test(String(e))) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      }
      if (!p) throw new Error("Couldn't price the buy");
      if (BigInt(p.payShortfall) > 0n && NET.testTokens) {
        if (method === "guest") {
          // A new guest's free test USDC lands a few seconds after its gas: wait for it.
          for (let i = 0; i < 25 && BigInt(p.payShortfall) > 0n; i++) {
            setStage("Getting your free test USDC…");
            await new Promise((r) => setTimeout(r, 3000));
            // A dropped RPC request can fail the top-up; ask again every ~15 s instead of only waiting.
            if (i % 5 === 4) await ensureFunded().catch(() => undefined);
            p = await plan(accountId, buIn).catch(() => p!);
          }
        } else {
          // A NEAR wallet: one extra signature takes 100 test USDC from the faucet.
          setStage(null);
          const ok = await tx.run([{ title: "Get 100 free test USDC", txs: [faucetTx(verifierId(), { token_id: PAY_TOKEN_ID, amount: FAUCET_AMOUNT })] }]);
          if (!ok) return;
          setStage("Pricing your buy…");
          p = await plan(accountId, buIn);
        }
      }
      if (BigInt(p.payShortfall) > 0n) {
        if (NET.testTokens && funding?.state === "error") throw new Error(funding.message);
        throw new Error(NET.testTokens ? "Your test USDC hasn't landed yet. Tap Buy again in a few seconds." : "Not enough USDC in NEAR Intents.");
      }
      setStage(null);
      const pl = p;
      await tx.run(
        [
          { title: "Swap into the basket", txs: pl.step1 ? [pl.step1] : [] },
          { title: "Send the basket to the coin", txs: pl.step2 },
        ],
        (r) => {
          const got = toNumber(pl.quote.tokens_out, 18);
          recordBuy(accountId, snap.id, { tokens: pl.quote.tokens_out, bu: (BigInt(pl.quote.bu_in) - BigInt(pl.quote.unused)).toString(), ts: Date.now(), tx: r.hashes.at(-1) });
          setDone({ kind: "buy", tokens: got, floorUsd: buFloatUsd(got * toNumber(snap.state.floor, 18), bu.e6), tx: r.hashes.at(-1) });
          refresh();
        },
      );
    } catch (e) {
      setErr(plain(e));
    } finally {
      setStage(null);
      busyRef.current = false;
    }
  };

  // One tap from nothing: make the guest wallet, then buy as soon as it is connected.
  const tapBuy = async () => {
    setErr(undefined);
    if (accountId) return void buy();
    setBuyAfter(true);
    setMenu(true);
  };
  // Picking a wallet from Buy carries on into the buy once it is connected.
  const pick = async (w: WalletMethod, thenBuy = true) => {
    setMenu(false);
    setErr(undefined);
    pending.current = thenBuy;
    if (w === "guest") setStage("Making your guest wallet…");
    try {
      await connect(w);
      if (w !== "guest") setStage(null);
    } catch (e) {
      pending.current = false;
      setStage(null);
      setErr(plain(e));
    }
  };
  useEffect(() => {
    if (accountId && pending.current) {
      pending.current = false;
      void buy();
    }
    // buy reads the latest render's values; it only needs to fire when the account appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const sellAll = async () => {
    if (!accountId || busyRef.current || held === "0") return;
    busyRef.current = true;
    setErr(undefined);
    try {
      setStage("Pricing your sell…");
      const q = await getReader().coin(snap.id).quoteSell(held);
      setStage(null);
      await tx.run([{ title: `Sell ${ticker}`, txs: [planSell(snap.id, q, SLIP_BPS)] }], (r) => {
        setDone({ kind: "sell", usd: buToUsdN(q.out_bu, bu.e6), tx: r.hashes.at(-1) });
        setHeld("0");
        refresh();
      });
    } catch (e) {
      setErr(plain(e));
    } finally {
      setStage(null);
      busyRef.current = false;
    }
  };

  const busy = !!stage || tx.busy;
  const status = stage ?? (tx.busy ? stepLabel(tx.note) : null);
  const heldTokens = toNumber(held, 18);
  const tokensFor = n.priceUsd > 0 && amountOk ? pay / n.priceUsd : 0;
  const assets = rows.filter((r) => (r.share ?? 0) > 0);

  const mcap = n.backing.mcapUsd;
  const [whole, cents] = money(mcap);

  return (
    <div className="xc-card" style={{ ["--glow" as string]: `hsl(${hue(ticker)} 85% 62% / .38)` }}>
      <header className="xc-top">
        <div className="xc-titlebox">
          <h1 className="xc-title">{ticker}</h1>
          <a className="xc-sub" href={`/c/${snap.id}`} target="_blank" rel="noopener" title={`Open $${ticker} on ${BRAND.name}`}>
            {BRAND.name} · {NET.testTokens ? "NEAR testnet" : "NEAR"} <Arrow />
          </a>
        </div>
        {accountId ? (
          <button type="button" className="xc-pill" onClick={() => setMenu(true)} title={accountId} aria-label="Wallet">
            <WalletIcon kind={method === "guest" ? "guest" : method === "privy" ? "email" : "near"} size={18} />
            {short(accountId).toUpperCase()}
          </button>
        ) : xwallet ? (
          <button type="button" className="xc-pill" onClick={() => (setBuyAfter(false), setMenu(true))} title={xwallet.user} aria-label="Wallet">
            <WalletIcon kind={xwallet.chain === "base" ? "metamask" : "phantom"} size={18} />
            {short(xwallet.user).toUpperCase()}
          </button>
        ) : (
          <button
            type="button"
            className="xc-pill xc-connect"
            onClick={() => {
              setBuyAfter(false);
              setMenu(true);
            }}
          >
            Connect
          </button>
        )}
      </header>

      <div className="xc-head">
      <span className="xc-av" aria-hidden>
        <span className="xc-av-in" style={{ background: `hsl(${hue(ticker)} 70% 46%)` }}>
          {snap.config.icon ? <img src={snap.config.icon} alt="" /> : ticker.slice(0, 2)}
        </span>
        <span className="xc-av-b">
          <ChainIcon chain="near" size={26} />
        </span>
      </span>

      <div className="xc-nums">
      <p className="xc-big" aria-label={`Market cap ${usd(mcap)}`}>
        <span>
          {whole}
          <span className="xc-dec">{cents}</span>
        </span>
        {change != null && (
          <span className={change >= 0 ? "xc-chg xc-up" : "xc-chg xc-down"}>
            <Tri up={change >= 0} />
            {Math.abs(change).toFixed(1)}% <span className="xc-dim">24H</span>
          </span>
        )}
      </p>
      <p className="xc-stats">
        <span>
          {px(n.floorUsd * unit.mult).replace("$", "")} <span className="xc-dim">FLOOR / {unit.mult === 1 ? "TOKEN" : unit.mult === 1000 ? "1K" : "1M"}</span>
        </span>
        <span>
          {backedPctN === null ? <>NEW <span className="xc-dim">NO BUYS YET</span></> : <>{backedPctN}% <span className="xc-dim">BACKED</span></>}
        </span>
      </p>
      <p className="xc-back">
        <span className="xc-stack" aria-hidden>
          {assets.slice(0, 4).map((r) => (
            <TokenIcon key={r.token_id} symbol={r.symbol} size={24} chain={!NATIVE.has(r.symbol.toUpperCase())} />
          ))}
        </span>
        backed by {assets.map((r) => r.symbol).join(" + ")}
      </p>
      {assets.some((r) => isOndoStock(r.symbol)) && <p className="xc-ondo">{assets.filter((r) => isOndoStock(r.symbol)).map((r) => r.symbol).join(", ")} is Ondo's tokenized stock, for eligible non-US users only. Not an offer.</p>}
      </div>
      </div>

      <Chart trades={m.trades} buE6={bu.e6} mult={unit.mult} priceUsd={n.priceUsd} floorUsd={n.floorUsd} up={(change ?? 0) >= 0} />

      {done ? (
        <div className="xc-done" role="status">
          <p>
            {done.kind === "buy" ? (
              <>
                <b>You&apos;re in</b> {fmt(done.tokens)} ${ticker}
                <span className="xc-cap"> · floor pays at least {usd(done.floorUsd)}</span>
              </>
            ) : (
              <>
                <b>Sold</b> about {usd(done.usd)} <span className="xc-cap">back in basket assets</span>
              </>
            )}
            {done.tx && (
              <a href={EXPLORER_TX(done.tx)} target="_blank" rel="noopener" className="xc-link">
                tx <Arrow />
              </a>
            )}
          </p>
          <div className="xc-row2">
            <button type="button" className="xc-btn xc-ghost" onClick={() => setDone(null)} disabled={busy}>
              Buy more
            </button>
            {done.kind === "buy" && heldTokens > 0 && (
              <button type="button" className="xc-btn xc-sell" onClick={() => void sellAll()} disabled={busy}>
                {busy ? "Selling…" : "Sell all"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form
          className="xc-trade"
          onSubmit={(e) => {
            e.preventDefault();
            void tapBuy();
          }}
        >
          <label className="xc-in">
            <span className="xc-cur">$</span>
            <input
              inputMode="decimal"
              aria-label="Amount in dollars"
              data-testid="x-amount"
              value={amount}
              disabled={busy}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").slice(0, 7))}
            />
            <span className="xc-get">{pay > 0 && pay < minUsd ? `min $${fmtMin(minUsd)}` : tokensFor > 0 ? `≈ ${fmt(tokensFor)}` : pay > MAX_USD ? `max $${MAX_USD}` : ""}</span>
          </label>
          {framed && crossChain && !accountId ? (
            <a
              className="xc-btn"
              href={`/c/${encodeURIComponent(snap.id)}?from=x&usd=${amountOk ? pay : 20}`}
              target="_blank"
              rel="noopener"
              data-testid="x-buy"
              aria-disabled={!amountOk}
              style={{ textDecoration: "none" }}
            >
              <BuyIcon />
              Buy
            </a>
          ) : (
            <button type="submit" className="xc-btn" disabled={busy || !amountOk} data-testid="x-buy" aria-live="polite">
              {busy ? <span className="xc-busy">{status ?? "Working…"}</span> : <><BuyIcon />Buy</>}
            </button>
          )}
        </form>
      )}

      {err ? (
        <p className="xc-err" role="alert">
          {err}
        </p>
      ) : (
        <footer className="xc-foot">
          <a href={`/c/${snap.id}`} target="_blank" rel="noopener" className="xc-brand">
            {BRAND.name} <Arrow />
          </a>
          <span className="xc-net">
            <ChainIcon chain="near" size={13} />
            {NET.testTokens ? "NEAR testnet · test tokens" : "NEAR"}
          </span>
        </footer>
      )}

      {menu && (
        <div className="xc-menu" role="dialog" aria-label={accountId ? "Wallet" : "Connect a wallet"} onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="xc-sheet">
            <div className="xc-sheet-h">
              <h2>{accountId || (xwallet && !buyAfter) ? "Wallet" : crossChain && buyAfter ? `Buy $${pay || 0} of $${ticker}` : buyAfter ? "Connect to buy" : "Connect"}</h2>
              <button type="button" className="xc-x" onClick={() => setMenu(false)} aria-label="Close">
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {accountId ? (
              <>
                <p className="xc-cap xc-acc">{accountId}</p>
                <Opt
                  icon={<WalletIcon kind={method === "guest" ? "guest" : "near"} size={30} />}
                  title="Disconnect"
                  note={method === "guest" ? "Forgets this test key" : "Sign out of this wallet"}
                  onClick={() => {
                    setMenu(false);
                    void disconnect();
                  }}
                />
              </>
            ) : xwallet && !buyAfter ? (
              <>
                <p className="xc-cap xc-acc">{xwallet.user}</p>
                <Opt
                  icon={<WalletIcon kind={xwallet.chain === "base" ? "metamask" : "phantom"} size={30} />}
                  title="Disconnect"
                  note={xwallet.chain === "base" ? "MetaMask · USDC on Base" : "Phantom · USDC on Solana"}
                  onClick={() => {
                    setMenu(false);
                    disconnectX();
                  }}
                />
              </>
            ) : crossChain && buyAfter ? (
              <div className="xc-x-chain">
                <XChainBuy coin={snap.id} ticker={ticker} usd={amountOk ? pay : 0} minUsd={minUsd} />
              </div>
            ) : (
              <>
                {crossChain && (
                  <>
                    <Opt
                      icon={<WalletIcon kind="metamask" size={30} />}
                      title="MetaMask · Base"
                      note={has.mm ? "Pay with USDC on Base" : "Not found in this browser"}
                      onClick={has.mm ? () => void pickX("base") : undefined}
                      href={has.mm ? undefined : "https://metamask.io/download/"}
                    />
                    <Opt
                      icon={<WalletIcon kind="phantom" size={30} />}
                      title="Phantom · Solana"
                      note={has.ph ? "Pay with USDC on Solana" : "Not found in this browser"}
                      onClick={has.ph ? () => void pickX("solana") : undefined}
                      href={has.ph ? undefined : "https://phantom.com/download"}
                    />
                  </>
                )}
                <Opt icon={<WalletIcon kind="near" size={30} />} title="NEAR wallet" note="Meteor, HOT, MyNearWallet, Intear" onClick={() => void pick("near", buyAfter)} />
                {!crossChain && <Opt icon={<WalletIcon kind="email" size={30} />} title="Email" note="Opens the coin page" href={`/c/${snap.id}`} />}
                {GUEST_ENABLED && <Opt icon={<WalletIcon kind="guest" size={30} />} title="Test key" note="Testnet only: a key in this browser" onClick={() => void pick("guest", buyAfter)} />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Opt({ icon, title, note, onClick, href }: { icon: ReactNode; title: string; note: string; onClick?: () => void; href?: string }) {
  const body = (
    <>
      {icon}
      <span>
        <b>{title}</b>
        <span className="xc-cap">{note}</span>
      </span>
    </>
  );
  return href ? (
    <a className="xc-opt" href={href} target="_blank" rel="noopener">
      {body}
    </a>
  ) : (
    <button type="button" className="xc-opt" onClick={onClick}>
      {body}
    </button>
  );
}

function Tri({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 10 10" width="0.7em" height="0.7em" aria-hidden>
      <path d={up ? "M5 1.5L9 8.5H1z" : "M5 8.5L9 1.5H1z"} fill="currentColor" />
    </svg>
  );
}
function BuyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1.1em" height="1.1em" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
function Arrow() {
  return (
    <svg viewBox="0 0 12 12" width="0.8em" height="0.8em" aria-hidden>
      <path d="M3.5 8.5l5-5M4.5 3.5h4v4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** "Step 1 of 2: Swap into the basket" → "Swapping into the basket · 1/2". */
function stepLabel(note?: string): string {
  const m = /^Step (\d) of (\d): (.*)$/.exec(note ?? "");
  if (!m) return note ?? "Sending…";
  const verb = m[3]!.replace(/^Swap/, "Swapping").replace(/^Send/, "Sending").replace(/^Get/, "Getting");
  return `${verb} · ${m[1]}/${m[2]}`;
}

/** Price over its floor across the latest trades: a soft line (green when up, red when down) above the dashed yellow floor. */
function Chart({ trades, buE6, mult, priceUsd, floorUsd, up }: { trades: Trade[]; buE6: number; mult: number; priceUsd: number; floorUsd: number; up: boolean }) {
  const data = useMemo(() => {
    const k = (buE6 / 1e6) * mult;
    const pts = trades
      .filter((t) => t.price != null && t.floor != null)
      .sort((a, b) => a.ts - b.ts || a.seq - b.seq)
      .slice(-120)
      .map((t) => ({ p: t.price! * k, f: t.floor! * k }));
    if (pts.length) pts.push({ p: priceUsd * mult, f: floorUsd * mult });
    return pts;
  }, [trades, buE6, mult, priceUsd, floorUsd]);
  if (data.length < 3) return <div className="xc-chart" aria-hidden />;
  const line = up ? "#2DBE60" : "#E5484D";
  const hi = Math.max(...data.map((d) => d.p));
  const lo = Math.min(...data.map((d) => d.f));
  const top = hi + (hi - lo) * 0.15;
  const bot = Math.max(0, lo - (hi - lo) * 0.6);
  const X = (i: number) => (i / (data.length - 1)) * 100;
  const Y = (v: number) => ((top - v) / (top - bot || 1)) * 100;
  const pL = data.map((d, i) => `${i ? "L" : "M"}${X(i).toFixed(2)},${Y(d.p).toFixed(2)}`).join("");
  const fL = data.map((d, i) => (i ? `H${X(i).toFixed(2)}V${Y(d.f).toFixed(2)}` : `M0,${Y(d.f).toFixed(2)}`)).join("");
  return (
    <div className="xc-chart" role="img" aria-label={`Price above its floor over the last ${data.length - 1} trades`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="xc-pg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={line} stopOpacity=".14" />
            <stop offset="1" stopColor={line} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${pL}L100,100L0,100Z`} fill="url(#xc-pg)" />
        <path d={`${fL}V100H0Z`} fill="#FFE14D" fillOpacity=".3" />
        <path d={fL} fill="none" stroke="#E0B400" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={pL} fill="none" stroke={line} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function plain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/network|fetch|429|rate limit|timed? ?out/i.test(m)) return "NEAR is busy right now. Tap Buy again.";
  if (/reject|cancel|denied|closed/i.test(m)) return "Cancelled in the wallet.";
  return m.length > 120 ? m.slice(0, 120) + "…" : m;
}
/** "$560" and ".92": the cents are drawn grey, like a wallet balance. */
function money(v: number): [string, string] {
  const t = usd(v);
  const i = t.lastIndexOf(".");
  return i > 0 ? [t.slice(0, i), t.slice(i)] : [t, ""];
}
/** Three significant figures below $1, so a price and its floor stay tellable apart ($0.0112 vs $0.0108). */
function px(v: number): string {
  if (!(v > 0)) return "$0";
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toPrecision(3)}`;
}
/** A token that is its own chain's coin (BTC on Bitcoin) gets no chain badge; others show where they come from. */
const NATIVE = new Set(["BTC", "ETH", "SOL", "DOGE", "NEAR", "WNEAR"]);
function fmt(x: number): string {
  if (x >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "K";
  return x.toFixed(2);
}
function hue(t: string): number {
  let h = 0;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function short(a: string): string {
  return a.length > 14 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a;
}

// Sizes in cqmin: a share of the box's smaller side, so the card fills X's box at any size.
// The site's board world (web/DESIGN.md): near-black neutrals, floor yellow #FFD400 as the one accent, Archivo wide for display.
const CSS = `
html,body{background:#F6F6F6;margin:0;height:100%;overflow:hidden}
.xc{position:fixed;inset:0;container-type:size;background:#F6F6F6;color:#111111;font-family:var(--font-xc),ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.xc *{box-sizing:border-box;margin:0}
.xc a{color:inherit;text-decoration:none}
.xc ::selection{background:#FFE14D;color:#111111}
.xc :focus-visible{outline:2px solid #111111;outline-offset:2px}
.xc-load{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3cqmin}
.xc-card{position:relative;height:100%;display:flex;flex-direction:column;padding:6.6cqmin 6.6cqmin 6cqmin;overflow:hidden;isolation:isolate}
.xc-card::before{content:"";position:absolute;z-index:-1;left:50%;top:-50cqmin;width:150cqmin;height:100cqmin;transform:translateX(-50%);background:radial-gradient(closest-side,var(--glow),transparent)}
.xc-top{display:flex;align-items:center;justify-content:space-between;gap:3cqmin}
.xc-title{font:700 4.4cqmin/1 var(--font-xc),sans-serif;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xc-pill{display:inline-flex;align-items:center;gap:1.4cqmin;height:6.4cqmin;padding:0 2.6cqmin;border-radius:99px;background:#ECECEC;border:0;font:500 2.6cqmin/1 var(--font-xc),sans-serif;letter-spacing:.02em;color:#111111;cursor:pointer;white-space:nowrap}
.xc-pill:hover{background:#E3E3E3}
.xc-connect{background:#111111;color:#FFFFFF;font-weight:600;letter-spacing:0;font-size:3cqmin;padding:0 3.4cqmin;height:7cqmin}
.xc-connect:hover{background:#2A2A2A}
.xc-titlebox{display:flex;flex-direction:column;gap:1cqmin;min-width:0}
.xc-sub{display:inline-flex;align-items:center;gap:.8cqmin;font:500 2.5cqmin/1 var(--font-xc),sans-serif;color:#6E6E73;letter-spacing:.02em}
.xc-head{display:flex;align-items:center;gap:4.4cqmin;margin-top:5cqmin}
.xc-nums{min-width:0}
.xc-av{position:relative;display:block;width:18.5cqmin;height:18.5cqmin;flex:none}
.xc-chart{position:relative;flex:1;min-height:12cqmin;margin:4cqmin -6.6cqmin 0}
.xc-chart svg{position:absolute;inset:0;width:100%;height:100%}
.xc-av-in{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;overflow:hidden;color:#FFFFFF;font:800 6.6cqmin/1 var(--font-xc),sans-serif;letter-spacing:-.04em}
.xc-av-in img{width:100%;height:100%;object-fit:cover}
.xc-av-b{position:absolute;right:-.6cqmin;bottom:-.2cqmin;display:grid;border-radius:50%;box-shadow:0 0 0 .7cqmin #F6F6F6}
.xc-av-b img{width:5.2cqmin!important;height:5.2cqmin!important}
.xc-big{display:flex;align-items:baseline;flex-wrap:wrap;column-gap:2.4cqmin;margin-top:0;font:700 8.6cqmin/1.1 var(--font-xc),sans-serif;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.xc-dec{color:#8E8E93}
.xc-chg{display:inline-flex;align-items:center;gap:.6cqmin;font:500 3cqmin/1 var(--font-xc),sans-serif;letter-spacing:0}
.xc-up{color:#1E9E4A}.xc-down{color:#E5484D}
.xc-dim{color:#8E8E93}
.xc-stats{display:flex;gap:4.4cqmin;margin-top:2cqmin;font:500 2.9cqmin/1 var(--font-xc),sans-serif;letter-spacing:.02em;font-variant-numeric:tabular-nums}
.xc-back{display:flex;align-items:center;gap:1.6cqmin;margin-top:2.8cqmin;font:400 2.7cqmin/1 var(--font-xc),sans-serif;color:#6E6E73}
.xc-ondo{margin-top:1.4cqmin;font:400 2.3cqmin/1.3 var(--font-xc),sans-serif;color:#8E8E93}
.xc-stack{display:inline-flex}
.xc-stack > *{margin-right:-1.4cqmin;border-radius:50%;box-shadow:0 0 0 .45cqmin #F6F6F6}
.xc-stack > *:last-child{margin-right:0}
.xc-trade{display:grid;grid-template-columns:1fr 1.25fr;gap:2.4cqmin;margin-top:4cqmin}
.xc-in{display:flex;align-items:center;gap:1.2cqmin;height:11.6cqmin;padding:0 4cqmin;border-radius:99px;background:#ECECEC;cursor:text;min-width:0;transition:box-shadow .15s}
.xc-in:focus-within{box-shadow:0 0 0 .5cqmin #111111}
.xc-cur{font:500 3.6cqmin/1 var(--font-xc),sans-serif;color:#8E8E93}
.xc-in input{all:unset;flex:1;min-width:0;width:100%;font:600 3.8cqmin/1 var(--font-xc),sans-serif;color:#111111;font-variant-numeric:tabular-nums;caret-color:#111111}
.xc-get{font:500 2.5cqmin/1 var(--font-xc),sans-serif;color:#8E8E93;white-space:nowrap;font-variant-numeric:tabular-nums}
.xc-btn{display:inline-flex;align-items:center;justify-content:center;gap:1.8cqmin;height:11.6cqmin;padding:0 3cqmin;border-radius:99px;border:0;background:#111111;color:#FFFFFF;
  font:600 3.4cqmin/1 var(--font-xc),sans-serif;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .15s,transform .1s}
.xc-btn:hover{background:#2A2A2A}
.xc-btn:active{transform:scale(.98)}
.xc-btn:disabled{cursor:default;background:#3A3A3C}
.xc-busy{font:500 2.7cqmin/1.2 var(--font-xc),sans-serif}
.xc-ghost{background:#ECECEC;color:#111111}
.xc-ghost:hover{background:#E3E3E3}
.xc-sell{background:#ECECEC;color:#E5484D}
.xc-sell:hover{background:#E3E3E3}
.xc-done{margin-top:4cqmin;display:flex;flex-direction:column;gap:2.4cqmin}
.xc-done p{font:400 3cqmin/1.4 var(--font-xc),sans-serif;color:#111111}
.xc-done b{font-weight:700;margin-right:.8cqmin}
.xc-done .xc-cap{color:#6E6E73}
.xc-row2{display:grid;grid-template-columns:1fr 1fr;gap:2.4cqmin}
.xc-link{display:inline-flex;align-items:center;gap:.6cqmin;margin-left:1.4cqmin;font-weight:600;text-decoration:underline;text-underline-offset:.6cqmin}
.xc-foot{display:none}
.xc-brand{display:inline-flex;align-items:center;gap:.8cqmin}
.xc-err{margin-top:2.4cqmin;text-align:center;color:#E5484D;font:500 2.7cqmin/1.3 var(--font-xc),sans-serif}
.xc-logo{font:800 8cqmin/1 var(--font-xc),sans-serif;letter-spacing:-.04em}
.xc-dim{color:#8E8E93}
.xc-menu{position:absolute;inset:0;background:rgba(17,17,17,.28);display:flex;align-items:flex-end;z-index:5;animation:xc-fade .18s ease-out}
.xc-sheet{width:100%;background:#FFFFFF;border-radius:6cqmin 6cqmin 0 0;padding:5cqmin 5.6cqmin 6cqmin;display:flex;flex-direction:column;gap:2cqmin;box-shadow:0 -8px 30px rgba(0,0,0,.08);
  animation:xc-up .28s cubic-bezier(.16,1,.3,1)}
.xc-sheet-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:1cqmin}
.xc-sheet-h h2{font:700 4.4cqmin/1 var(--font-xc),sans-serif;letter-spacing:-.02em}
.xc-x{display:grid;place-items:center;width:8.4cqmin;height:8.4cqmin;border-radius:50%;background:#ECECEC;border:0;color:#111111;cursor:pointer}
.xc-x-chain{font-size:3cqmin}
.xc-acc{word-break:break-all;color:#6E6E73;font-size:2.6cqmin}
.xc-opt{display:flex;align-items:center;gap:3cqmin;text-align:left;background:#F6F6F6;border:0;border-radius:4cqmin;padding:3cqmin 3.4cqmin;cursor:pointer;color:#111111;
  font-family:var(--font-xc),sans-serif;transition:background .15s}
.xc-opt:hover{background:#ECECEC}
.xc-opt b{display:block;font-size:3.4cqmin;font-weight:600}
.xc-opt .xc-cap{display:block;margin-top:.6cqmin;font-size:2.6cqmin;color:#6E6E73}
@keyframes xc-fade{from{opacity:0}}
@keyframes xc-up{from{transform:translateY(30%)}}
@media (prefers-reduced-motion:reduce){.xc-menu,.xc-sheet{animation:none}.xc-btn{transition:none}}
@container (min-aspect-ratio: 13/10){
  .xc-card{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto 1fr auto;column-gap:5cqmin;padding:5cqmin 6cqmin}
  .xc-top{grid-column:1 / -1}
  .xc-head{grid-column:1;grid-row:2;align-self:center;margin-top:0;flex-direction:column;align-items:flex-start;gap:3cqmin}
  .xc-chart{grid-column:2;grid-row:2;margin:2cqmin -6cqmin 0 0}
  .xc-trade,.xc-done,.xc-err{grid-column:1 / -1;grid-row:3;margin-top:3cqmin}
}
`;
