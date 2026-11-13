// Mainnet auction fills for the keeper: buy the replacement asset through 1Click inside NEAR Intents
// (a NEP-413 intent signed with the keeper's own key), then send it to the coin with mt_transfer_call,
// exactly like the testnet fill but without the faucet. Spends real USDC, so every fill is capped by
// KEEPER_MAX_FILL_USD (default $10), the total ever spent by KEEPER_MAX_TOTAL_USD (default $30, kept in
// .keys/keeper-mainnet-spend.json so restarts don't reset it), and the keeper only runs on mainnet with
// --yes-mainnet. A replacement the keeper already holds (e.g. from a swap whose fill failed) is used first.
import { KeyPair, type Account, type KeyPairString } from "near-api-js";
import {
  fetchOneClickPrices,
  nep413Hash,
  nep413SignedPayload,
  swapInsideIntents,
  waitForSwap,
  type Nep413Payload,
} from "../../packages/client/src/index.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ONE_YOCTO, ROOT, type Deployment, call, callBatch, loadKey, view } from "./lib.js";

const MAX_USD = Number(process.env.KEEPER_MAX_FILL_USD ?? 10);
const MAX_TOTAL_USD = Number(process.env.KEEPER_MAX_TOTAL_USD ?? 30);
const SPEND_FILE = join(ROOT, ".keys/keeper-mainnet-spend.json");
const spent = (): number => (existsSync(SPEND_FILE) ? Number(JSON.parse(readFileSync(SPEND_FILE, "utf8")).usd ?? 0) : 0);
function addSpent(usd: number) {
  mkdirSync(dirname(SPEND_FILE), { recursive: true });
  writeFileSync(SPEND_FILE, JSON.stringify({ usd: spent() + usd, updated: new Date().toISOString() }) + "\n");
}

/** USD value of `amount` raw units of `token_id` at 1Click's price; null when 1Click doesn't list it. */
export async function usdValue(token_id: string, amount: bigint): Promise<number | null> {
  const [row] = await fetchOneClickPrices([token_id]);
  return row ? Number((amount * BigInt(row[1])) / 10n ** 30n) / 1e6 : null;
}

export async function fillViaOneClick(keeper: Account, d: Deployment, coin: string, replacement: string, need: bigint): Promise<void> {
  const usd = await usdValue(replacement, need);
  if (usd === null) return console.log(`    skip fill on ${coin}: 1Click has no price for ${replacement}`);
  if (usd > MAX_USD) return console.log(`    skip fill on ${coin}: needs about $${usd.toFixed(2)}, over KEEPER_MAX_FILL_USD=$${MAX_USD}`);
  const held = BigInt(await view<string>(d.verifier, "mt_balance_of", { account_id: keeper.accountId, token_id: replacement }));
  if (held >= need) return void (await sendFill(keeper, d, coin, replacement, need, usd));
  if (spent() + usd > MAX_TOTAL_USD) return console.log(`    skip fill on ${coin}: would pass KEEPER_MAX_TOTAL_USD=$${MAX_TOTAL_USD} (spent $${spent().toFixed(2)})`);
  const secret = loadKey(keeper.accountId);
  if (!secret) throw new Error(`no key for ${keeper.accountId}`);
  const kp = KeyPair.fromString(secret as KeyPairString);
  const pk = kp.getPublicKey();
  // NEAR Intents only accepts intents signed by a key registered for the (named) account.
  if (!(await view<boolean>(d.verifier, "has_public_key", { account_id: keeper.accountId, public_key: pk.toString() }))) {
    await call(keeper, d.verifier, "add_public_key", { public_key: pk.toString() }, { deposit: ONE_YOCTO, tgas: 30, label: "let the keeper key sign NEAR Intents swaps" });
  }
  const usdc = d.tokens.find((t) => t.symbol === "USDC")!.token_id;
  const r = await swapInsideIntents({
    from: usdc,
    to: replacement,
    amountOut: (need - held).toString(),
    account: keeper.accountId,
    standard: "nep413",
    verifier: d.verifier,
    apiKey: process.env.ONECLICK_API_KEY,
    sign: async (intent) => {
      const payload = (intent as { payload: Nep413Payload }).payload;
      const sig = kp.sign(await nep413Hash(payload)).signature;
      return nep413SignedPayload(payload, pk.data, sig);
    },
  });
  addSpent(usd); // counted as soon as it is signed: a slow swap still spent the money
  const status = await waitForSwap(r.depositAddress);
  if (status !== "SUCCESS") return console.log(`    1Click swap for the ${coin} auction ended ${status}; nothing sent`);
  await sendFill(keeper, d, coin, replacement, need, usd);
}

async function sendFill(keeper: Account, d: Deployment, coin: string, replacement: string, need: bigint, usd: number) {
  await callBatch(
    keeper,
    d.verifier,
    [
      {
        method: "mt_transfer_call",
        args: { receiver_id: coin, token_id: replacement, amount: need.toString(), approval: null, memo: null, msg: JSON.stringify({ action: "fill_auction", min_out: "0" }) },
        deposit: ONE_YOCTO,
        tgas: 150,
      },
    ],
    `fill the auction on ${coin} with ${replacement} (about $${usd.toFixed(2)} via 1Click)`,
  );
}
