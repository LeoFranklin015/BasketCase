// Launch ONE demo coin on mainnet: $DEGEN, backed 50% by BTC (anchored, can't be voted out) and 50% by USDC.
// USDC needs no swap, so a buy signs one 1Click intent (BTC) plus the send to the coin. Quantities per basket
// unit come from today's 1Click prices, so 1 basket unit = $1 at launch.
// Usage (after deploy): NETWORK=mainnet pnpm exec tsx src/mainnet-launch.ts <master.near> --yes-mainnet [--ticker DEGEN]
import { fetchOneClickPrices } from "../../packages/client/src/index.ts";
import { NETWORK, account, call, loadDeployment, qFor, view } from "./lib.js";

if (NETWORK !== "mainnet") throw new Error("this script is for NETWORK=mainnet; testnet coins come from seed.ts");
const master = process.argv[2];
if (!master || master.startsWith("--")) throw new Error("usage: mainnet-launch <master.near> --yes-mainnet [--ticker DEGEN]");
const ti = process.argv.indexOf("--ticker");
const ticker = ti > 0 ? process.argv[ti + 1]!.toUpperCase() : "DEGEN";
const d = loadDeployment();
if (d.factory.startsWith("PLACEHOLDER")) throw new Error("deploy the factory first (deploy.ts writes deployments/mainnet.json)");

const btc = d.tokens.find((t) => t.symbol === "BTC")!;
const usdc = d.tokens.find((t) => t.symbol === "USDC")!;
const prices = new Map(await fetchOneClickPrices([btc.token_id, usdc.token_id]));
// 1Click prices come back as USD per raw unit × 1e36; convert to dollars per whole token.
const usdOf = (t: { token_id: string; decimals: number }) => {
  const p = prices.get(t.token_id);
  if (!p) throw new Error(`1Click has no price for ${t.token_id}`);
  return (Number(BigInt(p)) / 1e36) * 10 ** t.decimals;
};
const basket = [
  { token_id: btc.token_id, weight_bps: 5_000, q: qFor(5_000, "1", usdOf(btc), btc.decimals).toString(), anchored: true },
  { token_id: usdc.token_id, weight_bps: 5_000, q: qFor(5_000, "1", usdOf(usdc), usdc.decimals).toString(), anchored: false },
];
const existing = await view<{ ticker: string; account_id: string }[]>(d.factory, "list_coins", { from: 0, limit: 100 });
const already = existing.find((c) => c.ticker === ticker);
if (already) {
  console.log(`$${ticker} already exists: ${already.account_id}`);
  process.exit(0);
}
const cfg = await view<{ launch_deposit: string }>(d.factory, "get_config");
console.log(`Launching $${ticker} on ${d.factory}: deposit ${(Number(BigInt(cfg.launch_deposit)) / 1e24).toFixed(3)} NEAR (locked in the coin for good)`);
console.log(`  BTC $${usdOf(btc).toFixed(0)}, USDC $${usdOf(usdc).toFixed(4)}; basket per unit: ${basket.map((b) => b.q).join(" / ")}`);
await call(
  account(master),
  d.factory,
  "create_coin",
  { config: { ticker, name: ticker.charAt(0) + ticker.slice(1).toLowerCase(), icon: null, basket, fee_bps: 100, epoch_profile: "demo", bu_usd_e6: 1_000_000, creator: null } },
  { deposit: BigInt(cfg.launch_deposit), tgas: 300, label: `launch $${ticker}` },
);
console.log(await view(d.factory, "list_coins", { from: 0, limit: 100 }));
