// Pay from another chain's wallet: MetaMask (USDC on Base) or Phantom (USDC on Solana).
// The wallet sends ONE ordinary token transfer to a 1Click deposit address, then signs NEAR Intents messages
// (MetaMask: ERC-191 personal_sign; Phantom: signMessage) for the swaps, the buy and the sell
// (src/lib/server/xbuy.ts). No library for EVM: an ERC-20 transfer is 68 bytes of calldata.
import { erc191Signed, rawEd25519Signed, type SignedIntent } from "@backed/client";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; isMetaMask?: boolean; providers?: Eip1193[] };
type PhantomSol = {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>;
  signMessage: (message: Uint8Array, display?: "utf8" | "hex") => Promise<{ signature: Uint8Array; publicKey?: { toBytes(): Uint8Array } }>;
  publicKey?: { toBytes(): Uint8Array; toString(): string } | null;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
    phantom?: { solana?: PhantomSol };
  }
}

export const BASE_CHAIN_ID = "0x2105"; // 8453

export function hasMetaMask(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}
export function hasPhantom(): boolean {
  return typeof window !== "undefined" && !!window.phantom?.solana?.isPhantom;
}

function evm(): Eip1193 {
  const e = window.ethereum;
  if (!e) throw new Error("MetaMask isn't installed in this browser.");
  return e.providers?.find((p) => p.isMetaMask) ?? e;
}

export async function connectMetaMask(): Promise<string> {
  const accounts = (await evm().request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("MetaMask returned no account.");
  return accounts[0];
}

async function ensureBase(p: Eip1193) {
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID, chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }],
    });
  }
}

/** ERC-20 transfer(to, amount) calldata. */
export function erc20TransferData(to: string, amount: bigint): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("bad deposit address");
  return "0xa9059cbb" + to.slice(2).toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0");
}

/** Send USDC on Base from MetaMask; returns the transaction hash. */
export async function sendUsdcOnBase(from: string, token: string, to: string, amount: bigint): Promise<string> {
  const p = evm();
  await ensureBase(p);
  return (await p.request({ method: "eth_sendTransaction", params: [{ from, to: token, data: erc20TransferData(to, amount), value: "0x0" }] })) as string;
}

export async function connectPhantom(): Promise<string> {
  const ph = window.phantom?.solana;
  if (!ph?.isPhantom) throw new Error("Phantom isn't installed in this browser.");
  const r = await ph.connect();
  return r.publicKey.toString();
}

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch("/api/solana", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
  const j = (await r.json()) as { result?: T; error?: unknown };
  if (!r.ok || j.result === undefined) throw new Error("Couldn't reach Solana; try again.");
  return j.result;
}

/** Send USDC on Solana from Phantom (creating the deposit address's USDC account if needed); returns the signature. */
export async function sendUsdcOnSolana(from: string, mint: string, to: string, amount: bigint, decimals: number): Promise<string> {
  const ph = window.phantom?.solana;
  if (!ph) throw new Error("Phantom isn't installed in this browser.");
  const [{ PublicKey, Transaction }, spl] = await Promise.all([import("@solana/web3.js"), import("@solana/spl-token")]);
  const owner = new PublicKey(from);
  const dest = new PublicKey(to);
  const mintKey = new PublicKey(mint);
  const srcAta = spl.getAssociatedTokenAddressSync(mintKey, owner);
  const dstAta = spl.getAssociatedTokenAddressSync(mintKey, dest, true);
  const { value } = await solRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "finalized" }]);
  const tx = new Transaction({ feePayer: owner, recentBlockhash: value.blockhash });
  tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(owner, dstAta, dest, mintKey));
  tx.add(spl.createTransferCheckedInstruction(srcAta, mintKey, dstAta, owner, amount, decimals));
  const { signature } = await ph.signAndSendTransaction(tx);
  return signature;
}

/** "0x" + hex of the UTF-8 bytes: what personal_sign takes so MetaMask shows (and signs) the text exactly. */
export function utf8Hex(text: string): string {
  return "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign a NEAR Intents payload with MetaMask (ERC-191). No chain switch or gas: it is a message, not a transaction. */
export async function signWithMetaMask(address: string, payload: string): Promise<SignedIntent> {
  const sig = (await evm().request({ method: "personal_sign", params: [utf8Hex(payload), address] })) as string;
  return erc191Signed(payload, sig);
}

/** Sign a NEAR Intents payload with Phantom (raw Ed25519 over the payload's bytes). */
export async function signWithPhantom(payload: string): Promise<SignedIntent> {
  const ph = window.phantom?.solana;
  if (!ph) throw new Error("Phantom isn't installed in this browser.");
  if (!ph.publicKey) await ph.connect();
  const { signature } = await ph.signMessage(new TextEncoder().encode(payload), "utf8");
  const pk = ph.publicKey?.toBytes();
  if (!pk) throw new Error("Phantom returned no public key.");
  return rawEd25519Signed(payload, pk, signature);
}
