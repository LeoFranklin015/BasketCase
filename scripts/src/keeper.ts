// Keeper (testnet by default; NETWORK=mainnet with --yes-mainnet for mainnet). Every job here is a permissionless call anyone could make; this just makes them on time:
// post prices (reporter key), settle fair launches, close ended epochs, and fill auctions once
// they reach the fair rate (testnet: paying with free faucet tokens; mainnet: buying the replacement
// through 1Click under a cap, see mainnet-fill.ts), and list every coin that graduates on Rhea (rhea.ts).
// Usage: pnpm --filter scripts keeper <master.testnet> [--once]
import { NETWORK, ONE_YOCTO, account, call, callBatch, loadDeployment, sleep, view } from "./lib.js";
import { fillViaOneClick } from "./mainnet-fill.js";
import { buyWithFaucet, reportPrices } from "./chain.js";
import { coinAmountFor, knownPools, listOnRhea } from "./rhea.js";

const master = process.argv[2];
if (!master) throw new Error("usage: keeper <master.testnet> [--once]");
const once = process.argv.includes("--once");
const d = loadDeployment();
const keeper = account(`keeper.${master}`);
const reporter = account(d.reporter);
const lastReport = new Map<string, number>();
const REPORT_EVERY_MS = 120_000;

type State = { mode: string; launch: { ends_ms: number }; epoch: { end_ms: number } };
type Auction = { replacement: string; target_left: string; rate_now: string; ramp_end_ms: number };
type Epoch = { challenges: { replacement: string }[] };

async function tend(coin: string) {
  const now = Date.now();
  const s = await view<State>(coin, "get_state");
  const basket = await view<{ token_id: string }[]>(coin, "get_basket");
  const epoch = await view<Epoch>(coin, "get_epoch");
  if (now - (lastReport.get(coin) ?? 0) > REPORT_EVERY_MS) {
    const ids = [...new Set([...basket.map((b) => b.token_id), ...epoch.challenges.map((c) => c.replacement)])];
    await reportPrices(reporter, coin, ids);
    lastReport.set(coin, now);
  }
  if (s.mode === "launch" && now >= s.launch.ends_ms) {
    await call(keeper, coin, "settle_launch", { limit: 40 }, { tgas: 300, label: `settle the fair launch of ${coin}` });
  }
  if (now >= s.epoch.end_ms) {
    // Prices must be fresh at close: post them right before.
    const ids = [...new Set([...basket.map((b) => b.token_id), ...epoch.challenges.map((c) => c.replacement)])];
    await reportPrices(reporter, coin, ids);
    const r = await call<string>(keeper, coin, "close_epoch", {}, { tgas: 100, label: `close the epoch of ${coin}` });
    console.log(`    outcome: ${r.result}`);
  }
  if (s.mode === "index" && knownPools()[coin] === undefined) await listGraduated(coin);
  const a = await view<Auction | null>(coin, "get_auction");
  if (a && now >= a.ramp_end_ms && BigInt(a.target_left) > 0n) {
    const need = (BigInt(a.target_left) * BigInt(a.rate_now)) / 10n ** 18n + 2n;
    if (NETWORK === "mainnet") return void (await fillViaOneClick(keeper, d, coin, a.replacement, need));
    await callBatch(
      keeper,
      d.verifier,
      [
        { method: "faucet", args: { token_id: a.replacement, amount: need.toString(), receiver_id: null }, tgas: 10 },
        { method: "mt_transfer_call", args: { receiver_id: coin, token_id: a.replacement, amount: need.toString(), approval: null, memo: null, msg: JSON.stringify({ action: "fill_auction", min_out: "0" }) }, deposit: ONE_YOCTO, tgas: 150 },
      ],
      `fill the auction on ${coin} with ${a.replacement}`,
    );
  }
}

/**
 * A coin just graduated: open its Rhea pool (coin/wNEAR) at the coin's own price. The keeper buys the coin
 * side through the coin's own pool first. Testnet pays with faucet tokens; on mainnet this spends real money,
 * so it only runs with RHEA_AUTO=1 (and uses coin tokens the keeper already holds).
 */
const RHEA_NEAR = Number(process.env.RHEA_NEAR ?? (NETWORK === "mainnet" ? 0.5 : 1));
async function listGraduated(coin: string) {
  if (NETWORK === "mainnet" && process.env.RHEA_AUTO !== "1") return;
  const need = await coinAmountFor(coin, RHEA_NEAR);
  const have = BigInt(await view<string>(coin, "ft_balance_of", { account_id: keeper.accountId }));
  if (have < need && NETWORK !== "mainnet") {
    // Buy ~20% more than needed (in basket units ≈ dollars) through the coin's pool.
    const st = await view<{ price: string }>(coin, "get_state");
    const bu = ((need - have) * BigInt(st.price) * 12n) / 10n / 10n ** 18n;
    console.log(`  ${coin} graduated: buying its Rhea side`);
    await buyWithFaucet(keeper, coin, bu > 10n ** 18n ? bu : 10n ** 18n);
  }
  console.log(`  ${coin} graduated: listing it on Rhea`);
  const id = await listOnRhea(coin, keeper, RHEA_NEAR);
  console.log(`    ${coin} now trades on Rhea, pool ${id}`);
}

do {
  try {
    const coins = await view<{ account_id: string }[]>(d.factory, "list_coins", { from: 0, limit: 200 });
    for (const c of coins) {
      try {
        await tend(c.account_id);
      } catch (e) {
        console.error(`  ${c.account_id}: ${(e as Error).message.slice(0, 300)}`);
      }
      await sleep(2_000); // spread RPC load: the public endpoints rate-limit
    }
  } catch (e) {
    console.error(`  pass skipped: ${(e as Error).message.slice(0, 200)}`);
  }
  // 90 s between passes: epochs are 10 min and auctions ramp for 2 min, and the free RPCs rate-limit this host.
  if (!once) await sleep(90_000);
} while (!once);
