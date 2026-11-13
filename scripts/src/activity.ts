// Testnet activity from our own accounts (trader1..3), so charts and logs have history.
// Every trade it makes is labelled in the README as ours, not organic.
// Usage: pnpm --filter scripts exec tsx src/activity.ts <master.testnet> [minutes=60] [gapSeconds=30]
// A small gap (e.g. 3) runs a quick burst instead of a slow trickle.
import { KeyPair } from "near-api-js";
import { ONE_YOCTO, account, call, exists, loadDeployment, near, saveKey, sleep, txLink, view } from "./lib.js";
import { buyWithUsdc, faucet } from "./chain.js";

const master = process.argv[2];
if (!master) throw new Error("usage: activity <master.testnet> [minutes]");
const minutes = Number(process.argv[3] ?? 60);
const gap = Number(process.argv[4] ?? 30);
const d = loadDeployment();
const E18 = 10n ** 18n;
const USDC = "nep141:usdc.mock";

async function trader(i: number) {
  const prefix = `trader${i}`;
  const id = `${prefix}.${master}`;
  if (!(await exists(id))) {
    const key = KeyPair.fromRandom("ed25519");
    saveKey(id, key);
    const res = await account(master).createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: near(1.5) });
    console.log(`created ${id} ${txLink(res.transaction_outcome.id)}`);
  }
  return account(id);
}

const traders = await Promise.all([1, 2, 3].map(trader));
for (const t of traders) await faucet(t, [{ token_id: USDC, amount: 20_000n * 10n ** 6n }]);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const end = Date.now() + minutes * 60_000;

while (Date.now() < end) {
  try {
    await tick();
  } catch (e) {
    console.error(`  tick skipped: ${(e as Error).message.slice(0, 160)}`);
  }
  await sleep(rand(gap * 500, gap * 1500));
}

async function tick() {
  const coins = (await view<{ account_id: string; ticker: string }[]>(d.factory, "list_coins", { from: 0, limit: 50 })).filter((c) => !c.ticker.startsWith("DEMO"));
  const coin = coins[Math.floor(Math.random() * coins.length)]!;
  const t = traders[Math.floor(Math.random() * traders.length)]!;
  const state = await view<{ mode: string }>(coin.account_id, "get_state");
  const bal = BigInt(await view<string>(coin.account_id, "ft_balance_of", { account_id: t.accountId }));
  const roll = Math.random();
  try {
    if (state.mode === "launch" || bal === 0n || roll < 0.55) {
      const bu = BigInt(Math.round(rand(3, 60) * 100)) * E18 / 100n;
      await buyWithUsdc(t, coin.account_id, bu);
    } else if (roll < 0.9) {
      const amt = (bal * BigInt(Math.round(rand(10, 45)))) / 100n;
      await call(t, coin.account_id, "sell", { amount: amt.toString(), min_bu_out: "0", receiver_id: null }, { deposit: ONE_YOCTO, tgas: 100, label: `${t.accountId} sells on $${coin.ticker}` });
    } else {
      const basket = await view<{ token_id: string; anchored: boolean; held: string }[]>(coin.account_id, "get_basket");
      const target = basket.find((b) => !b.anchored && BigInt(b.held) > 0n);
      if (target) {
        const pool = ["nep141:sol.mock", "nep141:eth.mock", "nep141:doge.mock", "nep141:pepe.mock"].filter((x) => !basket.some((b) => b.token_id === x));
        const amt = (bal * BigInt(Math.round(rand(2, 8)))) / 100n;
        if (Math.random() < 0.6 && pool.length) {
          await call(t, coin.account_id, "challenge", { target: target.token_id, replacement: pool[0], amount: amt.toString() }, { deposit: ONE_YOCTO, tgas: 100, label: `${t.accountId} challenges on $${coin.ticker}` });
        } else {
          await call(t, coin.account_id, "defend", { target: target.token_id, amount: amt.toString() }, { deposit: ONE_YOCTO, tgas: 100, label: `${t.accountId} defends on $${coin.ticker}` });
        }
      }
    }
  } catch (e) {
    console.error(`  skipped: ${(e as Error).message.slice(0, 200)}`);
  }
}
