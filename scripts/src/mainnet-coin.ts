// The cheapest mainnet demo: ONE coin deployed straight to <ticker>.<master>, no factory, no helper accounts.
// The coin account keeps its key, so after the demo `mainnet-cleanup.ts --coin` deletes it and every NEAR of its
// storage deposit comes back. Unlike testnet coins (no keys, launched by the factory), this demo coin is NOT
// keyless; the README says so. Basket: 50% BTC (anchored) + 50% USDC, priced from 1Click (1 basket unit = $1).
// Usage: NETWORK=mainnet pnpm exec tsx src/mainnet-coin.ts <master.near> --yes-mainnet [--ticker DEGEN] [--preset degen|ai]
import { KeyPair, actions, teraToGas } from "near-api-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fetchOneClickPrices } from "../../packages/client/src/index.ts";
import { NETWORK, ROOT, account, exists, loadDeployment, loadKey, near, qFor, saveDeployment, saveKey, txLink, view } from "./lib.js";

if (NETWORK !== "mainnet") throw new Error("this script is for NETWORK=mainnet; testnet coins come from the factory (seed.ts)");
const master = process.argv[2];
if (!master || master.startsWith("--")) throw new Error("usage: mainnet-coin <master.near> --yes-mainnet [--ticker DEGEN]");
const pi = process.argv.indexOf("--preset");
const preset = pi > 0 ? process.argv[pi + 1]! : "degen";
const ti = process.argv.indexOf("--ticker");
const DEFAULT_TICKER: Record<string, string> = { degen: "DEGEN", ai: "AI", "ai-index": "AIDX" };
const ticker = ti > 0 ? process.argv[ti + 1]!.toUpperCase() : (DEFAULT_TICKER[preset] ?? preset.toUpperCase());
const id = `${ticker.toLowerCase()}.${master}`;
const d = loadDeployment();

const code = readFileSync(join(ROOT, "target/near/coin/coin.wasm"));
// Storage is 1 NEAR per 100 KB: the code, plus 25 KB for the coin's state during a short demo.
const fundNear = Math.ceil((code.length + 25_000) / 1_000) / 100;

// --preset degen (default): 50% BTC (anchored) + 50% USDC. --preset ai: 50% NVDAon (anchored) + 50% VVV.
// --preset ai-index: NEAR (anchored) + KAITO + VVV + PUBLIC + ITLX.
const LEGS: Record<string, { symbol: string; weight: number; anchored: boolean }[]> = {
  degen: [{ symbol: "BTC", weight: 5_000, anchored: true }, { symbol: "USDC", weight: 5_000, anchored: false }],
  // Real NVIDIA through Ondo's NVDAon (bridged from BNB Chain; 1Click fills it from about $5.50, so the smallest
  // $AI buy is $13) plus Venice AI's VVV. NVDAon is for eligible non-US users only (Ondo); the app says so.
  ai: [
    { symbol: "NVDAon", weight: 5_000, anchored: true },
    { symbol: "VVV", weight: 5_000, anchored: false },
  ],
  "ai-index": [
    { symbol: "wNEAR", weight: 2_000, anchored: true },
    { symbol: "KAITO", weight: 2_000, anchored: false },
    { symbol: "VVV", weight: 2_000, anchored: false },
    { symbol: "PUBLIC", weight: 2_000, anchored: false },
    { symbol: "ITLX", weight: 2_000, anchored: false },
  ],
};
const legs = LEGS[preset];
if (!legs) throw new Error(`unknown preset ${preset}; use degen, ai or ai-index`);
const legTokens = legs.map((l) => ({ ...l, t: d.tokens.find((t) => t.symbol === l.symbol)! }));
const prices = new Map(await fetchOneClickPrices(legTokens.map((l) => l.t.token_id)));
// 1Click prices come back as USD per raw unit × 1e36; convert to dollars per whole token.
const usdOf = (t: { token_id: string; decimals: number }) => {
  const p = prices.get(t.token_id);
  if (!p) throw new Error(`1Click has no price for ${t.token_id}`);
  return (Number(BigInt(p)) / 1e36) * 10 ** t.decimals;
};
const basket = legTokens.map((l) => ({ token_id: l.t.token_id, weight_bps: l.weight, q: qFor(l.weight, "1", usdOf(l.t), l.t.decimals).toString(), anchored: l.anchored }));

if (await exists(id)) {
  console.log(`${id} already exists`);
} else {
  console.log(`Creating ${id} with ${fundNear} NEAR (code ${code.length} bytes); it comes back when the account is deleted`);
  const key = KeyPair.fromRandom("ed25519");
  saveKey(id, key);
  const res = await account(master).createSubAccount({ accountOrPrefix: ticker.toLowerCase(), publicKey: key.getPublicKey(), nearToTransfer: near(fundNear) });
  console.log(`  created ${id}\n    ${txLink(res.transaction_outcome.id)}`);
}
if ((await account(id).getState()).codeHash === "11111111111111111111111111111111") {
  const init = {
    ticker,
    name: ticker.charAt(0) + ticker.slice(1).toLowerCase(),
    icon: null,
    basket,
    fee_bps: 100,
    epoch_profile: "demo",
    bu_usd_e6: 1_000_000,
    creator: master,
    protocol: master,
    verifier: d.verifier,
    reporter: master,
  };
  const res = await account(id).signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(code), actions.functionCall("new", { init }, teraToGas(100), 0n)],
    waitUntil: "FINAL",
  });
  console.log(`  deployed and initialised $${ticker}\n    ${txLink(res.transaction_outcome.id)}`);
}

// NEAR Intents holds coins for MetaMask/Phantom buyers (a delivered buy mints to it, then credits the signer), so it
// needs storage on the coin once: about 0.00125 NEAR, paid by the master.
const reg = await view<{ total: string } | null>(id, "storage_balance_of", { account_id: d.verifier });
if (!reg) {
  const bounds = await view<{ min: string }>(id, "storage_balance_bounds", {});
  const res = await account(master).signAndSendTransaction({
    receiverId: id,
    actions: [actions.functionCall("storage_deposit", { account_id: d.verifier, registration_only: true }, teraToGas(30), BigInt(bounds.min))],
    waitUntil: "FINAL",
  });
  console.log(`  registered ${d.verifier} on $${ticker}\n    ${txLink(res.transaction_outcome.id)}`);
}

// The relayer for buys signed by MetaMask/Phantom (web/src/lib/server/xbuy.ts): it submits the buyer's signed
// intents with execute_intents and pays the gas. It never holds a buyer's assets and cannot alter what they signed.
// Its own sub-account, so the web server never holds the master key. Deleted (NEAR back) by mainnet-cleanup.ts.
const router = `router.${master}`;
if (!(await exists(router))) {
  const key = KeyPair.fromRandom("ed25519");
  saveKey(router, key);
  const res = await account(master).createSubAccount({ accountOrPrefix: "router", publicKey: key.getPublicKey(), nearToTransfer: near(0.15) });
  console.log(`  created ${router} (0.15 NEAR for relaying gas: at most ~0.03 per relayed trade)\n    ${txLink(res.transaction_outcome.id)}`);
}
const routerEnv = join(homedir(), "backed-ops/router.env");
mkdirSync(dirname(routerEnv), { recursive: true });
writeFileSync(routerEnv, `ROUTER_ACCOUNT_ID=${router}\nROUTER_PRIVATE_KEY=${loadKey(router)}\n`, { mode: 0o600 });
console.log(`  wrote ${routerEnv} (mode 600) for the mainnet web service`);

const state = await view<{ mode: string; price: string; floor: string }>(id, "get_state");
console.log(`  $${ticker} is live: mode ${state.mode}, price ${state.price}, floor ${state.floor}`);
saveDeployment({
  ...d,
  factory: "none",
  reporter: master,
  protocol: master,
  // Keep coins from earlier runs: the app lists them, and mainnet-cleanup deletes every one of them.
  coins: [
    ...(d.coins ?? []).filter((c) => c.account_id !== id),
    { account_id: id, ticker, name: ticker.charAt(0) + ticker.slice(1).toLowerCase(), creator: master, created_ms: Date.now() },
  ],
});
console.log(`Wrote deployments/mainnet.json (factory "none", coins: [${id}]). Rebuild the mainnet web build next.`);
console.log(`The fair launch window is 2 minutes; MetaMask/Phantom buys are refunded until it ends, then the first one opens the curve.`);
