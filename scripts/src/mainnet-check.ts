// Read-only mainnet readiness check. Signs nothing, sends no transaction, moves no funds.
// Exercises every mainnet step of a buy that does not need the owner's money:
//   1. mainnet RPC answers and intents.near (the real verifier) serves NEP-245 views;
//   2. every basket asset in deployments/mainnet.json has a 1Click route from USDC inside NEAR Intents
//      (dry EXACT_OUTPUT quote: what `prepareBuy` uses on mainnet as quote_in);
//   3. a real (non-dry) quote yields a deposit address, and /v0/generate-intent returns a NEP-413 payload
//      that our signer can hash (32-byte nonce, recipient intents.near). We stop there: nothing is signed.
// Usage (from scripts/): pnpm exec tsx src/mainnet-check.ts
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import {
  ONECLICK_URL,
  checkSwapIntent,
  generateIntentBody,
  intentsSwapQuote,
  nep413Hash,
  oneClickQuoteIn,
  viewFunction,
  type Nep413Payload,
} from "../../packages/client/src/index.ts";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
type Dep = { rpc: string; verifier: string; factory: string; tokens: { symbol: string; token_id: string; decimals: number }[] };
const d: Dep = JSON.parse(readFileSync(join(ROOT_DIR, "deployments/mainnet.json"), "utf8"));
const USDC = d.tokens.find((t) => t.symbol === "USDC")!;
// A throwaway implicit account: valid on mainnet, owns nothing, its key is discarded.
const probe = Buffer.from(KeyPair.fromRandom("ed25519").getPublicKey().data).toString("hex");

const rows: [string, "PASS" | "FAIL", string][] = [];
const check = async (name: string, f: () => Promise<string>) => {
  try {
    rows.push([name, "PASS", await f()]);
  } catch (e) {
    rows.push([name, "FAIL", (e instanceof Error ? e.message : String(e)).slice(0, 140)]);
  }
};

await check("mainnet RPC + intents.near mt_balance_of", async () => {
  const b = await viewFunction<string>(d.rpc, d.verifier, "mt_balance_of", { account_id: probe, token_id: USDC.token_id });
  return `${d.verifier} answers (probe balance ${b})`;
});
await check("intents.near has_public_key (named-account key check)", async () => {
  const pk = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  const r = await viewFunction<boolean>(d.rpc, d.verifier, "has_public_key", { account_id: "near", public_key: pk });
  return `returns ${r} for a random key, as expected`;
});

// $5-sized legs: about $5 of each asset.
const usdOf: Record<string, number> = {};
const prices = (await (await fetch(`${ONECLICK_URL}/v0/tokens`)).json()) as { assetId: string; price: number }[];
for (const p of prices) usdOf[p.assetId] = p.price;
for (const t of d.tokens.filter((t) => t.token_id !== USDC.token_id)) {
  await check(`1Click route USDC -> ${t.symbol}`, async () => {
    const usd = usdOf[t.token_id];
    if (!usd) throw new Error("no 1Click price");
    const out = BigInt(Math.ceil((5 / usd) * 10 ** Math.min(t.decimals, 15))) * 10n ** BigInt(Math.max(0, t.decimals - 15));
    const amountIn = await oneClickQuoteIn(USDC.token_id, t.token_id, out.toString(), probe);
    return `${out} raw ${t.symbol} costs ${(Number(amountIn) / 1e6).toFixed(2)} USDC`;
  });
}

await check("1Click quote -> generate-intent -> checked -> NEP-413 hash", async () => {
  const btc = d.tokens.find((t) => t.symbol === "BTC")!;
  const res = await fetch(`${ONECLICK_URL}/v0/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intentsSwapQuote({ from: USDC.token_id, to: btc.token_id, amountOut: "5000", account: probe })),
  });
  const q = (await res.json()) as { quote?: { depositAddress?: string; amountIn?: string }; message?: string };
  if (!q.quote?.depositAddress) throw new Error(`quote: ${q.message ?? res.status}`);
  const g = await fetch(`${ONECLICK_URL}/v0/generate-intent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(generateIntentBody(q.quote.depositAddress, probe, "nep413")),
  });
  const gen = (await g.json()) as { intent?: { standard?: string; payload?: Nep413Payload }; message?: string };
  if (!gen.intent?.payload) throw new Error(`generate-intent (${g.status}): ${gen.message ?? JSON.stringify(gen).slice(0, 100)}`);
  // The same check the app and keeper run before signing: one transfer, at most the quoted input, to the deposit address.
  checkSwapIntent(gen.intent.payload, { account: probe, depositAddress: q.quote.depositAddress, from: USDC.token_id, maxIn: q.quote.amountIn!, verifier: d.verifier });
  const h = await nep413Hash(gen.intent.payload);
  return `passes the pre-sign check; standard ${gen.intent.standard}, recipient ${gen.intent.payload.recipient}, hash ${Buffer.from(h).toString("hex").slice(0, 12)}…; not signed`;
});

await check("factory deployed on mainnet (or the one demo coin)", async () => {
  const coins = (d as { coins?: { account_id: string }[] }).coins ?? [];
  if (d.factory === "none" && coins.length) {
    const st = await viewFunction<{ mode: string }>(d.rpc, coins[0]!.account_id, "get_state", {});
    return `no factory; demo coin ${coins[0]!.account_id} is live (mode ${st.mode})`;
  }
  if (d.factory.startsWith("PLACEHOLDER")) throw new Error("not yet: needs the owner's go (docs/mainnet-runbook.md)");
  return d.factory;
});

const w = Math.max(...rows.map((r) => r[0].length));
for (const [n, s, m] of rows) console.log(`${s}  ${n.padEnd(w)}  ${m}`);
process.exitCode = rows.some((r) => r[1] === "FAIL" && !r[0].startsWith("factory")) ? 1 : 0;
