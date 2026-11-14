// List a graduated coin on Rhea by hand. The keeper does this automatically when a coin graduates
// (keeper.ts); this is the same step for anyone holding the coin. See rhea.ts.
// Usage: pnpm exec tsx src/rhea-list.ts <coin> --provider <account> [--near 1]   (NETWORK=mainnet … --yes-mainnet)
import { account, view } from "./lib.js";
import { EXCHANGE, knownPools, listOnRhea } from "./rhea.js";

const coin = process.argv[2];
const pi = process.argv.indexOf("--provider");
const provider = pi > 0 ? process.argv[pi + 1] : undefined;
const ni = process.argv.indexOf("--near");
const nearIn = ni > 0 ? Number(process.argv[ni + 1]) : 1;
if (!coin || !provider) throw new Error("usage: rhea-list <coin> --provider <account> [--near 1]");

const known = knownPools()[coin];
if (known !== undefined) {
  console.log(`${coin} is already on Rhea: pool ${known}`);
  process.exit(0);
}
const id = await listOnRhea(coin, account(provider), nearIn);
console.log(await view(EXCHANGE, "get_pool", { pool_id: id }));
console.log(`${coin} is on Rhea: pool ${id}`);
