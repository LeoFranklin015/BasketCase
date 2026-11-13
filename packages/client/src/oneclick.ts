// 1Click swaps paid from a NEAR Intents balance (mainnet). Flow, per the 1Click OpenAPI (v0):
//   POST /v0/quote (depositType INTENTS)  ->  POST /v0/generate-intent  ->  wallet signs the payload
//   ->  POST /v0/submit-intent  ->  GET /v0/status?depositAddress=...
// NEAR wallets sign with NEP-413; EVM wallets (MetaMask etc.) sign with ERC-191.
import { ONECLICK_URL } from "./crosschain.ts";

export type IntentStandard = "nep413" | "erc191";

export function intentsSwapQuote(p: { from: string; to: string; amountOut: string; account: string; now?: Date; slippageBps?: number; dry?: boolean }) {
  return {
    dry: p.dry ?? false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: p.slippageBps ?? 100,
    originAsset: p.from,
    depositType: "INTENTS",
    destinationAsset: p.to,
    amount: p.amountOut,
    refundTo: p.account,
    refundType: "INTENTS",
    recipient: p.account,
    recipientType: "INTENTS",
    deadline: new Date((p.now ?? new Date()).getTime() + 10 * 60_000).toISOString(),
  };
}

export const generateIntentBody = (depositAddress: string, signerId: string, standard: IntentStandard) => ({
  type: "swap_transfer" as const,
  standard,
  signerId,
  depositAddress,
});

export const submitIntentBody = (signedData: object) => ({ type: "swap_transfer" as const, signedData });

async function post<T>(path: string, body: object, apiKey?: string): Promise<T> {
  const res = await fetch(`${ONECLICK_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`1Click ${path}: ${json?.message ?? res.status}`);
  return json as T;
}

export type IntentsQuote = { quote: { depositAddress: string; amountIn: string; amountOut: string; deadline: string } };

type IntentPayload = { message: string; nonce: string; recipient: string };

/**
 * Before anything is signed: the intent 1Click generated must be exactly one `transfer` of at most
 * the quoted input of `from`, to the quote's deposit address, signed by the buyer, for NEAR Intents.
 * Anything else (another receiver, more money, other tokens, other intent kinds) throws, so a bad
 * or compromised 1Click response can never get a wallet to sign away its balance.
 */
export function checkSwapIntent(
  payload: IntentPayload,
  want: { account: string; depositAddress: string; from: string; maxIn: string; verifier: string },
): void {
  const fail = (why: string): never => {
    throw new Error(`1Click returned an unexpected intent; refusing to sign it (${why}).`);
  };
  if (payload.recipient !== want.verifier) fail(`recipient ${payload.recipient}`);
  let m: { signer_id?: unknown; intents?: unknown };
  try {
    m = JSON.parse(payload.message);
  } catch {
    return fail("message is not JSON");
  }
  if (m.signer_id !== want.account) fail(`signer ${String(m.signer_id)}`);
  if (!Array.isArray(m.intents) || m.intents.length !== 1) fail("expected exactly one intent");
  const it = (m.intents as { intent?: unknown; receiver_id?: unknown; tokens?: unknown }[])[0]!;
  if (it.intent !== "transfer") fail(`intent kind ${String(it.intent)}`);
  if (it.receiver_id !== want.depositAddress) fail(`receiver ${String(it.receiver_id)}`);
  const tokens = it.tokens as Record<string, unknown> | undefined;
  const keys = tokens ? Object.keys(tokens) : [];
  if (keys.length !== 1 || keys[0] !== want.from) fail(`tokens ${keys.join(",")}`);
  const amt = String(tokens![want.from]);
  if (!/^\d+$/.test(amt) || BigInt(amt) > BigInt(want.maxIn)) fail(`amount ${amt} > quoted ${want.maxIn}`);
}

/** One basket leg: quote, generate the intent, let `sign` produce the signed payload, submit it. */
export async function swapInsideIntents(opts: {
  from: string;
  to: string;
  amountOut: string;
  account: string;
  standard: IntentStandard;
  sign: (intent: unknown) => Promise<object>;
  apiKey?: string;
  /** The NEAR Intents contract the intent must be addressed to. */
  verifier?: string;
  /** Refuse quotes that need more than this much `from` (raw units). */
  maxIn?: string;
}): Promise<{ depositAddress: string; intentHash: string; amountIn: string }> {
  const q = await post<IntentsQuote>("/v0/quote", intentsSwapQuote(opts), opts.apiKey);
  if (opts.maxIn !== undefined && BigInt(q.quote.amountIn) > BigInt(opts.maxIn)) {
    throw new Error(`1Click now wants ${q.quote.amountIn} for this leg, more than the ${opts.maxIn} planned; nothing was signed.`);
  }
  const gen = await post<{ intent: { standard?: string; payload?: IntentPayload } }>(
    "/v0/generate-intent",
    generateIntentBody(q.quote.depositAddress, opts.account, opts.standard),
    opts.apiKey,
  );
  if (opts.standard === "nep413") {
    if (gen.intent?.standard !== "nep413" || !gen.intent.payload) throw new Error("1Click returned an intent without a NEP-413 payload; nothing was signed.");
    checkSwapIntent(gen.intent.payload, { account: opts.account, depositAddress: q.quote.depositAddress, from: opts.from, maxIn: q.quote.amountIn, verifier: opts.verifier ?? "intents.near" });
  }
  const signed = await opts.sign(gen.intent);
  const sub = await post<{ intentHash: string }>("/v0/submit-intent", submitIntentBody(signed), opts.apiKey);
  return { depositAddress: q.quote.depositAddress, intentHash: sub.intentHash, amountIn: q.quote.amountIn };
}

/**
 * How much of `from` an exact-output swap to `amountOut` of `to` costs right now (dry quote, nothing
 * moves). The mainnet stand-in for the testnet swapper's `quote_in`, so `prepareBuy` plans the same way.
 */
export async function oneClickQuoteIn(from: string, to: string, amountOut: string, account: string, apiKey?: string): Promise<string> {
  const q = await post<IntentsQuote>("/v0/quote", intentsSwapQuote({ from, to, amountOut, account, dry: true }), apiKey);
  return q.quote.amountIn;
}

/** Poll 1Click until the swap settles (SUCCESS) or fails. */
export async function waitForSwap(depositAddress: string, timeoutMs = 120_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${ONECLICK_URL}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    const s = (await res.json())?.status as string | undefined;
    if (s === "SUCCESS" || s === "REFUNDED" || s === "FAILED") return s;
    if (Date.now() > end) return s ?? "TIMEOUT";
    await new Promise((r) => setTimeout(r, 3_000));
  }
}
