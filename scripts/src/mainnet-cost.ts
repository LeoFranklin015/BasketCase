// What a one-coin mainnet demo costs, from the real contract size and today's NEAR price (1Click).
// Read-only: signs and sends nothing. Usage: cd scripts && pnpm mainnet:cost [--buy 2] [--factory]
// NEAR storage costs 1 NEAR per 100 KB (10^19 yoctoNEAR per byte). Storage NEAR held by an account with a
// key comes back when that account is deleted; a coin has no keys, so its storage stays locked for good.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.js";

const BYTE = 1e-5; // NEAR per byte of storage
const STATE_ALLOWANCE = 60_000; // bytes the factory adds for a coin's state (contracts/factory/src/lib.rs)
const ACCOUNT_BYTES = 182 + 100; // a bare named account plus one access key, roughly
const size = (n: string) => readFileSync(join(ROOT, `target/near/${n}/${n}.wasm`)).length;

async function nearUsd(): Promise<number> {
  try {
    const r = await fetch("https://1click.chaindefuser.com/v0/tokens");
    const list = (await r.json()) as { assetId: string; price: number }[];
    return list.find((t) => t.assetId === "nep141:wrap.near")?.price ?? 3;
  } catch {
    return 3;
  }
}

const bi = process.argv.indexOf("--buy");
const buyUsd = bi > 0 ? Number(process.argv[bi + 1]) : 2;
const usd = await nearUsd();
const factory = size("factory");
const coin = size("coin");

const plan = process.argv.includes("--factory") ? "factory" : "direct";
const coinNear = plan === "direct" ? Math.ceil((coin + 25_000) / 1_000) / 100 : (coin + STATE_ALLOWANCE) * BYTE;
const factoryNear = plan === "factory" ? Math.ceil(factory / 10_000) / 10 + 0.5 : 0;
const helperNear = plan === "factory" ? 0.45 : 0.35; // direct plan: router.<master>, the relayer that pays gas for signed MetaMask/Phantom intents
const gasNear = 0.06; // create + deploy the coin, a buy, a sell, delete: a few mNEAR each, rounded up
const regNear = 0.01; // the buyer's storage with the coin (NEP-145) and NEAR Intents key registration
const upfrontNear = factoryNear + coinNear + helperNear + gasNear + regNear;
// Direct plan: the coin keeps its key and is deleted after the demo, so its whole deposit comes back.
// Factory plan: the coin is keyless (as on testnet) and its storage stays locked for good.
const lockedNear = plan === "direct" ? 0 : coinNear;
const backNear = upfrontNear - gasNear - regNear - lockedNear - ACCOUNT_BYTES * BYTE;
const tradeLossUsd = buyUsd * (0.01 + 0.01 + 0.005) + buyUsd * 0.01; // fees both ways, ~0.5% 1Click, ~1% of the buy left in the vault as fees
const $ = (n: number) => `$${(n * usd).toFixed(2)}`;
const f = (n: number) => `${n.toFixed(2)} NEAR`;

console.log(`Plan: ${plan === "direct" ? "one coin deployed directly, deleted after the demo (default)" : "factory + keyless coin (--factory)"}`);
console.log(`NEAR price (1Click): $${usd.toFixed(2)}   factory wasm ${(factory / 1000).toFixed(0)} KB   coin wasm ${(coin / 1000).toFixed(0)} KB\n`);
const rows: [string, string, string, string][] = [
  ...(plan === "factory"
    ? ([["Factory account", f(factoryNear), $(factoryNear), "back after cleanup"], ["Reporter, protocol, keeper", f(helperNear), $(helperNear), "back after cleanup"]] as [string, string, string, string][])
    : ([["Relayer (pays gas for MetaMask/Phantom intents)", f(helperNear), $(helperNear), "back after cleanup"]] as [string, string, string, string][])),
  ["The coin's storage deposit", f(coinNear), $(coinNear), plan === "direct" ? "ALL back when the coin is deleted" : "LOCKED: the coin has no keys"],
  ["Gas for every transaction", f(gasNear), $(gasNear), "spent"],
  ["Buyer registrations", f(regNear), $(regNear), "spent"],
  [`Test buy of $${buyUsd} USDC, then sell`, `$${buyUsd.toFixed(2)}`, `$${buyUsd.toFixed(2)}`, `~$${(buyUsd - tradeLossUsd).toFixed(2)} back`],
];
for (const r of rows) console.log(`${r[0].padEnd(36)} ${r[1].padStart(10)} ${r[2].padStart(9)}   ${r[3]}`);
const spentUsd = (gasNear + regNear + lockedNear) * usd + tradeLossUsd;
console.log(`\nWallet needs for a few minutes: ${f(upfrontNear)} (${$(upfrontNear)}) + $${buyUsd} USDC`);
console.log(`Comes back: ${f(backNear)} (${$(backNear)}) + ~$${(buyUsd - tradeLossUsd).toFixed(2)} USDC`);
console.log(`Actually spent: about $${spentUsd.toFixed(2)}`);
