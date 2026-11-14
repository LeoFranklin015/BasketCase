// End-to-end check of the deployed mainnet flow that moves no money:
//  1. asks the live mainnet site to start a $3 MetaMask buy for a throwaway address (a real 1Click quote; nothing
//     is ever sent to its deposit address, so the quote just expires);
//  2. runs the browser's own pre-send check on that deposit address, asking 1Click directly;
//  3. signs a delivered buy of the real coin with the throwaway key and runs it through `simulate_intents`
//     (a view): it must parse and reach the balance check, which a key with no funds fails.
//   SITE=https://<mainnet site> pnpm exec tsx src/mainnet-dryrun.ts <coin account>
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  NEAR_USDC_ASSET,
  ONECLICK_URL,
  USDC_ASSET,
  buyIntent,
  checkOneClickDeposit,
  erc191Signed,
  payloadString,
  versionedNonce,
} from "../../packages/client/src/index.ts";

const SITE = process.env.SITE;
const coin = process.argv[2];
if (!SITE || !coin) throw new Error("usage: SITE=https://… tsx src/mainnet-dryrun.ts <coin account>");
const RPC = "https://rpc.mainnet.near.org";
/** Order size for step 1: the coin's smallest buy ($3 for a 50% BTC basket). */
const USD = Number(process.env.USD ?? 3);
const enc = new TextEncoder();

async function view(account: string, method: string, args: object): Promise<{ ok: boolean; value?: unknown; error?: string }> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
  });
  const j = (await r.json()) as { result?: { result?: number[]; error?: string }; error?: { cause?: { info?: { error_message?: string } }; data?: string } };
  if (j.result?.result) return { ok: true, value: JSON.parse(Buffer.from(j.result.result).toString()) };
  return { ok: false, error: j.result?.error ?? j.error?.cause?.info?.error_message ?? j.error?.data ?? "unknown" };
}

const sk = secp256k1.utils.randomPrivateKey();
const wallet = "0x" + Buffer.from(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(12)).toString("hex");
let failed = 0;
const row = (pass: boolean, what: string, detail: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${what}  ${detail}`);
};

// 1. The live server starts a buy.
const res = await fetch(`${SITE}/api/xbuy`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, chain: "base", user: wallet, usd: USD }) });
const order = (await res.json()) as { id?: string; depositAddress?: string; amount?: string; token?: string; error?: string };
row(res.ok && !!order.depositAddress, `live site starts a $${USD} Base buy`, order.depositAddress ? `deposit ${order.depositAddress} for ${order.amount} raw USDC (nothing sent)` : String(order.error));

// 2. The browser's pre-send check on that address, asked of 1Click directly.
if (order.depositAddress) {
  const st = await fetch(`${ONECLICK_URL}/v0/status?depositAddress=${encodeURIComponent(order.depositAddress)}`);
  try {
    checkOneClickDeposit(await st.json(), { route: "deposit", token: USDC_ASSET.base, amount: order.amount!, intentsId: wallet, wallet, destinations: [NEAR_USDC_ASSET] });
    row(true, "browser pre-send check accepts it", "real 1Click quote; pays the wallet's NEAR Intents account; refunds to the wallet on Base");
  } catch (e) {
    row(false, "browser pre-send check accepts it", e instanceof Error ? e.message : String(e));
  }
}

// 3. A delivered buy of the real coin, signed like MetaMask, through simulate_intents.
const basket = (await view(coin, "get_basket", {})).value as { token_id: string; q: string }[];
const tokens = Object.fromEntries(basket.map((b) => [b.token_id, b.q])); // one basket unit
const salt = (await view("intents.near", "current_salt", {})).value as string;
const deadline = new Date(Date.now() + 5 * 60_000);
const payload = payloadString({ signer_id: wallet, verifier: "intents.near", deadline, nonce: versionedNonce(salt, deadline), intents: [buyIntent(coin, tokens, "1")] });
const m = enc.encode(payload);
const sig = secp256k1.sign(keccak_256(new Uint8Array([...enc.encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m])), sk);
const signed = erc191Signed(payload, "0x" + sig.toCompactHex() + (27 + sig.recovery).toString(16));
const sim = await view("intents.near", "simulate_intents", { signed: [signed] });
row(!sim.ok && /balance/i.test(sim.error ?? ""), "signed buy of the real coin parses in NEAR Intents", sim.ok ? "unexpectedly executed" : `stops at: ${sim.error}`);

// 4. The coin is ready to take delivered buys.
const reg = await view(coin, "storage_balance_of", { account_id: "intents.near" });
row(reg.ok && reg.value !== null, "NEAR Intents is registered on the coin", JSON.stringify(reg.value));
const state = (await view(coin, "get_state", {})).value as { mode: string; launch: { ends_ms: number; queued_accounts: number } };
const open = state.mode !== "launch" || (Date.now() >= state.launch.ends_ms && state.launch.queued_accounts === 0);
row(open, "fair launch over; the first buy opens the curve", `mode ${state.mode}, window ended ${new Date(state.launch.ends_ms).toISOString()}`);

process.exit(failed ? 1 : 0);
