"use client";

import { claimFeesTx, faucetTx, floorPctOfCost, formatTokens, formatUnits, settleLaunchTx, withdrawOwedTx } from "@backed/client";
import { useEffect, useState } from "react";
import { BUYS_EVENT, FAUCET_AMOUNT, NET, PAY_TOKEN_ID, tokenInfo } from "@/lib/config";
import { getReader, verifierId } from "@/lib/data";
import { useNow, usePoll } from "@/lib/hooks";
import { assetAmount, buToUsdN, priceToUsd, usd } from "@/lib/money";
import { clearBuys, readBuys, type StoredBuy } from "@/lib/mybuys";
import { useWallet } from "@/lib/wallet";
import { TxStatus, useTx } from "../tx";
import { Avatar, fill } from "../coin-bits";
import { countdown } from "../ui";
import { displayName } from "@/lib/avatar";
import { WalletButton } from "../wallet-button";
import { useCoin } from "./context";

/** Fair-launch window: countdown, queue and settle. */
export function LaunchPanel() {
  const { snap, bu, refresh } = useCoin();
  const { accountId } = useWallet();
  const now = useNow(1000);
  const tx = useTx();
  const l = snap.state.launch;
  const queue = usePoll(() => getReader().coin(snap.id).getLaunchQueue(0, 8), [snap.id, snap.loadedAt], 0);
  if (snap.state.mode !== "launch") return null;
  const open = now === 0 || now < l.ends_ms;

  const elapsed = now > 0 ? Math.min(1, Math.max(0, (now - snap.config.launch_ms) / Math.max(1, l.ends_ms - snap.config.launch_ms))) : 0;
  return (
    <section className="card overflow-hidden" aria-labelledby="launch-h">
      <div className="h-1.5 bg-line">
        <div className="anim-w h-full w-full bg-ink" style={fill(elapsed * 100)} />
      </div>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="launch-h" className="h2">
            Fair launch
          </h2>
          <span className="num text-lg font-bold" aria-live="polite">
            {now === 0 ? "" : open ? countdown(l.ends_ms - now) : l.settled ? "settled" : "closed"}
          </span>
        </div>
        <p className="caption mt-1">
          Buys in the window are queued. When it closes, the whole queue is priced as one buy, so everyone pays the same price. Being first gains nothing.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <dt className="caption text-xs">In the queue</dt>
            <dd className="num text-xl font-bold">{l.queued_accounts} buyers</dd>
          </div>
          <div>
            <dt className="caption text-xs">Deposited</dt>
            <dd className="num text-xl font-bold">{usd(buToUsdN(l.queued_bu, bu.e6))}</dd>
          </div>
        </dl>
        {queue.data && queue.data.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-sm">
            {queue.data.map((q) => (
              <li key={q.account_id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar account={q.account_id} size={22} />
                  <span className="truncate font-medium">{displayName(q.account_id)}</span>
                </span>
                <span className="num text-ink-2">{usd(buToUsdN(q.bu, bu.e6))}</span>
              </li>
            ))}
          </ul>
        )}
        {!open && !l.settled && (
          <div className="mt-4 space-y-2">
            <p className="text-sm">The window has closed. Anyone can settle the queue; it mints in batches of 25 buyers per call.</p>
            {accountId ? (
              <button type="button" className="btn btn-ink btn-sm" disabled={tx.busy} onClick={() => void tx.run([{ title: "Settle the fair launch", txs: [settleLaunchTx(snap.id, 25)] }], () => refresh())}>
                Settle the queue
              </button>
            ) : (
              <WalletButton />
            )}
            <TxStatus s={tx} />
          </div>
        )}
      </div>
    </section>
  );
}

function useBuys(account: string | null, coin: string): StoredBuy[] {
  const [buys, setBuys] = useState<StoredBuy[]>([]);
  useEffect(() => {
    const load = () => setBuys(account ? readBuys(account, coin) : []);
    load();
    window.addEventListener(BUYS_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(BUYS_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, [account, coin]);
  return buys;
}

/** The connected account's balance, its value at the floor, and floor as % of cost. */
export function PositionPanel({ hideWhenSignedOut }: { hideWhenSignedOut?: boolean }) {
  const { snap, bu, refresh } = useCoin();
  const { accountId } = useWallet();
  const tx = useTx();
  const buys = useBuys(accountId, snap.id);
  const ids = [PAY_TOKEN_ID, ...snap.basket.map((b) => b.token_id).filter((t) => t !== PAY_TOKEN_ID)];
  const data = usePoll(
    async () => {
      if (!accountId) return null;
      const r = getReader();
      const c = r.coin(snap.id);
      const [balance, owed, assets] = await Promise.all([
        c.ftBalanceOf(accountId),
        c.getOwed(accountId).catch(() => []),
        r.verifier.mtBatchBalanceOf(accountId, ids).catch(() => ids.map(() => "0")),
      ]);
      return { balance, owed, assets };
    },
    [accountId, snap.id, snap.loadedAt],
    0,
  );

  if (!accountId) {
    if (hideWhenSignedOut) return null;
    return (
      <section className="card flex items-center justify-between gap-3 p-5" aria-label="Your position">
        <p className="caption">Connect a {NET.chain} wallet to trade, burn and see what you hold.</p>
        <WalletButton />
      </section>
    );
  }

  const d = data.data;
  const pct = floorPctOfCost(buys, snap.state.floor);
  const isCreator = accountId === snap.config.creator;

  const balN = d ? Number(formatUnits(d.balance, 18)) : 0;
  return (
    <section className="card p-5" aria-labelledby="pos-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="pos-h" className="h2">
          Your bag
        </h2>
        {d && (
          <span className="num text-sm font-semibold text-ink-2">
            {formatTokens(d.balance)} {snap.config.ticker}
          </span>
        )}
      </div>
      {d ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="caption text-xs">Worth at the price</dt>
              <dd className="num text-xl font-bold">{usd(priceToUsd(snap.state.price, bu.e6) * balN)}</dd>
            </div>
            <div>
              <dt className="caption text-xs">The floor pays at least</dt>
              <dd className="num text-xl font-bold">
                <span className="rounded-[6px] bg-floor px-1.5 text-floor-ink">{usd(priceToUsd(snap.state.floor, bu.e6) * balN)}</span>
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm font-semibold">Floor as % of what you paid</p>
            <p className="num text-lg font-bold">{pct === null ? "–" : `${pct.toFixed(1)}%`}</p>
          </div>
          <p className="caption mt-0.5 text-xs">
            {pct === null ? (
              "No buys recorded in this browser yet."
            ) : (
              <>
                What the floor pays for the {buys.length} buy{buys.length > 1 ? "s" : ""} you made from this browser, against what you paid (quoted amounts, fees
                included). Other devices, transfers and sells aren&apos;t counted.{" "}
                <button type="button" className="link" onClick={() => clearBuys(accountId, snap.id)}>
                  Reset
                </button>
              </>
            )}
          </p>

          {d.owed.length > 0 && (
            <div className="mt-3 rounded-[14px] bg-down-soft px-3.5 py-3 text-sm">
              <p className="font-semibold">A payout to you failed and is held for you:</p>
              <ul className="num">
                {d.owed.map((o) => (
                  <li key={o.token_id}>
                    {assetAmount(o.token_id, o.amount)} {tokenInfo(o.token_id).symbol}
                  </li>
                ))}
              </ul>
              <button type="button" className="btn btn-line btn-xs mt-2" onClick={() => void tx.run([{ title: "Retry owed payouts", txs: [withdrawOwedTx(snap.id, accountId)] }], refresh)}>
                Withdraw
              </button>
            </div>
          )}

          <details className="group mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">Your balances on the verifier</summary>
            <ul className="num mt-2 space-y-0.5 text-sm">
              {ids.map((t, i) => (
                <li key={t} className="flex justify-between">
                  <span className="text-ink-2">{tokenInfo(t).symbol}</span>
                  <span>{assetAmount(t, d.assets[i] ?? "0")}</span>
                </li>
              ))}
            </ul>
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            {NET.testTokens && (
              <button
                type="button"
                className="btn btn-quiet btn-xs"
                disabled={tx.busy}
                onClick={() => void tx.run([{ title: "Get 100 test USDC from the faucet", txs: [faucetTx(verifierId(), { token_id: PAY_TOKEN_ID, amount: FAUCET_AMOUNT })] }], refresh)}
              >
                Get 100 test USDC
              </button>
            )}
            {isCreator && (
              <button type="button" className="btn btn-quiet btn-xs" disabled={tx.busy} onClick={() => void tx.run([{ title: "Claim creator fees", txs: [claimFeesTx(snap.id)] }], refresh)}>
                Claim fees ({usd(buToUsdN(snap.state.creator_owed, bu.e6))})
              </button>
            )}
          </div>
          <div className="mt-2">
            <TxStatus s={tx} />
          </div>
        </>
      ) : (
        <p className="caption mt-2">{data.error ? data.error.message : "Loading…"}</p>
      )}
    </section>
  );
}
