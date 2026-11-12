// Create testnet accounts from NEAR's faucet service and sweep them into one master account.
// Usage: pnpm --filter scripts exec tsx src/faucet.ts <master.testnet> [extra_accounts=0]
// The first account becomes the master (key saved to ~/.near-credentials/testnet). Each extra
// account is created and then deleted with the master as beneficiary, moving its NEAR over.
import { Account, KeyPair } from "near-api-js";
import { account, exists, provider, saveKey, sleep, txLink } from "./lib.js";

const HELPER = "https://helper.nearprotocol.com/account";

async function faucetCreate(accountId: string): Promise<KeyPair> {
  const key = KeyPair.fromRandom("ed25519");
  const res = await fetch(HELPER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused ${accountId}: ${res.status} ${await res.text()}`);
  for (let i = 0; i < 20 && !(await exists(accountId)); i++) await sleep(1_500);
  saveKey(accountId, key);
  return key;
}

const master = process.argv[2];
const extra = Number(process.argv[3] ?? 0);
if (!master) throw new Error("usage: faucet <master.testnet> [extra_accounts]");

if (!(await exists(master))) {
  await faucetCreate(master);
  console.log(`created ${master}`);
}
for (let i = 0; i < extra; i++) {
  const id = `${master.replace(/\.testnet$/, "")}-f${Date.now() % 1_000_000}.testnet`;
  const key = await faucetCreate(id);
  const a = new Account(id, provider, key.toString() as never);
  const res = await a.deleteAccount(master);
  console.log(`swept ${id} into ${master}\n  ${txLink(res.transaction_outcome.id)}`);
}
const bal = await account(master).getBalance();
console.log(`${master} balance: ${(Number(bal / 10n ** 21n) / 1000).toFixed(3)} NEAR`);
