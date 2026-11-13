"use client";

// Loaded lazily by WalletProvider only when Privy is configured. It is the one place that uses Privy hooks:
// it reports the user's NEAR implicit account up and hands WalletProvider a way to log in, log out and raw-sign.

import { NET } from "./network";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { useEffect, useRef, useState } from "react";
import { PRIVY_APP_ID, PRIVY_LOGIN_METHODS } from "./config";
import { isImplicitAccount } from "./near-signer";

export type PrivyApi = {
  login: () => void;
  logout: () => Promise<void>;
  /** Raw-sign a 32-byte hash with the user's NEAR wallet; returns the 64-byte ed25519 signature. */
  signHash: (accountId: string, hash: Uint8Array) => Promise<Uint8Array>;
};

export type PrivyState = {
  ready: boolean;
  authenticated: boolean;
  /** The NEAR implicit account, once the wallet exists. */
  accountId: string | null;
  /** Set while the NEAR wallet is being created, or if creating it failed. */
  status?: string;
};

type Props = { onState: (s: PrivyState) => void; onApi: (api: PrivyApi) => void };

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.replace(/^0x/, "").match(/../g) ?? [], (x) => parseInt(x, 16));

export default function PrivyBridge(props: Props) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: PRIVY_LOGIN_METHODS,
        appearance: {
          theme: "light",
          accentColor: "#0c6e53",
          showWalletLoginFirst: false,
          landingHeader: "Sign in",
          loginMessage: `Privy creates a ${NET.chain} account for you.`,
        },
      }}
    >
      <Bridge {...props} />
    </PrivyProvider>
  );
}

function Bridge({ onState, onApi }: Props) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const creating = useRef(false);

  const nearWallet = user?.linkedAccounts.find((a) => a.type === "wallet" && a.chainType === "near");
  const address = nearWallet && nearWallet.type === "wallet" ? nearWallet.address : null;
  const accountId = address && isImplicitAccount(address.toLowerCase()) ? address.toLowerCase() : null;

  useEffect(() => {
    onApi({
      login: () => login(),
      logout,
      signHash: async (id, hash) => {
        if (!address || address.toLowerCase() !== id) throw new Error("This Privy session has no wallet for that account.");
        const { signature } = await signRawHash({ address, chainType: "near", hash: `0x${toHex(hash)}` });
        return fromHex(signature);
      },
    });
  }, [onApi, login, logout, signRawHash, address]);

  // A new user has no NEAR wallet yet: create one right after login.
  const [createError, setCreateError] = useState<string>();
  useEffect(() => {
    if (!ready || !authenticated || !user || nearWallet || creating.current || createError) return;
    creating.current = true;
    setCreateError(undefined);
    createWallet({ chainType: "near" })
      .catch((e: unknown) => setCreateError(`Could not create a NEAR account: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        creating.current = false;
      });
  }, [ready, authenticated, user, nearWallet, createWallet, createError]);

  useEffect(() => {
    let status: string | undefined;
    if (address && !accountId) status = `Privy returned an unexpected NEAR address: ${address}`;
    else if (authenticated && !accountId) status = createError ?? "Creating your NEAR account…";
    onState({ ready, authenticated, accountId, status });
  }, [ready, authenticated, accountId, address, createError, onState]);

  return null;
}
