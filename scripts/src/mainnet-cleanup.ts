// After the mainnet demo: delete the helper accounts (and, with --factory, the factory) so their NEAR goes
// back to the master account. Coins are untouched: they have no keys and keep working (buy, sell, redeem);
// only the factory's coin list and new launches go away with the factory, so delete it last, after judging.
// With --coin (the factory-less demo from mainnet-coin.ts) it also deletes the demo coin, which kept its key for
// exactly this: its whole storage deposit comes back. Sell first; it refuses while anyone still holds tokens.
// Usage: NETWORK=mainnet pnpm exec tsx src/mainnet-cleanup.ts <master.near> --yes-mainnet [--factory] [--coin]
import { actions, teraToGas } from "near-api-js";
import { NETWORK, account, exists, loadDeployment, saveDeployment, txLink, view } from "./lib.js";

if (NETWORK !== "mainnet") throw new Error("this script is for NETWORK=mainnet");
const master = process.argv[2];
if (!master || master.startsWith("--")) throw new Error("usage: mainnet-cleanup <master.near> --yes-mainnet [--factory]");
const d = loadDeployment();
const ids = [`keeper.${master}`, `router.${master}`, d.reporter, d.protocol];
if (process.argv.includes("--factory")) ids.push(d.factory);
if (process.argv.includes("--coin")) {
  for (const c of d.coins ?? []) {
    if (!(await exists(c.account_id))) {
      console.log(`  ${c.account_id}: already gone`);
      continue;
    }
    const supply = BigInt(await view<string>(c.account_id, "ft_total_supply"));
    if (supply > 0n && !process.argv.includes("--force")) throw new Error(`${c.account_id} still has ${supply} tokens out; sell them first (or pass --force)`);
    const st = await view<{ creator_owed: string; protocol_owed: string; launch: { settled: boolean; queued_bu: string } }>(c.account_id, "get_state");
    // Fair-launch deposits are not tokens yet, so supply 0 doesn't cover them: never delete over someone's deposit.
    if (BigInt(st.launch.queued_bu) > 0n) throw new Error(`${c.account_id} holds queued fair-launch deposits; settle the launch and let them sell first`);
    // The fee shares (and any surplus swept to the protocol) sit in NEAR Intents under the coin: pay them out to the
    // creator and protocol (the master) before the coin account is deleted, or they are left behind.
    if (BigInt(st.creator_owed) + BigInt(st.protocol_owed) > 0n) {
      const res = await account(master).signAndSendTransaction({
        receiverId: c.account_id,
        actions: [actions.functionCall("claim_fees", {}, teraToGas(150), 0n)],
        waitUntil: "FINAL",
      });
      console.log(`  claimed $${c.ticker} fees to ${master} in NEAR Intents\n    ${txLink(res.transaction_outcome.id)}`);
    }
    // A payout that failed (claim_fees included) is recorded in `owed`: retry it, and never delete over it.
    for (const who of new Set([master, d.protocol, d.reporter].filter(Boolean))) {
      const owed = await view<unknown[]>(c.account_id, "get_owed", { account_id: who });
      if (owed.length) {
        await account(master).signAndSendTransaction({ receiverId: c.account_id, actions: [actions.functionCall("withdraw_owed", { account_id: who }, teraToGas(150), 0n)], waitUntil: "FINAL" });
        const still = await view<unknown[]>(c.account_id, "get_owed", { account_id: who });
        if (still.length) throw new Error(`${c.account_id} still owes ${who} ${JSON.stringify(still)}; not deleting it`);
        console.log(`  paid out what $${c.ticker} owed ${who}`);
      }
    }
    // Rounding dust in the basket stays under the deleted account; say how much so nothing is lost silently.
    const basket = await view<{ token_id: string; held: string }[]>(c.account_id, "get_basket");
    const dust = basket.filter((b) => BigInt(b.held) > 0n);
    if (dust.length) {
      const label = supply > 0n ? "the basket STILL BACKING HOLDERS (--force)" : "basket dust";
      console.log(`  $${c.ticker} leaves ${label} in NEAR Intents: ${dust.map((b) => `${b.held} raw ${b.token_id}`).join(", ")}`);
    }
    console.log(`  note: payouts that failed earlier (get_owed) can't be listed here; call withdraw_owed for any you know of first`);
    ids.push(c.account_id);
  }
}

for (const id of ids) {
  if (!id.endsWith(`.${master}`)) {
    console.log(`  skip ${id}: not a sub-account of ${master}`);
    continue;
  }
  if (!(await exists(id))) {
    console.log(`  ${id}: already gone`);
    continue;
  }
  const res = await account(id).signAndSendTransaction({ receiverId: id, actions: [actions.deleteAccount(master)], waitUntil: "FINAL" });
  console.log(`  deleted ${id}; its NEAR went to ${master}\n    ${txLink(res.transaction_outcome.id)}`);
}

// Forget coins that no longer exist, so the app stops listing them and the next cleanup doesn't trip over them.
if (d.coins?.length) {
  const live = [];
  for (const c of d.coins) if (await exists(c.account_id)) live.push(c);
  if (live.length !== d.coins.length) {
    saveDeployment({ ...d, coins: live });
    console.log(`  deployments/mainnet.json now lists ${live.length} coin(s)`);
  }
}
