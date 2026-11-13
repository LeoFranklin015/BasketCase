"use client";

import { base58, nep413Hash, nep413SignedPayload, type Nep413Payload, type Nep413Signed, type Transaction } from "@backed/client";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BRAND, DATA_MODE, FAUCET_AMOUNT, PAY_TOKEN_ID, PRIVY_ENABLED, deployment } from "./config";
import { FIXTURE_USER } from "./fixture/world";
import { guestSigner, loadGuest, newGuestKey, saveGuest, type GuestKey } from "./guest-key";
import { NET, NETWORK, type Network } from "./network";
import type { PrivyApi, PrivyState } from "./privy-bridge";

// Privy's SDK is large: load it only when an app id is configured, and only in the browser.
const PrivyBridge = dynamic(() => import("./privy-bridge"), { ssr: false });

export type SendResult = { fixture: boolean; hashes: string[]; outcomes: unknown[] };

/**
 * "near": an existing NEAR wallet via NEAR Connect. "privy": an embedded wallet from email/social login.
 * "guest": a throwaway key made in this browser (testnet only, see guest-key.ts).
 */
export type WalletMethod = "near" | "privy" | "guest";

/** The guest wallet is offered only where tokens are free. */
export const GUEST_ENABLED = NET.testTokens && DATA_MODE === "rpc";

/** Gas money for a new Privy account (POST /api/fund). */
export type Funding = { state: "working" | "done" | "error"; message: string };

type WalletCtx = {
  accountId: string | null;
  /** How the current account signs. */
  method: WalletMethod | null;
  ready: boolean;
  /** Whether the email/social (Privy) option is offered, and whether its SDK has loaded. */
  privy: { enabled: boolean; ready: boolean; status?: string };
  funding: Funding | null;
  connect: (method?: WalletMethod) => Promise<void>;
  disconnect: () => Promise<void>;
  /** Sign and send transactions in order. Throws with a readable message on failure. */
  send: (txs: Transaction[], title: string) => Promise<SendResult>;
  /** Resolves once a new Privy or guest account has its testnet gas (and, for a guest, test USDC). */
  ensureFunded: () => Promise<void>;
  /** Sign a NEP-413 message (1Click swap intents on mainnet). */
  signNep413: (payload: Nep413Payload) => Promise<Nep413Signed>;
};

const Ctx = createContext<WalletCtx | null>(null);

const GUEST_USDC_MIN = 20n * 10n ** 6n;

/** Faucet 100 test USDC to a guest that holds less than $20 of it. True when it sent some. */
async function topUpGuestUsdc(accountId: string, secret: GuestKey["secret"]): Promise<boolean> {
  const [{ faucetTx, viewFunction }, { rpcProvider, failoverFetch }, { sendWithRawSigner }] = await Promise.all([
    import("@backed/client"),
    import("./rpc"),
    import("./near-signer"),
  ]);
  const held = await viewFunction<string>(deployment.rpc, deployment.verifier, "mt_balance_of", { account_id: accountId, token_id: PAY_TOKEN_ID }, { fetch: failoverFetch });
  if (BigInt(held ?? "0") >= GUEST_USDC_MIN) return false;
  const rpc = await rpcProvider();
  const tx = faucetTx(deployment.verifier, { token_id: PAY_TOKEN_ID, amount: FAUCET_AMOUNT });
  // The gas transfer that creates the account returns before it is final, and signing reads the key at
  // "final": wait for it (a few seconds) instead of failing.
  let out: Outcome[] = [];
  for (let i = 0; ; i++) {
    try {
      out = (await sendWithRawSigner({ rpc, accountId, sign: guestSigner(secret) }, [tx])) as Outcome[];
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i >= 9 || !/does not exist|AccessKeyDoesNotExist|doesn't exist|UNKNOWN_ACCOUNT|network|fetch|429/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1_500));
    }
  }
  const f = out.map(failureOf).find(Boolean);
  if (f) throw new Error(`Test USDC faucet failed: ${f}`);
  return true;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

type Outcome = {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string };
  status?: { Failure?: unknown; SuccessValue?: string } | string;
};

function hashOf(o: Outcome): string {
  return o.transaction?.hash ?? o.transaction_outcome?.id ?? "";
}

function failureOf(o: Outcome): string | null {
  if (o.status && typeof o.status === "object" && "Failure" in o.status && o.status.Failure) {
    const text = JSON.stringify(o.status.Failure);
    const m = /"(?:ExecutionError|FunctionCallError)":\s*"?([^"}]+)/.exec(text);
    return m?.[1] ?? text.slice(0, 300);
  }
  return null;
}

/** The decoded return value of a successful transaction (e.g. the account id from create_coin). */
export function successValue(outcome: unknown): unknown {
  const s = (outcome as Outcome).status;
  if (s && typeof s === "object" && typeof s.SuccessValue === "string" && s.SuccessValue) {
    try {
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.SuccessValue), (c) => c.charCodeAt(0))));
    } catch {
      return null;
    }
  }
  return null;
}

type Pending = { title: string; txs: Transaction[]; mode: "fixture" | "confirm"; signer?: "privy" | "guest"; message?: unknown; resolve: (ok: boolean) => void };

// Minimal structural type of the parts of @hot-labs/near-connect we use.
type Connector = {
  whenManifestLoaded: Promise<void>;
  connect: () => Promise<unknown>;
  disconnect: () => Promise<void>;
  getConnectedWallet: () => Promise<{ accounts: { accountId: string }[] }>;
  wallet: () => Promise<{
    signAndSendTransaction: (p: { network: Network; receiverId: string; actions: Transaction["actions"] }) => Promise<unknown>;
    signAndSendTransactions: (p: { network: Network; transactions: Transaction[] }) => Promise<unknown[]>;
    signMessage?: (p: { message: string; recipient: string; nonce: Uint8Array }) => Promise<{ accountId: string; publicKey: string; signature: string }>;
  }>;
  on: (e: string, cb: (p: { accounts?: { accountId: string }[] }) => void) => void;
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const fixture = DATA_MODE === "fixture";
  const [nearAccount, setNearAccount] = useState<string | null>(null);
  const [ready, setReady] = useState(fixture);
  const [pending, setPending] = useState<Pending | null>(null);
  const connectorRef = useRef<Connector | null>(null);
  const storageKey = `${BRAND.codename}:fixture-account`;
  const guestKey = `${BRAND.codename}:guest-key`;
  const [guest, setGuest] = useState<GuestKey | null>(null);
  const lastMethodKey = `${BRAND.codename}:wallet-method`;
  // A guest from an earlier visit comes back signed in, but only if the guest was the last sign-in used;
  // otherwise a returning NEAR-wallet or Privy user would briefly be "the guest".
  useEffect(() => {
    if (!GUEST_ENABLED) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(lastMethodKey);
    } catch {
      // no storage: no restore
    }
    if (last === "guest") setGuest(loadGuest(guestKey));
  }, [guestKey, lastMethodKey]);

  // Privy (email/social). The bridge reports state up and hands us its API.
  const [privy, setPrivy] = useState<PrivyState>({ ready: false, authenticated: false, accountId: null });
  const privyApiRef = useRef<PrivyApi | null>(null);
  const onPrivyApi = useCallback((api: PrivyApi) => {
    privyApiRef.current = api;
  }, []);
  /** The option the user picked last, so a fresh sign-in wins over an older session of the other kind. */
  const choiceRef = useRef<WalletMethod | null>(null);

  useEffect(() => {
    if (fixture) {
      try {
        if (localStorage.getItem(storageKey)) setNearAccount(FIXTURE_USER);
      } catch {
        // ignore
      }
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { NearConnector } = await import("@hot-labs/near-connect");
        const connector = new NearConnector({
          network: NETWORK,
          features: NETWORK === "testnet" ? { signAndSendTransactions: true, testnet: true } : { signAndSendTransactions: true },
          footerBranding: null,
        }) as unknown as Connector;
        connectorRef.current = connector;
        connector.on("wallet:signIn", (p) => setNearAccount(p.accounts?.[0]?.accountId ?? null));
        connector.on("wallet:signOut", () => setNearAccount(null));
        const existing = await connector.getConnectedWallet().catch(() => null);
        if (alive && existing?.accounts?.[0]) setNearAccount(existing.accounts[0].accountId);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fixture, storageKey]);

  // One account at a time: if both kinds are signed in, keep the one picked last (NEAR wallet by default).
  useEffect(() => {
    if (!nearAccount || !privy.accountId) return;
    if (choiceRef.current === "privy") {
      void connectorRef.current?.disconnect().catch(() => undefined);
      setNearAccount(null);
    } else {
      void privyApiRef.current?.logout();
    }
  }, [nearAccount, privy.accountId]);

  const method: WalletMethod | null = nearAccount ? "near" : privy.accountId ? "privy" : guest ? "guest" : null;
  const accountId = nearAccount ?? privy.accountId ?? guest?.accountId ?? null;

  // A new Privy account has no NEAR for gas: ask the server to send some, once per account per page load.
  const [funding, setFunding] = useState<Funding | null>(null);
  const fundRef = useRef<{ accountId: string; done: Promise<boolean> } | null>(null);
  // Gas top-ups exist only on testnet: on mainnet the relayer would be spending real NEAR.
  const fundId = (method === "privy" || method === "guest") && NET.testTokens ? accountId : null;
  const startFunding = useCallback((id: string) => {
    setFunding({ state: "working", message: `Checking your account has ${NET.chain} NEAR for gas…` });
    const done = (async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/fund", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: id }),
        });
        const body = (await res.json().catch(() => ({}))) as { funded?: boolean; error?: string };
        if (!res.ok) throw new Error(body.error ?? `Funding request failed (${res.status}).`);
        const gas = body.funded ? `Sent 0.5 ${NET.chain} NEAR to your account for gas.` : `Your account has ${NET.chain} NEAR for gas.`;
        // A guest also gets test USDC straight away, so its first tap can be Buy.
        if (method === "guest" && guest) {
          setFunding({ state: "working", message: `${gas} Getting you 100 test USDC…` });
          const topped = await topUpGuestUsdc(id, guest.secret);
          setFunding({ state: "done", message: topped ? `${gas} Added 100 test USDC.` : `${gas} You have test USDC.` });
        } else {
          setFunding({ state: "done", message: gas });
        }
        return true;
      } catch (e) {
        setFunding({ state: "error", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    })();
    fundRef.current = { accountId: id, done };
  }, [method, guest]);
  useEffect(() => {
    if (!fundId) {
      fundRef.current = null;
      setFunding(null);
      return;
    }
    if (fundRef.current?.accountId !== fundId) startFunding(fundId);
  }, [fundId, startFunding]);

  /** Waits for the top-up; if it failed, tries once more (the free RPCs drop requests now and then). */
  const ensureFunded = useCallback(async () => {
    const cur = fundRef.current;
    if (!cur) return;
    if (await cur.done) return;
    startFunding(cur.accountId);
    await fundRef.current?.done;
  }, [startFunding]);

  const connect = useCallback(
    async (m: WalletMethod = "near") => {
      if (fixture) {
        setNearAccount(FIXTURE_USER);
        try {
          localStorage.setItem(storageKey, "1");
        } catch {
          // ignore
        }
        return;
      }
      choiceRef.current = m;
      try {
        localStorage.setItem(lastMethodKey, m);
      } catch {
        // ignore
      }
      if (m === "guest") {
        if (!GUEST_ENABLED) throw new Error("Guest wallets exist only on testnet.");
        await connectorRef.current?.disconnect().catch(() => undefined);
        setNearAccount(null);
        await privyApiRef.current?.logout();
        const g = loadGuest(guestKey) ?? newGuestKey();
        saveGuest(guestKey, g);
        setGuest(g);
        return;
      }
      // Another sign-in replaces the guest for now; its key stays in this browser for next time.
      setGuest(null);
      if (m === "privy") {
        const api = privyApiRef.current;
        if (!api) throw new Error("Sign-in is still loading.");
        api.login();
        return;
      }
      const c = connectorRef.current;
      if (!c) throw new Error("Wallet connector is still loading.");
      await c.whenManifestLoaded;
      await c.connect();
    },
    [fixture, storageKey, guestKey, lastMethodKey],
  );

  const disconnect = useCallback(async () => {
    if (fixture) {
      setNearAccount(null);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
      return;
    }
    if (method === "guest") {
      // Forget the key: a guest is throwaway by design.
      saveGuest(guestKey, null);
      setGuest(null);
      return;
    }
    if (method !== "near") {
      // Also ends a Privy session that has no NEAR account yet (e.g. wallet creation failed).
      await privyApiRef.current?.logout();
      return;
    }
    await connectorRef.current?.disconnect();
    setNearAccount(null);
  }, [fixture, storageKey, guestKey, method]);

  /** The 32-byte-hash signer behind a Privy or guest account. */
  const rawSigner = useCallback((): ((hash: Uint8Array) => Promise<Uint8Array>) => {
    if (method === "guest" && guest) return guestSigner(guest.secret);
    const api = privyApiRef.current;
    if (method !== "privy" || !api || !accountId) throw new Error("Sign-in is still loading.");
    return (hash) => api.signHash(accountId, hash);
  }, [method, guest, accountId]);

  const send = useCallback(
    async (txs: Transaction[], title: string): Promise<SendResult> => {
      if (!accountId) throw new Error("Connect a wallet first.");
      if (fixture) {
        await new Promise<boolean>((resolve) => setPending({ title, txs, mode: "fixture", resolve }));
        return { fixture: true, hashes: [], outcomes: [] };
      }
      let outcomes: Outcome[];
      if (method === "privy" || method === "guest") {
        const sign = rawSigner();
        // Privy signs whenever the app asks, so the app asks you first, like a wallet would. A guest key
        // is a throwaway testnet key the visitor chose for a quick try, so it signs without a second prompt.
        if (method === "privy") {
          const ok = await new Promise<boolean>((resolve) => setPending({ title, txs, mode: "confirm", signer: method, resolve }));
          if (!ok) throw new Error("Cancelled. Nothing was signed.");
        }
        await fundRef.current?.done;
        const [{ rpcProvider }, { sendWithRawSigner }] = await Promise.all([import("./rpc"), import("./near-signer")]);
        const rpc = await rpcProvider();
        try {
          outcomes = (await sendWithRawSigner({ rpc, accountId, sign }, txs)) as Outcome[];
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // An implicit account only exists on chain after its first deposit.
          if (/does not exist/i.test(msg)) throw new Error(`Your account has no NEAR yet, so it does not exist on ${NET.chain}. ${NET.testTokens ? "Wait for the gas top-up, or send it some testnet NEAR." : "Send it a little NEAR for gas first."}`);
          if (/not enough balance|NotEnoughBalance/i.test(msg)) {
            throw new Error(`Your account doesn't have enough ${NET.chain} NEAR for this. A first buy also pays the coin a small storage deposit (about 0.25 NEAR). ${NET.testTokens ? "Send it a little testnet NEAR and try again." : "Add a little NEAR and try again."}`);
          }
          throw e;
        }
      } else {
        const c = connectorRef.current;
        if (!c) throw new Error("Wallet connector is still loading.");
        const wallet = await c.wallet();
        outcomes = (
          txs.length === 1
            ? [await wallet.signAndSendTransaction({ network: NETWORK, receiverId: txs[0]!.receiverId, actions: txs[0]!.actions })]
            : await wallet.signAndSendTransactions({ network: NETWORK, transactions: txs })
        ) as Outcome[];
      }
      for (const o of outcomes) {
        const f = failureOf(o);
        if (f) throw new Error(f);
      }
      return { fixture: false, hashes: outcomes.map(hashOf).filter(Boolean), outcomes };
    },
    [accountId, fixture, method, rawSigner],
  );

  const signNep413 = useCallback(
    async (payload: Nep413Payload): Promise<Nep413Signed> => {
      if (!accountId) throw new Error("Connect a wallet first.");
      if (method === "privy" || method === "guest") {
        if (method === "privy") {
          // Privy signs whatever the app asks, so show the intent first, like a wallet would.
          let shown: unknown = payload;
          try {
            shown = { ...payload, message: JSON.parse(payload.message) };
          } catch {
            // show it raw
          }
          const ok = await new Promise<boolean>((resolve) => setPending({ title: "Sign a NEAR Intents swap", txs: [], mode: "confirm", signer: "privy", message: shown, resolve }));
          if (!ok) throw new Error("Cancelled. Nothing was signed.");
        }
        const { implicitPublicKey } = await import("./near-signer");
        const sig = await rawSigner()(await nep413Hash(payload));
        return nep413SignedPayload(payload, implicitPublicKey(accountId).data, sig);
      }
      const wallet = await connectorRef.current?.wallet();
      if (!wallet?.signMessage) throw new Error("This wallet can't sign messages (NEP-413); try another wallet or email sign-in.");
      const nonce = Uint8Array.from(atob(payload.nonce), (c) => c.charCodeAt(0));
      const r = await wallet.signMessage({ message: payload.message, recipient: payload.recipient, nonce });
      const sig = Uint8Array.from(atob(r.signature), (c) => c.charCodeAt(0));
      return { standard: "nep413", payload, public_key: r.publicKey, signature: `ed25519:${base58(sig)}` };
    },
    [accountId, method, rawSigner],
  );

  const privyInfo = useMemo(() => ({ enabled: PRIVY_ENABLED, ready: privy.ready, status: privy.status }), [privy.ready, privy.status]);
  const value = useMemo(
    () => ({ accountId, method, ready, privy: privyInfo, funding, connect, disconnect, send, signNep413, ensureFunded }),
    [accountId, method, ready, privyInfo, funding, connect, disconnect, send, signNep413, ensureFunded],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {PRIVY_ENABLED && <PrivyBridge onState={setPrivy} onApi={onPrivyApi} />}
      {pending && (
        <TxDialog
          pending={pending}
          onClose={(ok) => {
            pending.resolve(ok);
            setPending(null);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

function TxDialog({ pending, onClose }: { pending: Pending; onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const okRef = useRef(false);
  const fixture = pending.mode === "fixture";
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const n = pending.txs.length;
  return (
    <dialog
      ref={ref}
      onClose={() => onClose(fixture || okRef.current)}
      aria-labelledby="tx-dialog-title"
      className="m-auto w-[min(640px,calc(100vw-2rem))] max-h-[85vh] overflow-hidden rounded-[var(--radius)] border border-line bg-card p-0 text-ink shadow-[var(--shadow-card)] backdrop:bg-[var(--scrim)]"
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="border-b border-line px-5 py-4">
          <p className="inline-flex rounded-full bg-sunk px-2.5 py-0.5 text-xs font-semibold text-ink-2">
            {fixture ? "Fixture mode · nothing is sent" : `${pending.signer === "guest" ? "Sign with your guest key" : "Sign with your Privy account"} · ${NET.chain}`}
          </p>
          <h2 id="tx-dialog-title" className="mt-2 text-xl font-bold tracking-[-0.02em]">{pending.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {fixture
              ? `This is the exact transaction${n > 1 ? "s" : ""} a wallet would be asked to sign.`
              : `${pending.signer === "guest" ? "Your guest key lives only in this browser." : "Privy holds your key shares; you sign every transaction."} ${pending.message ? "Signing lets 1Click move exactly the amount shown from your NEAR Intents balance for this swap." : `Signing sends ${n > 1 ? `these ${n} transactions` : "this transaction"} from your account, exactly as shown.`}`}
          </p>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-sunk px-5 py-4 font-mono text-xs leading-relaxed">
          {JSON.stringify(pending.message ?? pending.txs, null, 2)}
        </pre>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          {fixture ? (
            <button type="button" className="btn btn-ink" onClick={() => ref.current?.close()} autoFocus>
              Continue
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-line" onClick={() => ref.current?.close()}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-ink"
                autoFocus
                onClick={() => {
                  okRef.current = true;
                  ref.current?.close();
                }}
              >
                Sign and send
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
