"use client";

import { burnValueBu, challengeTx, closeEpochTx, defendTx, epochStandings, formatTokens, parseUnits, tokensForBurnValue } from "@backed/client";
import { useState } from "react";
import { NET, deployment, tokenInfo } from "@/lib/config";
import { useNow } from "@/lib/hooks";
import { buToUsdN, usd } from "@/lib/money";
import { useWallet } from "@/lib/wallet";
import { displayName } from "@/lib/avatar";
import { fill } from "../coin-bits";
import { IconFlame, IconShield } from "../icons";
import { TxStatus, useTx } from "../tx";
import { countdown, cx, Tabs } from "../ui";
import { WalletButton } from "../wallet-button";
import { useCoin } from "./context";
import { TokenIcon } from "../token-icon";

/** Who leads each seat this epoch (challenge vs defense vs minimum), and the burn form. */
export function RitualPanel({ compact }: { compact?: boolean }) {
  const { snap, bu, refresh } = useCoin();
  const now = useNow(1000);
  const closeTx = useTx();
  const { epoch, state, config } = snap;
  const standings = epochStandings(epoch);
  const ended = now > 0 && now >= epoch.end_ms;
  const targets = snap.basket.filter((b) => !b.anchored && BigInt(b.held) > 0n);
  const fresh = (token_id: string) => {
    const r = snap.reports.find((p) => p.token_id === token_id);
    return now > 0 && !!r && now - r.ts_ms <= config.staleness_ms;
  };
  const winner = standings.winner;
  const winnerFresh = winner ? fresh(winner.target) && fresh(winner.replacement) : false;
  const elapsed = now > 0 ? Math.min(1, Math.max(0, (now - epoch.start_ms) / Math.max(1, epoch.end_ms - epoch.start_ms))) : 0;
  const contested = (t: (typeof standings.targets)[number]) => t.challenges.length > 0 || BigInt(t.defense) > 0n;
  const rowsShown = standings.targets.filter((t) => targets.some((b) => b.token_id === t.target) && contested(t));
  // Open seats nobody has burned for this epoch show as one line with the minimum.
  const untouched = targets.filter((b) => !rowsShown.some((t) => t.target === b.token_id) && snap.epoch.min_burn.some((m) => m.target === b.token_id));
  const minOf = (target: string) => snap.epoch.min_burn.find((m) => m.target === target)?.min_bu ?? "0";
  const usdOf = (v: string) => usd(buToUsdN(v, bu.e6));

  // Every open seat gets a row: contested ones first.
  const seats = [
    ...rowsShown,
    ...untouched.map((b) => ({ target: b.token_id, challenges: [] as (typeof standings.targets)[number]["challenges"], defense: "0", min_bu: minOf(b.token_id), leaderWins: false })),
  ];

  return (
    <section className="slab" aria-labelledby="ritual-h">
      <header className="flex items-start justify-between gap-4 px-5 pt-6 sm:px-7 sm:pt-7">
        <div className="min-w-0">
          <h2 id="ritual-h" className="h-section">
            The fight over the basket
          </h2>
          {!compact && (
            <p className="mt-2 max-w-xl text-[15px] leading-snug text-ink-2">
              Each round, holders burn tokens to swap an asset out (challenge) or keep it (defend). Burns are never refunded, and every burn raises the floor
              for everyone who holds.
            </p>
          )}
        </div>
        <div className="shrink-0 text-right" aria-live="polite">
          <p className={cx("display text-[1.75rem] leading-none sm:text-[2.25rem]", ended && "rounded-[6px] bg-floor-soft px-1.5 text-[1.25rem] text-ink sm:text-[1.5rem]")}>{now === 0 ? "…" : ended ? "round over" : countdown(epoch.end_ms - now)}</p>
          <p className="caption mt-1.5 text-xs">{ended ? `round ${epoch.index}` : `left in round ${epoch.index}`}</p>
        </div>
      </header>
      <div className="mx-5 mt-5 h-1.5 overflow-hidden rounded-full bg-line sm:mx-7" role="progressbar" aria-label="Round elapsed" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed * 100)}>
        <div className="anim-w h-full w-full bg-ink" style={fill(elapsed * 100, "left", 999)} />
      </div>
      <div className={compact ? "p-4" : "p-5 sm:p-7"}>
        {state.auction_open && <p className="mb-3 rounded-[14px] bg-floor-soft px-3.5 py-2.5 text-sm">A swap auction is open. A new one can&apos;t open until it fills.</p>}

        <ul className="space-y-5">
          {seats.map((t) => {
            const lead = t.challenges[0];
            const leadBu = BigInt(lead?.burned_bu ?? "0");
            const def = BigInt(t.defense);
            const min = BigInt(t.min_bu);
            const need = lead ? [def + 1n - leadBu, min - leadBu, 0n].reduce((m, v) => (v > m ? v : m), 0n) : min;
            const sym = tokenInfo(t.target).symbol;
            const into = lead ? tokenInfo(lead.replacement).symbol : null;
            return (
              <li key={t.target} data-testid="seat">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2 text-base font-bold">
                    <TokenIcon symbol={sym} size={18} chain />
                    {sym}
                  </span>
                  <span className={cx("text-sm font-semibold", !lead ? "text-muted" : t.leaderWins ? "text-ink" : "text-ink-2")}>
                    {!lead ? "nobody is challenging" : t.leaderWins ? `swap to ${into} is winning` : "defense holds"}
                  </span>
                </div>
                <TugOfWar challenge={leadBu} defense={def} min={min} challengeLabel={usdOf(leadBu.toString())} defenseLabel={usdOf(t.defense)} />
                <p className="caption mt-2 text-sm">
                  {lead ? (
                    <>
                      If the challenge wins, the vault sells its {sym} for {into} in an auction and {sym} goes to the graveyard.{" "}
                      {need > 0n ? `It needs ${usdOf(need.toString())} more in burns.` : "Right now it would win."}
                      {!compact && <> Led by {displayName(lead.top_challenger)}.</>}
                    </>
                  ) : (
                    <>A challenge to swap {sym} out needs at least {usdOf(t.min_bu)} in burns this round.</>
                  )}
                </p>
                {!compact && t.challenges.length > 1 && (
                  <p className="caption mt-1 text-xs">
                    Also:{" "}
                    {t.challenges
                      .slice(1, 4)
                      .map((c) => `to ${tokenInfo(c.replacement).symbol} ${usdOf(c.burned_bu)}`)
                      .join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
          {targets.length === 0 && <li className="caption">Every asset in this basket is anchored, so there is nothing to challenge.</li>}
        </ul>

        {winner && !compact && (
          <p className="caption mt-4 text-xs">
            {winnerFresh
              ? "The price reporter has fresh prices for both assets, so a win would open a swap auction."
              : `No fresh reporter price for ${[winner.target, winner.replacement]
                  .filter((x) => !fresh(x))
                  .map((x) => tokenInfo(x).symbol)
                  .join(" and ")}: a win would be recorded without a swap.`}
          </p>
        )}

        {ended && (
          <div className="mt-5 space-y-2.5 rounded-[14px] bg-floor-soft p-4">
            <p className="text-sm">This round is over. Anyone can close it: the result is applied and the next round starts.</p>
            <CloseButton tx={closeTx} onClick={() => void closeTx.run([{ title: "Close the round", txs: [closeEpochTx(snap.id)] }], () => refresh())} />
          </div>
        )}

        {targets.length > 0 && <BurnForm compact={compact} />}
      </div>
    </section>
  );
}

/**
 * One seat as a rope: challenge burns pull from the left, defense burns from the right. The dashed
 * mark is the minimum a challenge must reach.
 */
function TugOfWar({ challenge, defense, min, challengeLabel, defenseLabel }: { challenge: bigint; defense: bigint; min: bigint; challengeLabel: string; defenseLabel: string }) {
  const total = challenge + defense;
  const scale = [total, min + defense, 1n].reduce((m, v) => (v > m ? v : m), 0n);
  const pct = (v: bigint) => Number((v * 10_000n) / ((scale * 11n) / 10n || 1n)) / 100;
  return (
    <div className="mt-2.5">
      <div className="relative h-3.5 rounded-full bg-line">
        <span className="anim-w absolute inset-0 bg-ink" style={fill(pct(challenge), "left", 999)} />
        <span className="anim-w absolute inset-0 bg-line-2" style={fill(pct(defense), "right", 999)} />
        <span aria-hidden className="absolute -inset-y-1 border-l-2 border-dashed border-ink" style={{ left: `${pct(min)}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <IconFlame size={14} />
          <span className="text-muted">challenge</span>
          <span className="num font-semibold">{challengeLabel}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="num font-semibold">{defenseLabel}</span>
          <span className="text-muted">defense</span>
          <IconShield size={14} />
        </span>
      </div>
    </div>
  );
}

function CloseButton({ tx, onClick }: { tx: ReturnType<typeof useTx>; onClick: () => void }) {
  const { accountId } = useWallet();
  return (
    <>
      {accountId ? (
        <button type="button" className="btn btn-ink btn-sm" disabled={tx.busy} onClick={onClick}>
          Close round
        </button>
      ) : (
        <WalletButton />
      )}
      <TxStatus s={tx} />
    </>
  );
}

function BurnForm({ compact }: { compact?: boolean }) {
  const { snap, bu, refresh } = useCoin();
  const { accountId } = useWallet();
  const tx = useTx();
  const targets = snap.basket.filter((b) => !b.anchored && BigInt(b.held) > 0n);
  const [kind, setKind] = useState<"challenge" | "defend">("challenge");
  const [target, setTarget] = useState(targets[0]?.token_id ?? "");
  const candidates = deployment.tokens.filter((t) => !snap.basket.some((b) => b.token_id === t.token_id));
  const [replacement, setReplacement] = useState(candidates[0]?.token_id ?? "");
  const [custom, setCustom] = useState("");
  const [amount, setAmount] = useState("");

  const repl = replacement === "__custom" ? custom.trim() : replacement;
  let raw: string | null = null;
  try {
    const v = parseUnits(amount || "0", 18);
    raw = v > 0n ? v.toString() : null;
  } catch {
    raw = null;
  }
  const curve = { x0: snap.config.x0, y0: snap.config.y0 };
  const value = raw ? burnValueBu(snap.state, curve, raw) : "0";
  const minBu = snap.epoch.min_burn.find((m) => m.target === target)?.min_bu ?? "0";
  let minTokens: string | null = null;
  try {
    minTokens = tokensForBurnValue(snap.state, curve, minBu);
  } catch {
    minTokens = null;
  }
  const valid = !!raw && !!target && (kind === "defend" || (!!repl && !snap.basket.some((b) => b.token_id === repl)));

  const submit = () => {
    if (!raw || !valid) return;
    const t = kind === "challenge" ? challengeTx(snap.id, { target, replacement: repl, amount: raw }) : defendTx(snap.id, { target, amount: raw });
    void tx.run([{ title: `${kind === "challenge" ? "Challenge" : "Defend"} ${tokenInfo(target).symbol} by burning ${formatTokens(raw)} ${snap.config.ticker}`, txs: [t] }], () => {
      setAmount("");
      refresh();
    });
  };

  return (
    <form
      className="mt-6 space-y-3.5 border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Tabs
        label="Burn to"
        value={kind}
        onChange={setKind}
        className="flex w-full"
        options={[
          { id: "challenge", label: "Challenge" },
          { id: "defend", label: "Defend" },
        ]}
      />
      <div className={cx("grid gap-2.5", kind === "challenge" ? "grid-cols-2" : "grid-cols-1")}>
        <label className="block">
          <span className="text-sm font-semibold">{kind === "challenge" ? "Swap out" : "Keep"}</span>
          <span className="relative mt-1.5 block">
            {target && <TokenIcon symbol={tokenInfo(target).symbol} size={22} chain className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2" />}
            <select className="field pl-12" value={target} onChange={(e) => setTarget(e.target.value)}>
              {targets.map((b) => (
                <option key={b.token_id} value={b.token_id}>
                  {tokenInfo(b.token_id).symbol}
                </option>
              ))}
            </select>
          </span>
        </label>
        {kind === "challenge" && (
          <label className="block">
            <span className="text-sm font-semibold">Swap in</span>
            <span className="relative mt-1.5 block">
              {replacement && replacement !== "__custom" && (
                <TokenIcon symbol={tokenInfo(replacement).symbol} size={22} chain className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2" />
              )}
              <select className={replacement && replacement !== "__custom" ? "field pl-12" : "field"} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                {candidates.map((t) => (
                  <option key={t.token_id} value={t.token_id}>
                    {t.symbol}
                  </option>
                ))}
                <option value="__custom">Other token id…</option>
              </select>
            </span>
          </label>
        )}
      </div>
      {kind === "challenge" && replacement === "__custom" && (
        <label className="block">
          <span className="text-sm font-semibold">Token id</span>
          <input className="field mono mt-1.5" placeholder={`nep141:token.${NET.id}`} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <span className="mt-1 block text-xs font-semibold text-down">Not on the known list: pages will mark it as unverified backing.</span>
        </label>
      )}
      <label className="block">
        <span className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Burn</span>
          {minTokens && kind === "challenge" && (
            <button type="button" className="num text-xs font-semibold text-ink-2 underline decoration-line-2 underline-offset-2 hover:text-ink" onClick={() => setAmount(formatTokensPlain(minTokens!))}>
              use the minimum, about {formatTokens(minTokens)}
            </button>
          )}
        </span>
        <div className="relative mt-1.5">
          <input className="field num pr-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">{snap.config.ticker}</span>
        </div>
        <span className="caption mt-1 block min-h-5 text-xs">
          {raw ? `Adds ${usd(buToUsdN(value, bu.e6))} to the ${kind === "challenge" ? "challenge" : "defense"}, at the current ${snap.state.mode === "index" ? "reserve" : "curve"}. Burns are never refunded.` : ""}
        </span>
      </label>
      {accountId ? (
        <button type="submit" className="btn btn-ink w-full" disabled={!valid || tx.busy}>
          {tx.busy ? "Waiting for the wallet…" : kind === "challenge" ? "Burn to challenge" : "Burn to defend"}
        </button>
      ) : (
        <WalletButton wide />
      )}
      <TxStatus s={tx} />
    </form>
  );
}

function formatTokensPlain(raw: string): string {
  // Round up to a whole token so the burn clears the minimum.
  const whole = (BigInt(raw) + 10n ** 18n - 1n) / 10n ** 18n;
  return whole.toString();
}
