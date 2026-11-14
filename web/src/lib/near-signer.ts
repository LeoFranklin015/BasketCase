// Sign NEAR transactions with a signer that only knows how to sign a 32-byte hash (Privy's raw sign).
// Pure apart from crypto.subtle: no React, no Privy, so it is unit-tested with a local ed25519 key.

import type { Transaction as AppTransaction } from "@backed/client";
import { PublicKey, Signature, SignedTransaction, actions, baseDecode, baseEncode, createTransaction, encodeTransaction } from "near-api-js";

/** Signs a 32-byte hash and returns the 64-byte ed25519 signature. */
export type RawHashSigner = (hash: Uint8Array) => Promise<Uint8Array>;

const IMPLICIT = /^[0-9a-f]{64}$/;

export function isImplicitAccount(id: string): boolean {
  return IMPLICIT.test(id);
}

/** A NEAR implicit account id is the hex of its ed25519 public key. */
export function implicitPublicKey(accountId: string): PublicKey {
  if (!isImplicitAccount(accountId)) throw new Error(`Not a NEAR implicit account: ${accountId}`);
  const bytes = Uint8Array.from(accountId.match(/../g)!.map((h) => parseInt(h, 16)));
  return PublicKey.fromString(`ed25519:${baseEncode(bytes)}`);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

export function toNearActions(tx: AppTransaction) {
  return tx.actions.map((a) => actions.functionCall(a.params.methodName, a.params.args, BigInt(a.params.gas), BigInt(a.params.deposit)));
}

/** Build the transaction, raw-sign sha256(borsh(tx)), and check the signature before anything is sent. */
export async function signTransaction(a: {
  accountId: string;
  nonce: bigint;
  blockHash: Uint8Array;
  tx: AppTransaction;
  sign: RawHashSigner;
  /** The signing key; defaults to the key an implicit account id encodes. Named accounts must pass it. */
  publicKey?: PublicKey;
}): Promise<{ signed: SignedTransaction; hash: Uint8Array }> {
  const publicKey = a.publicKey ?? implicitPublicKey(a.accountId);
  const transaction = createTransaction(a.accountId, publicKey, a.tx.receiverId, a.nonce, toNearActions(a.tx), a.blockHash);
  const hash = await sha256(encodeTransaction(transaction));
  const sig = await a.sign(hash);
  if (sig.length !== 64 || !publicKey.verify(hash, sig)) {
    throw new Error("The wallet returned a signature that does not match this account's key.");
  }
  const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: publicKey.keyType, data: sig }) });
  return { signed, hash };
}

/** The few RPC calls the sender needs; near-api-js's JsonRpcProvider satisfies it. */
export type SenderRpc = {
  viewAccessKey: (q: { accountId: string; publicKey: PublicKey; finalityQuery: { finality: "final" } }) => Promise<{ nonce: bigint | number }>;
  viewBlock: (q: { finality: "final" }) => Promise<{ header: { hash: string } }>;
  sendTransactionUntil: (signed: SignedTransaction, waitUntil: "FINAL") => Promise<unknown>;
};

function failed(outcome: unknown): boolean {
  const s = (outcome as { status?: unknown }).status;
  return !!s && typeof s === "object" && "Failure" in s;
}

const RATE_LIMITED = /429|rate limit|Exceeded \d+ providers|Failed to fetch|network error|timed? ?out|ECONNRESET|503|502/i;

/**
 * Send one signed transaction, re-sending the same bytes when the free RPCs refuse or drop the request.
 * Safe: a signed transaction has one hash and one nonce, so NEAR runs it at most once; a re-send of a
 * transaction that already landed just returns its outcome.
 */
async function sendRetrying(rpc: SenderRpc, signed: SignedTransaction, tries = 5): Promise<unknown> {
  for (let i = 1; ; i++) {
    try {
      return await rpc.sendTransactionUntil(signed, "FINAL");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i >= tries || !RATE_LIMITED.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}

/**
 * Sign and send app transactions one after another (each waits for FINAL), like a wallet's
 * signAndSendTransactions. Stops after the first failed transaction. Returns the RPC outcomes.
 */
export async function sendWithRawSigner(
  who: { rpc: SenderRpc; accountId: string; sign: RawHashSigner; publicKey?: PublicKey },
  txs: AppTransaction[],
): Promise<unknown[]> {
  const { rpc, accountId, sign } = who;
  const publicKey = who.publicKey ?? implicitPublicKey(accountId);
  const key = await rpc.viewAccessKey({ accountId, publicKey, finalityQuery: { finality: "final" } });
  let nonce = BigInt(key.nonce);
  const outcomes: unknown[] = [];
  for (const tx of txs) {
    // A fresh final block per transaction: earlier ones in the batch may take a while.
    const block = await rpc.viewBlock({ finality: "final" });
    nonce += 1n;
    const { signed } = await signTransaction({ accountId, nonce, blockHash: baseDecode(block.header.hash), tx, sign, publicKey });
    const outcome = await sendRetrying(rpc, signed);
    outcomes.push(outcome);
    if (failed(outcome)) break;
  }
  return outcomes;
}
