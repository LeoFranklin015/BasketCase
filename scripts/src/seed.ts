// Seed the testnet stack: swapper prices and inventory, then launch the three flagship coins.
// Usage: pnpm --filter scripts seed <master.testnet> [--no-launch]
import { ONE_YOCTO, TOKENS, account, call, callBatch, decimalToScaled, loadDeployment, qFor, tokenBySymbol, view } from "./lib.js";
import { swapperPrices } from "./chain.js";

const master = process.argv[2];
if (!master) throw new Error("usage: seed <master.testnet>");
const m = account(master);
const d = loadDeployment();

console.log("Swapper prices");
await call(m, d.swapper, "set_prices", { prices: swapperPrices() }, { tgas: 30, label: `set ${TOKENS.length} prices on the swapper` });

console.log("Swapper inventory ($10M of each asset, from the faucet)");
const CAP = 10n ** 30n;
for (const t of TOKENS) {
  const have = BigInt(await view<string>(d.swapper, "get_inventory", { token_id: t.token_id }));
  if (have > 0n) continue;
  const amount = (10_000_000n * 10n ** BigInt(t.decimals) * 10n ** 18n) / decimalToScaled(t.usd, 18); // exact for sub-cent memecoins too
  const a = amount > CAP ? CAP : amount;
  await callBatch(
    m,
    d.verifier,
    [
      { method: "faucet", args: { token_id: t.token_id, amount: a.toString(), receiver_id: null }, tgas: 10 },
      { method: "mt_transfer_call", args: { receiver_id: d.swapper, token_id: t.token_id, amount: a.toString(), approval: null, memo: null, msg: '"seed"' }, deposit: ONE_YOCTO, tgas: 80 },
    ],
    `stock ${t.symbol}`,
  );
}

if (process.argv.includes("--no-launch")) process.exit(0);

type Leg = { symbol: string; weight: number; anchored: boolean };
const FLAGSHIPS: { ticker: string; name: string; legs: Leg[] }[] = [
  { ticker: "DEGEN", name: "Degen", legs: [{ symbol: "BTC", weight: 5_000, anchored: true }, { symbol: "USDC", weight: 5_000, anchored: false }] },
  { ticker: "TRENCH", name: "Trench", legs: ["PEPE", "DOGE", "WIF", "BONK"].map((symbol) => ({ symbol, weight: 2_500, anchored: false })) },
  { ticker: "CHIPS", name: "Chips", legs: [{ symbol: "NVDA", weight: 4_000, anchored: true }, { symbol: "BTC", weight: 3_000, anchored: false }, { symbol: "SOL", weight: 3_000, anchored: false }] },
  // NEAR's own memecoins next to one from Ethereum: what a NEAR Intents basket can mix.
  { ticker: "MEMES", name: "Near Memes", legs: ["BLACKDRAGON", "SHITZU", "JAMBO", "PEPE"].map((symbol) => ({ symbol, weight: 2_500, anchored: false })) },
  // An AI index: the AI tokens NEAR Intents can route on mainnet (NVIDIA itself is not available there).
  // The landing's showcase: NVIDIA plus the two chains everyone knows.
  { ticker: "GPU", name: "GPU Index", legs: [{ symbol: "NVDA", weight: 4_000, anchored: true }, { symbol: "ETH", weight: 3_000, anchored: false }, { symbol: "SOL", weight: 3_000, anchored: false }] },
  { ticker: "AI", name: "AI Index", legs: ["KAITO", "VVV", "PUBLIC", "ITLX"].map((symbol) => ({ symbol, weight: 2_500, anchored: false })) },
];

const existing = await view<{ ticker: string }[]>(d.factory, "list_coins", { from: 0, limit: 100 });
const cfg = await view<{ launch_deposit: string }>(d.factory, "get_config");
console.log("Flagship launches");
for (const f of FLAGSHIPS) {
  if (existing.some((c) => c.ticker === f.ticker)) continue;
  const basket = f.legs.map((l) => {
    const t = tokenBySymbol(l.symbol);
    return { token_id: t.token_id, weight_bps: l.weight, q: qFor(l.weight, "1", t.usd, t.decimals).toString(), anchored: l.anchored };
  });
  await call(
    m,
    d.factory,
    "create_coin",
    { config: { ticker: f.ticker, name: f.name, icon: null, basket, fee_bps: 100, epoch_profile: "demo", bu_usd_e6: 1_000_000, creator: null } },
    { deposit: BigInt(cfg.launch_deposit), tgas: 300, label: `launch $${f.ticker}` },
  );
}
console.log(await view(d.factory, "list_coins", { from: 0, limit: 100 }));
