// The mainnet master wallet, in two steps.
//
//   pnpm exec tsx src/mainnet-wallet.ts new
//     Generates a NEAR seed phrase (standard derivation m/44'/397'/0', so it imports into any NEAR wallet) and its
//     implicit account (the hex of the public key). Nothing is sent and nothing is spent. The seed phrase goes to
//     ~/backed-ops/mainnet-wallet-seed.txt (mode 600) and is never printed; the key goes to
//     ~/.near-credentials/mainnet/<implicit>.json (mode 600). Fund the implicit account to create it.
//
//   NETWORK=mainnet pnpm exec tsx src/mainnet-wallet.ts name <name.near> --yes-mainnet
//     After funding: registers <name.near> through the `near` registrar with the same key, moves all but 0.05 NEAR
//     into it (what stays pays this transaction's gas), checks the new account really carries the key, and only then
//     saves its credentials. It never touches an account that already exists unless that account already has this
//     key. <name.near> is then the master for mainnet-coin.ts.
import { KeyPair, actions, teraToGas, type KeyPairString } from "near-api-js";
import { generateSeedPhrase } from "near-seed-phrase";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OPS = join(homedir(), "backed-ops");
const SEED_FILE = join(OPS, "mainnet-wallet-seed.txt");
const CRED = join(homedir(), ".near-credentials/mainnet");
const IMPLICIT_FILE = join(OPS, "mainnet-wallet-implicit.txt");

const cmd = process.argv[2];
if (cmd === "new") {
  if (existsSync(SEED_FILE)) {
    console.log(`A wallet already exists; not overwriting it.\nAccount: ${readFileSync(IMPLICIT_FILE, "utf8").trim()}\nSeed phrase: ${SEED_FILE}`);
    process.exit(0);
  }
  const { seedPhrase, secretKey, publicKey } = generateSeedPhrase();
  const key = KeyPair.fromString(secretKey as KeyPairString);
  const implicit = Buffer.from(key.getPublicKey().data).toString("hex");
  mkdirSync(OPS, { recursive: true });
  mkdirSync(CRED, { recursive: true });
  writeFileSync(SEED_FILE, `${seedPhrase}\n`, { mode: 0o600 });
  writeFileSync(IMPLICIT_FILE, `${implicit}\n`, { mode: 0o600 });
  writeFileSync(join(CRED, `${implicit}.json`), JSON.stringify({ account_id: implicit, public_key: publicKey, private_key: secretKey }), { mode: 0o600 });
  console.log(`Account (fund this address with NEAR): ${implicit}`);
  console.log(`Public key: ${publicKey}`);
  console.log(`Seed phrase saved to ${SEED_FILE} (mode 600); not printed.`);
} else if (cmd === "name") {
  const name = process.argv[3];
  if (!name?.endsWith(".near") || name.split(".").length !== 2) throw new Error("usage: mainnet-wallet name <name.near> --yes-mainnet");
  const { NETWORK, account, exists, loadKey, provider, saveKey, txLink } = await import("./lib.js");
  if (NETWORK !== "mainnet") throw new Error("run with NETWORK=mainnet");
  const implicit = readFileSync(IMPLICIT_FILE, "utf8").trim();
  const keyStr = JSON.parse(readFileSync(join(CRED, `${implicit}.json`), "utf8")).private_key as KeyPairString;
  const key = KeyPair.fromString(keyStr);
  const pk = key.getPublicKey().toString();
  const hasOurKey = async () => {
    try {
      await provider.viewAccessKey({ accountId: name, publicKey: pk, finalityQuery: { finality: "final" } });
      return true;
    } catch {
      return false;
    }
  };
  if (await exists(name)) {
    // Someone else's account, or one created with another key: refuse rather than overwrite its credentials.
    if (!(await hasOurKey())) throw new Error(`${name} already exists and does not carry this wallet's key; pick another name`);
    if (loadKey(name) && loadKey(name) !== keyStr) throw new Error(`credentials for ${name} already exist with a different key; not overwriting them`);
    console.log(`${name} already exists with this wallet's key`);
  } else {
    const from = account(implicit);
    const state = await from.getState();
    const keep = 10n ** 23n; // 0.1 NEAR stays behind: the RPC reserves gas at a pessimistic price before it runs
    const send = BigInt(state.balance.available) - keep;
    if (send < 2n * 10n ** 23n) throw new Error(`${implicit} has too little NEAR (${state.balance.available} yocto); fund it first`);
    const res = await from.signAndSendTransaction({
      receiverId: "near",
      actions: [actions.functionCall("create_account", { new_account_id: name, new_public_key: key.getPublicKey().toString() }, teraToGas(50), send)],
      waitUntil: "FINAL",
    });
    // The registrar refunds in a callback and the transaction still succeeds when it fails: check the result.
    if (!(await exists(name)) || !(await hasOurKey())) {
      throw new Error(`the registrar did not create ${name} (the deposit is refunded to ${implicit})\n    ${txLink(res.transaction_outcome.id)}`);
    }
    console.log(`Created ${name} with ${Number(send / 10n ** 21n) / 1000} NEAR\n    ${txLink(res.transaction_outcome.id)}`);
  }
  saveKey(name, key);
  console.log(`Saved ${name} credentials (same key as the seed phrase).`);
} else {
  throw new Error("usage: mainnet-wallet new | mainnet-wallet name <name.near> --yes-mainnet");
}
