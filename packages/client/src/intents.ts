// Signing NEAR Intents payloads with a wallet from another chain, so a buyer who holds USDC on Base (MetaMask)
// or Solana (Phantom) owns their coins inside NEAR Intents without any account of ours holding their funds.
//
// Formats follow the NEAR Intents contract source (github.com/near/intents, contracts/defuse/core):
//   payload    {"signer_id","verifying_contract","deadline","nonce","intents"} as a JSON string
//   erc191     {"standard":"erc191","payload":<string>,"signature":"secp256k1:<base58 of r||s||v, v in 0..1>"}
//              (MetaMask personal_sign of the payload string)
//   raw_ed25519 {"standard":"raw_ed25519","payload":<string>,"public_key":"ed25519:<b58>","signature":"ed25519:<b58>"}
//              (Phantom signMessage of the payload's UTF-8 bytes)
//   nonce      versioned V1: 5628f6c6 || 00 || salt(4) || deadline ns (i64 LE) || 15 random bytes, base64
// Anyone may relay a signed payload with `execute_intents`; the relayer only pays gas.
import { base58 } from "./nep413.ts";

export type XChain = "base" | "solana";
export type SignedIntent =
  | { standard: "erc191"; payload: string; signature: string }
  | { standard: "raw_ed25519"; payload: string; public_key: string; signature: string };

export const NONCE_MAGIC = [0x56, 0x28, 0xf6, 0xc6];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error("not hex");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
}
const b64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

/** The wallet's account inside NEAR Intents: the lowercase EVM address, or the hex of the Solana public key. */
export function intentsIdFor(chain: XChain, user: string): string {
  if (chain === "base") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(user)) throw new Error("not an EVM address");
    return user.toLowerCase();
  }
  const key = base58Decode(user);
  if (key.length !== 32) throw new Error("not a Solana address");
  return hex(key);
}

/** A V1 versioned nonce. `salt` is NEAR Intents' `current_salt` (8 hex chars). */
export function versionedNonce(saltHex: string, deadline: Date, random: Uint8Array = crypto.getRandomValues(new Uint8Array(15))): string {
  const salt = hexToBytes(saltHex.replace(/"/g, ""));
  if (salt.length !== 4 || random.length !== 15) throw new Error("bad nonce parts");
  const out = new Uint8Array(32);
  out.set(NONCE_MAGIC, 0);
  out[4] = 0;
  out.set(salt, 5);
  new DataView(out.buffer).setBigInt64(9, BigInt(deadline.getTime()) * 1_000_000n, true);
  out.set(random, 17);
  return b64(out);
}

export type Intent =
  | { intent: "transfer"; receiver_id: string; tokens: Record<string, string>; memo?: string; msg?: string; min_gas?: string }
  | { intent: "ft_withdraw"; token: string; receiver_id: string; amount: string; memo?: string; msg?: string; min_gas?: string };

/** The exact string the wallet signs. Key order is fixed so the same inputs always give the same bytes. */
export function payloadString(p: { signer_id: string; verifier: string; deadline: Date; nonce: string; intents: Intent[] }): string {
  return JSON.stringify({ signer_id: p.signer_id, verifying_contract: p.verifier, deadline: p.deadline.toISOString(), nonce: p.nonce, intents: p.intents });
}

/** Send the basket to the coin and buy; the coin mints into NEAR Intents for the signer (`deliver`). */
export function buyIntent(coin: string, tokens: Record<string, string>, min_tokens_out: string): Intent {
  return {
    intent: "transfer",
    receiver_id: coin,
    tokens,
    msg: JSON.stringify({ action: "buy", deliver: true, min_tokens_out }),
    min_gas: "150000000000000",
  };
}

/** Sell coins held in NEAR Intents back to the coin; the basket assets come back to `receiver_id` there. */
export function sellIntent(coin: string, amount: string, min_bu_out: string, receiver_id: string): Intent {
  return {
    intent: "ft_withdraw",
    token: coin,
    receiver_id: coin,
    amount,
    msg: JSON.stringify({ action: "sell", min_bu_out, receiver_id }),
    min_gas: "150000000000000",
  };
}

export type SigningRules = {
  signer: string;
  verifier: string;
  /** Accounts a `transfer` may go to (1Click deposit addresses for this order, and the coin). */
  receivers: string[];
  /** The coin, the only token an `ft_withdraw` may take, and only to itself with a sell message. */
  coin: string;
  /** Upper bound per token across the whole payload. */
  maxSpend: Record<string, string>;
  /** Latest acceptable deadline. */
  latest: Date;
};

/**
 * Before a wallet signs anything: the payload must be for NEAR Intents, by this wallet, expire in time, and only
 * move tokens to this order's own receivers within `maxSpend`. A coin transfer must be a delivered buy; a coin
 * withdrawal must be a sell paying the signer. Anything else throws, so the server can't get a wallet to sign
 * away its balance.
 */
export function checkPayload(payload: string, r: SigningRules): void {
  const fail = (why: string): never => {
    throw new Error(`Refusing to sign: ${why}.`);
  };
  let p: { signer_id?: unknown; verifying_contract?: unknown; deadline?: unknown; intents?: unknown };
  try {
    p = JSON.parse(payload);
  } catch {
    return fail("the payload is not JSON");
  }
  if (p.verifying_contract !== r.verifier) fail(`it is for ${String(p.verifying_contract)}`);
  if (p.signer_id !== r.signer) fail(`it is signed as ${String(p.signer_id)}`);
  const dl = Date.parse(String(p.deadline));
  if (!(dl > Date.now()) || dl > r.latest.getTime()) fail("its deadline is out of range");
  if (!Array.isArray(p.intents) || p.intents.length === 0) fail("it has no intents");
  const spent: Record<string, bigint> = {};
  const add = (token: string, amt: unknown) => {
    if (typeof amt !== "string" || !/^\d+$/.test(amt)) fail(`bad amount for ${token}`);
    spent[token] = (spent[token] ?? 0n) + BigInt(amt as string);
  };
  for (const it of p.intents as Record<string, unknown>[]) {
    if (it.intent === "transfer") {
      const to = String(it.receiver_id);
      if (!r.receivers.includes(to)) fail(`it pays ${to}`);
      const tokens = (it.tokens ?? {}) as Record<string, unknown>;
      for (const [t, a] of Object.entries(tokens)) add(t, a);
      if (to === r.coin) {
        let m: { action?: unknown; deliver?: unknown };
        try {
          m = JSON.parse(String(it.msg));
        } catch {
          return fail("the coin transfer has no buy message");
        }
        if (m.action !== "buy" || m.deliver !== true) fail("the coin transfer is not a delivered buy");
      } else if (it.msg !== undefined) fail("a swap transfer carries a message");
    } else if (it.intent === "ft_withdraw") {
      if (it.token !== r.coin || it.receiver_id !== r.coin) fail("it withdraws something other than the coin");
      let m: { action?: unknown; receiver_id?: unknown };
      try {
        m = JSON.parse(String(it.msg));
      } catch {
        return fail("the withdrawal has no sell message");
      }
      if (m.action !== "sell" || m.receiver_id !== r.signer) fail("the withdrawal is not a sell paying you");
      add(`nep141:${r.coin}`, it.amount);
    } else fail(`it contains a ${String(it.intent)} intent`);
  }
  for (const [t, a] of Object.entries(spent)) {
    const cap = r.maxSpend[t];
    if (cap === undefined) fail(`it spends ${t}`);
    if (a > BigInt(cap as string)) fail(`it spends ${a} of ${t}, more than ${cap}`);
  }
}

/** MetaMask `personal_sign` result (0x r||s||v, v 27/28 or 0/1) as NEAR Intents' ERC-191 signed payload. */
export function erc191Signed(payload: string, sigHex: string): SignedIntent {
  const sig = hexToBytes(sigHex);
  if (sig.length !== 65) throw new Error("expected a 65-byte signature");
  const v = sig[64]!;
  sig[64] = v >= 27 ? v - 27 : v;
  if (sig[64]! > 1) throw new Error("bad recovery byte");
  return { standard: "erc191", payload, signature: `secp256k1:${base58(sig)}` };
}

/** Phantom `signMessage` result as NEAR Intents' raw Ed25519 signed payload. */
export function rawEd25519Signed(payload: string, publicKey: Uint8Array, signature: Uint8Array): SignedIntent {
  if (publicKey.length !== 32 || signature.length !== 64) throw new Error("bad ed25519 key or signature");
  return { standard: "raw_ed25519", payload, public_key: `ed25519:${base58(publicKey)}`, signature: `ed25519:${base58(signature)}` };
}
