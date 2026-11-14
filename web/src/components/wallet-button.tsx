"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EXPLORER_ACCOUNT, NET, PRIVY_LOGIN_LABEL } from "@/lib/config";
import { GUEST_ENABLED, useWallet, type WalletMethod } from "@/lib/wallet";
import { Avatar } from "./coin-bits";
import { cx, shortAccount } from "./ui";
import { WalletIcon, type WalletKind } from "./token-icon";

/** Close a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const MENU = "absolute right-0 top-full z-40 mt-2 w-80 rounded-[var(--radius)] border border-line bg-card p-2 text-left text-ink shadow-[var(--shadow-card)]";

/** `wide` fills its container, for the connect prompt inside a trade card or form. */
/** `solid` keeps the ink fill even where "Try it free" is offered (pages without that button, like Launch). */
export function WalletButton({ compact, wide, solid }: { compact?: boolean; wide?: boolean; solid?: boolean }) {
  const { accountId, method, ready, privy, funding, connect, disconnect } = useWallet();
  const [err, setErr] = useState<string>();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  const menuId = useId();

  const pick = (m: WalletMethod) => {
    setErr(undefined);
    setOpen(false);
    connect(m).catch((e: Error) => setErr(e.message));
  };

  if (accountId) {
    return (
      <span ref={ref} className="relative inline-flex flex-col items-end">
        <button
          type="button"
          className="btn btn-quiet btn-sm max-w-[13rem] gap-2 pl-1.5"
          title={accountId}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="relative shrink-0">
            <Avatar account={accountId} size={24} />
            <WalletIcon kind={walletKind(method)} size={12} className="absolute -bottom-0.5 -right-1 ring-[1.5px] ring-card" />
          </span>
          <span className="truncate">{shortAccount(accountId, compact ? 14 : 18)}</span>
          <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", funding?.state === "error" ? "bg-down" : "bg-up")} />
        </button>
        {open && (
          <div id={menuId} className={MENU}>
            <AccountCard />
            <button
              type="button"
              className="w-full rounded-[12px] px-3 py-2.5 text-left text-sm font-semibold hover:bg-sunk"
              onClick={() => {
                close();
                void disconnect();
              }}
            >
              {method === "privy" ? "Sign out" : "Disconnect"}
            </button>
          </div>
        )}
      </span>
    );
  }

  const status = privy.enabled ? privy.status : undefined;
  const stuck = !!status && /Could not|unexpected/.test(status);
  if (stuck) {
    return (
      <span className="inline-flex flex-col items-end">
        <button type="button" className="btn btn-line btn-sm" onClick={() => void disconnect()}>
          Sign out
        </button>
        <span role="alert" className="mt-1 max-w-[12rem] text-right text-xs text-down">
          {status}
        </span>
      </span>
    );
  }
  return (
    <span ref={ref} className={wide ? "relative flex w-full flex-col items-stretch" : "relative inline-flex flex-col items-end"}>
      <button
        type="button"
        className={cx("btn", wide ? "btn-lg w-full" : "btn-sm", GUEST_ENABLED && !solid ? "btn-line" : "btn-ink")}
        disabled={!ready || !!status}
        aria-expanded={privy.enabled || GUEST_ENABLED ? open : undefined}
        aria-controls={privy.enabled || GUEST_ENABLED ? menuId : undefined}
        onClick={() => (privy.enabled || GUEST_ENABLED ? setOpen((o) => !o) : pick("near"))}
      >
        {status ? "Signing in…" : wide ? "Connect a wallet" : "Connect"}
      </button>
      {open && (
        <div id={menuId} className={cx(MENU, wide && "left-0 right-auto w-full")}>
          <ConnectOptions onPick={pick} />
        </div>
      )}
      {(err || status) && (
        <span role={err ? "alert" : "status"} className={cx("mt-1 max-w-[16rem] text-xs", wide ? "text-left" : "text-right", err ? "text-down" : "text-muted")}>
          {err ?? status}
        </span>
      )}
    </span>
  );
}

/**
 * The fastest way in (testnet only): one tap makes a guest key in this browser, with gas and test
 * USDC funded for it. Renders nothing where guest wallets are not offered. `onDone` runs once the
 * guest account is connected (e.g. to open a coin).
 */
export function TryFreeButton({ className, label = "Try it free", note = true, block, onDone }: { className?: string; label?: string; note?: boolean; block?: boolean; onDone?: () => void }) {
  const { connect, ready, accountId } = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  if (!GUEST_ENABLED || accountId) return null;
  return (
    <span className={cx("flex-col items-stretch", block ? "flex w-full" : "inline-flex")}>
      <button
        type="button"
        className={cx("btn btn-ink", className)}
        disabled={!ready || busy}
        onClick={() => {
          setErr(undefined);
          setBusy(true);
          connect("guest")
            .then(() => onDone?.())
            .catch((e: Error) => setErr(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Making your guest wallet…" : label}
        {!busy && note && <span className="font-medium opacity-70">· no wallet</span>}
      </button>
      {err && (
        <span role="alert" className="mt-1.5 max-w-[22rem] text-xs text-down">
          {err}
        </span>
      )}
    </span>
  );
}

/** The ways in: a NEAR wallet, email/social through Privy, or (testnet) a guest key made in this browser. */
export function ConnectOptions({ onPick }: { onPick: (m: WalletMethod) => void }) {
  const { privy } = useWallet();
  return (
    <div className="space-y-1">
      <MenuOption icon="near" title="NEAR wallet" note="Use a NEAR wallet you already have." onClick={() => onPick("near")} />
      {privy.enabled && (
        <MenuOption
          icon="email"
          title={PRIVY_LOGIN_LABEL}
          note={`No wallet needed. Privy creates a ${NET.chain} account for you and holds your key shares; you sign every transaction.`}
          disabled={!privy.ready}
          onClick={() => onPick("privy")}
        />
      )}
      {GUEST_ENABLED && (
        <MenuOption
          icon="guest"
          title="Guest wallet"
          note={`Fastest way to try it: a throwaway ${NET.chain} key made in this browser, with free gas and ${NET.testTokens ? "test " : ""}USDC. Nothing to install.`}
          onClick={() => onPick("guest")}
        />
      )}
    </div>
  );
}

/** The icon for how someone signed in: a NEAR wallet, email through Privy, or a guest key. */
function walletKind(method: string | null | undefined): WalletKind {
  return method === "privy" ? "email" : method === "guest" ? "guest" : "near";
}

/** Who is signed in, and how. */
export function AccountCard() {
  const { accountId, method, funding } = useWallet();
  if (!accountId) return null;
  return (
    <div className="flex gap-3 px-3 py-2.5">
      <span className="relative shrink-0 self-start">
        <Avatar account={accountId} size={40} />
        <WalletIcon kind={walletKind(method)} size={18} className="absolute -bottom-1 -right-1 ring-2 ring-card" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">{method === "privy" ? `Signed in with ${PRIVY_LOGIN_LABEL.toLowerCase()} via Privy` : method === "guest" ? "Guest wallet (this browser only)" : "NEAR wallet"}</p>
        <a href={EXPLORER_ACCOUNT(accountId)} target="_blank" rel="noreferrer" className="link mono mt-0.5 block break-all text-xs">
          {accountId}
        </a>
        {method === "privy" && <p className="caption mt-2">Privy holds your key shares; you sign every transaction. This is a {NET.chain} account.</p>}
        {method === "guest" && <p className="caption mt-2">The key lives only in this browser. Disconnecting forgets it, along with its test tokens.</p>}
        {funding && (
          <p role="status" className={cx("mt-2 text-xs", funding.state === "error" ? "text-down" : funding.state === "done" ? "text-up" : "text-muted")}>
            {funding.message}
          </p>
        )}
      </div>
    </div>
  );
}

function MenuOption({ icon, title, note, disabled, onClick }: { icon: WalletKind; title: string; note: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left hover:bg-raised disabled:opacity-50">
      <WalletIcon kind={icon} size={32} className="mt-0.5 ring-1 ring-line-2" />
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="caption mt-0.5 block">{note}</span>
      </span>
    </button>
  );
}
