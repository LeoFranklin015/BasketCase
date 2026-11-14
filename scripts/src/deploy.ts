// Deploy the stack under a master account and write deployments/<NETWORK>.json (testnet by default;
// NETWORK=mainnet needs --yes-mainnet and keeps the real asset list already in deployments/mainnet.json).
// Usage: pnpm --filter scripts deploy <master.testnet> [--factory <prefix>]
// Coins have no keys, so new coin code means a new factory: pass a new prefix.
// The master needs a key in ~/.near-credentials/testnet and about 30 NEAR (see faucet.ts).
import { KeyPair, actions, teraToGas } from "near-api-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORK, ROOT, RPC, TOKENS, account, exists, loadDeployment, near, saveDeployment, saveKey, txLink } from "./lib.js";

const master = process.argv[2];
if (!master) throw new Error("usage: deploy <master.testnet> [--factory <prefix>]");
const fi = process.argv.indexOf("--factory");
const factoryPrefix = fi > 0 ? process.argv[fi + 1] : "factory";
const m = account(master);

const wasm = (name: string) => readFileSync(join(ROOT, `target/near/${name}/${name}.wasm`));

async function ensureSub(prefix: string, nearAmount: number): Promise<string> {
  const id = `${prefix}.${master}`;
  if (await exists(id)) return id;
  const key = KeyPair.fromRandom("ed25519");
  saveKey(id, key);
  const res = await m.createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: near(nearAmount) });
  console.log(`  created ${id}\n    ${txLink(res.transaction_outcome.id)}`);
  return id;
}

async function deployAndInit(id: string, code: Buffer, args: object) {
  const a = account(id);
  const res = await a.signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(code), actions.functionCall("new", args, teraToGas(50), 0n)],
    waitUntil: "FINAL",
  });
  console.log(`  deployed ${id} (${code.length} bytes)\n    ${txLink(res.transaction_outcome.id)}`);
}

async function hasCode(id: string) {
  try {
    const a = account(id);
    const s = await a.getState();
    return s.codeHash !== "11111111111111111111111111111111";
  } catch {
    return false;
  }
}

const factoryWasm = wasm("factory");
// Storage is 1 NEAR per 100 KB. Testnet keeps generous slack; mainnet funds only what a demo needs
// (every helper account can be deleted afterwards to get its NEAR back: scripts/src/mainnet-cleanup.ts).
const MAINNET = NETWORK === "mainnet";
const factoryNear = MAINNET ? Math.ceil(factoryWasm.length / 10_000) / 10 + 0.5 : Math.ceil(factoryWasm.length / 100_000) + 2;
const FUND = MAINNET ? { reporter: 0.1, protocol: 0.05, keeper: 0.3 } : { reporter: 2, protocol: 1, keeper: 4 };
console.log(`Deploying under ${master} (factory wasm ${factoryWasm.length} bytes, ${factoryNear} NEAR)`);

// Mainnet uses the real verifier and 1Click; the stand-ins exist only on testnet.
const verifier = NETWORK === "mainnet" ? "intents.near" : await ensureSub("intents", 3);
const swapper = NETWORK === "mainnet" ? "1click" : await ensureSub("swapper", 3);
const reporter = await ensureSub("reporter", FUND.reporter);
const protocol = await ensureSub("protocol", FUND.protocol);
const keeper = await ensureSub("keeper", FUND.keeper);
const factory = await ensureSub(factoryPrefix, factoryNear);

if (NETWORK === "testnet") {
  if (!(await hasCode(verifier))) await deployAndInit(verifier, wasm("mock_intents"), {});
  if (!(await hasCode(swapper))) await deployAndInit(swapper, wasm("mock_swapper"), { owner: master, verifier });
}
if (!(await hasCode(factory))) await deployAndInit(factory, factoryWasm, { reporter, protocol, verifier, launch_fee: MAINNET ? "0" : (10n ** 23n).toString() });

saveDeployment({
  network: NETWORK,
  rpc: RPC,
  factory,
  verifier,
  swapper,
  reporter,
  protocol,
  // Testnet: the mock tokens from constants.json. Mainnet: the real NEAR Intents assets already listed in mainnet.json.
  tokens: NETWORK === "mainnet" ? loadDeployment().tokens : TOKENS.map(({ symbol, token_id, decimals }) => ({ symbol, token_id, decimals })),
});
// The keeper account is a convenience (settles, closes epochs, fills auctions); anyone can do its job.
console.log(`Wrote deployments/${NETWORK}.json. Keeper account: ${keeper}`);
