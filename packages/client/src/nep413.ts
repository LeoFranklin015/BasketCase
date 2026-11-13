// NEP-413 message signing, used to sign 1Click swap intents on mainnet NEAR Intents, plus the two
// NEAR Intents calls a mainnet buyer may need first: depositing the pay token, and (for a named
// account) registering the key that signs intents. Implicit accounts are trusted by their own key.
// Spec: https://github.com/near/NEPs/blob/master/neps/nep-0413.md
import { functionCall, ONE_YOCTO } from "./actions.ts";
import type { Transaction } from "./types.ts";

export type Nep413Payload = { message: string; nonce: string; recipient: string; callbackUrl?: string | null };
export type Nep413Signed = { standard: "nep413"; payload: Nep413Payload; public_key: string; signature: string };

/** 2^31 + 413: the borsh u32 tag that keeps NEP-413 messages from ever being valid transactions. */
export const NEP413_TAG = 2147484061;

const enc = new TextEncoder();

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function str(s: string): Uint8Array[] {
  const bytes = enc.encode(s);
  return [u32(bytes.length), bytes];
}
function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The 32-byte hash a wallet signs: sha256(borsh(tag) ++ borsh(payload)). */
export async function nep413Hash(p: Nep413Payload): Promise<Uint8Array> {
  const nonce = fromBase64(p.nonce);
  if (nonce.length !== 32) throw new Error(`NEP-413 nonce must be 32 bytes, got ${nonce.length}`);
  const parts = [u32(NEP413_TAG), ...str(p.message), nonce, ...str(p.recipient), ...(p.callbackUrl != null ? [Uint8Array.of(1), ...str(p.callbackUrl)] : [Uint8Array.of(0)])];
  const all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) {
    all.set(x, o);
    o += x.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** The `signedData` 1Click's /v0/submit-intent takes for a NEAR wallet. */
export function nep413SignedPayload(payload: Nep413Payload, publicKey: Uint8Array, signature: Uint8Array): Nep413Signed {
  return { standard: "nep413", payload, public_key: `ed25519:${base58(publicKey)}`, signature: `ed25519:${base58(signature)}` };
}

/** Move `amount` of an NEP-141 token into the sender's NEAR Intents balance. */
export function intentsDepositTx(verifier: string, ftContract: string, amount: string): Transaction {
  return { receiverId: ftContract, actions: [functionCall("ft_transfer_call", { receiver_id: verifier, amount, msg: "" }, 100, ONE_YOCTO)] };
}

/** Let `public_key` sign intents for the sender's account (named accounts only). */
export function intentsAddPublicKeyTx(verifier: string, public_key: string): Transaction {
  return { receiverId: verifier, actions: [functionCall("add_public_key", { public_key }, 30, ONE_YOCTO)] };
}
