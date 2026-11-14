// After the mainnet demo: delete the helper accounts (and, with --factory, the factory) so their NEAR goes
// back to the master account. Coins are untouched: they have no keys and keep working (buy, sell, redeem);
// only the factory's coin list and new launches go away with the factory, so delete it last, after judging.
// With --coin (the factory-less demo from mainnet-coin.ts) it also deletes the demo coin, which kept its key for
// exactly this: its whole storage deposit comes back. Sell first; it refuses while anyone still holds tokens.
// Usage: NETWORK=mainnet pnpm exec tsx src/mainnet-cleanup.ts <master.near> --yes-mainnet [--factory] [--coin]
import { actions } from "near-api-js";
import { NETWORK, account, exists, loadDeployment, txLink, view } from "./lib.js";

if (NETWORK !== "mainnet") throw new Error("this script is for NETWORK=mainnet");
const master = process.argv[2];
if (!master || master.startsWith("--")) throw new Error("usage: mainnet-cleanup <master.near> --yes-mainnet [--factory]");
const d = loadDeployment();
const ids = [`keeper.${master}`, `router.${master}`, d.reporter, d.protocol];
if (process.argv.includes("--factory")) ids.push(d.factory);
if (process.argv.includes("--coin")) {
  for (const c of d.coins ?? []) {
    const supply = BigInt(await view<string>(c.account_id, "ft_total_supply"));
    if (supply > 0n && !process.argv.includes("--force")) throw new Error(`${c.account_id} still has ${supply} tokens out; sell them first (or pass --force)`);
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
