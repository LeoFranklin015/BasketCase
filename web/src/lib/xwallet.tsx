"use client";
// The wallet from another chain (MetaMask on Base, Phantom on Solana), connected once from the header and shared by
// every screen: the header shows it, the buy box pays from it, and holdings and sells read its NEAR Intents account.
// Remembered in this browser (localStorage, best effort) and re-checked silently on load, with no wallet popup.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { connectMetaMask, connectPhantom } from "./xwallets";

export type XChain = "base" | "solana";
export type XWallet = { chain: XChain; user: string };

type XWalletCtx = {
  xwallet: XWallet | null;
  /** Ask the wallet to connect (opens its popup) and remember it. */
  connectX: (chain: XChain) => Promise<XWallet>;
  disconnectX: () => void;
};

const KEY = "basketcase:xwallet";
const Ctx = createContext<XWalletCtx | null>(null);

function remember(w: XWallet | null) {
  try {
    if (w) localStorage.setItem(KEY, JSON.stringify(w));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode or blocked storage: the connection just lasts for this page
  }
}

/** Still connected? Asked without a popup: MetaMask's eth_accounts, Phantom's onlyIfTrusted. */
async function stillConnected(w: XWallet): Promise<boolean> {
  try {
    if (w.chain === "base") {
      const accounts = (await window.ethereum?.request({ method: "eth_accounts" })) as string[] | undefined;
      return !!accounts?.some((a) => a.toLowerCase() === w.user.toLowerCase());
    }
    const ph = window.phantom?.solana as unknown as { connect?: (o: { onlyIfTrusted: boolean }) => Promise<{ publicKey: { toString(): string } }> } | undefined;
    const r = await ph?.connect?.({ onlyIfTrusted: true });
    return r?.publicKey.toString() === w.user;
  } catch {
    return false;
  }
}

export function XWalletProvider({ children }: { children: ReactNode }) {
  const [xwallet, setX] = useState<XWallet | null>(null);

  useEffect(() => {
    let saved: XWallet | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as XWallet | null;
    } catch {
      saved = null;
    }
    if (!saved?.user || (saved.chain !== "base" && saved.chain !== "solana")) return;
    void stillConnected(saved).then((ok) => (ok ? setX(saved) : remember(null)));
  }, []);

  const connectX = useCallback(async (chain: XChain) => {
    const user = chain === "base" ? await connectMetaMask() : await connectPhantom();
    const w = { chain, user };
    setX(w);
    remember(w);
    return w;
  }, []);

  const disconnectX = useCallback(() => {
    setX(null);
    remember(null);
  }, []);

  const value = useMemo(() => ({ xwallet, connectX, disconnectX }), [xwallet, connectX, disconnectX]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useXWallet(): XWalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useXWallet outside XWalletProvider");
  return c;
}
