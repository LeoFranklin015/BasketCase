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

/** NEAR's native USDC as NEAR Intents names it: what a Base/Solana deposit becomes inside NEAR Intents. */
export const NEAR_USDC_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

/** USDC on each wallet's own chain, as NEAR Intents names it: where a cash-out may end up. */
export const USDC_ASSET: Record<XChain, string> = {
  base: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  solana: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
};
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
export function checkPayload(payload: string, r: SigningRules): Record<string, bigint> {
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
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(String(it.msg));
        } catch {
          return fail("the coin transfer has no buy message");
        }
        if (m.action !== "buy" || m.deliver !== true) fail("the coin transfer is not a delivered buy");
        // The coins go to the signer (no other recipient), with a real slippage limit.
        if (Object.keys(m).some((k) => !["action", "deliver", "min_tokens_out", "recipient"].includes(k))) fail("the buy message has extra fields");
        if (m.recipient !== undefined && m.recipient !== r.signer) fail(`the buy pays ${String(m.recipient)}`);
        if (typeof m.min_tokens_out !== "string" || !/^\d+$/.test(m.min_tokens_out) || BigInt(m.min_tokens_out) === 0n) fail("the buy has no slippage limit");
      } else if (it.msg !== undefined) fail("a swap transfer carries a message");
    } else if (it.intent === "ft_withdraw") {
      if (it.token !== r.coin || it.receiver_id !== r.coin) fail("it withdraws something other than the coin");
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(String(it.msg));
      } catch {
        return fail("the withdrawal has no sell message");
      }
      if (m.action !== "sell" || m.receiver_id !== r.signer) fail("the withdrawal is not a sell paying you");
      if (typeof m.min_bu_out !== "string" || !/^\d+$/.test(m.min_bu_out) || BigInt(m.min_bu_out) === 0n) fail("the sell has no slippage limit");
      add(`nep141:${r.coin}`, it.amount);
    } else fail(`it contains a ${String(it.intent)} intent`);
  }
  capSpend(spent, r.maxSpend, fail);
  return spent;
}

function capSpend(spent: Record<string, bigint>, maxSpend: Record<string, string>, fail: (why: string) => never) {
  for (const [t, a] of Object.entries(spent)) {
    const cap = maxSpend[t];
    if (cap === undefined) fail(`it spends ${t}`);
    if (a > BigInt(cap as string)) fail(`it spends ${a} of ${t}, more than ${cap}`);
  }
}

/**
 * Every payload of one order, checked one by one and then together: `maxSpend` caps the whole order, so two
 * payloads that each fit can't add up to more than it.
 */
export function checkPayloads(payloads: string[], r: SigningRules): void {
  const total: Record<string, bigint> = {};
  for (const p of payloads) for (const [t, a] of Object.entries(checkPayload(p, r))) total[t] = (total[t] ?? 0n) + a;
  capSpend(total, r.maxSpend, (why) => {
    throw new Error(`Refusing to sign: together the messages ${why.replace(/^it /, "")}.`);
  });
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

/** What 1Click's `/v0/status?depositAddress=` says about a deposit address (only the fields we check). */
export type OneClickStatus = {
  quoteResponse?: {
    quoteRequest?: {
      originAsset?: string;
      destinationAsset?: string;
      depositType?: string;
      recipient?: string;
      recipientType?: string;
      refundTo?: string;
      refundType?: string;
      slippageTolerance?: number;
    };
    quote?: { amountIn?: string };
  };
};

/**
 * Checked with 1Click itself, not with our server: a deposit address a message pays must be a real 1Click quote
 * for the token being sent, paying out and refunding only to this wallet (its NEAR Intents account, or its own
 * address on its own chain). A made-up address returns 404 from 1Click and never reaches this check.
 */
export function checkOneClickDeposit(
  status: OneClickStatus,
  want: {
    /**
     * swap: inside NEAR Intents, paid and refunded to the wallet's NEAR Intents account (a buy leg).
     * cashout: from NEAR Intents to the wallet's own address on its chain, refunded inside NEAR Intents.
     * deposit: from the wallet's chain into its NEAR Intents account, refunded to the wallet on its chain.
     */
    route: "swap" | "cashout" | "deposit";
    token: string;
    /** Raw amount the message sends to this address: at most what the quote takes. */
    amount: string;
    intentsId: string;
    wallet: string;
    /** Tokens this swap may turn into (a basket asset for a buy; USDC on the wallet's chain for a cash-out). */
    destinations: string[];
    /** Most slippage accepted, in basis points. */
    maxSlippageBps?: number;
  },
): void {
  const q = status.quoteResponse?.quoteRequest;
  const fail = (why: string): never => {
    throw new Error(`Refusing to sign: the 1Click deposit address ${why}.`);
  };
  if (!q) return fail("has no quote");
  const depositType = want.route === "deposit" ? "ORIGIN_CHAIN" : "INTENTS";
  if (q.depositType !== depositType || q.originAsset !== want.token) fail(`is for ${String(q.originAsset)}`);
  const intents = (who: unknown, type: unknown) => type === "INTENTS" && who === want.intentsId;
  const wallet = (who: unknown, type: unknown, t: string) => type === t && typeof who === "string" && who.toLowerCase() === want.wallet.toLowerCase();
  const paysOk = want.route === "cashout" ? wallet(q.recipient, q.recipientType, "DESTINATION_CHAIN") : intents(q.recipient, q.recipientType);
  const refundOk = want.route === "deposit" ? wallet(q.refundTo, q.refundType, "ORIGIN_CHAIN") : intents(q.refundTo, q.refundType);
  if (!paysOk) fail(`pays ${String(q.recipient)} (${String(q.recipientType)})`);
  if (!refundOk) fail(`refunds to ${String(q.refundTo)} (${String(q.refundType)})`);
  if (!want.destinations.includes(String(q.destinationAsset))) fail(`swaps into ${String(q.destinationAsset)}`);
  if (typeof q.slippageTolerance !== "number" || q.slippageTolerance > (want.maxSlippageBps ?? 300)) fail(`allows ${String(q.slippageTolerance)} bps of slippage`);
  const quotedIn = status.quoteResponse?.quote?.amountIn;
  if (!quotedIn || !/^\d+$/.test(want.amount) || BigInt(want.amount) > BigInt(quotedIn)) fail(`was quoted for ${String(quotedIn)}, less than the ${want.amount} sent`);
}

/** The single token (and amount) a 1Click swap message sends to `depositAddress`. */
export function sentTo(payload: string, depositAddress: string): { token: string; amount: string } {
  const p = JSON.parse(payload) as { intents?: { intent?: string; receiver_id?: string; tokens?: Record<string, string> }[] };
  const it = (p.intents ?? []).find((i) => i.intent === "transfer" && i.receiver_id === depositAddress);
  const keys = Object.keys(it?.tokens ?? {});
  if (keys.length !== 1) throw new Error("Refusing to sign: a swap message must send exactly one token.");
  return { token: keys[0]!, amount: String(it!.tokens![keys[0]!]) };
}
