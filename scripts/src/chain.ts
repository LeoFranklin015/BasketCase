// Product actions on testnet, shared by seed, keeper and demo.
import type { Account } from "near-api-js";
import { fetchOneClickPrices } from "../../packages/client/src/crosschain.ts";
import { NETWORK, ONE_YOCTO, TOKENS, call, callBatch, loadDeployment, priceE36, view } from "./lib.js";

const d = () => loadDeployment();
const USDC = "nep141:usdc.mock";

export type BuyQuote = { token_ids: string[]; amounts: string[]; tokens_out: string; queued: boolean; fee: string };

/** Free test tokens on the mock verifier, straight into `who`'s balance. */
export async function faucet(signer: Account, tokens: { token_id: string; amount: bigint }[], receiver?: string) {
  await callBatch(
    signer,
    d().verifier,
    tokens.map((t) => ({ method: "faucet", args: { token_id: t.token_id, amount: t.amount.toString(), receiver_id: receiver ?? null }, tgas: 10 })),
    `faucet ${tokens.length} token(s) to ${receiver ?? signer.accountId}`,
  );
}

/** Register `who` on a coin (NEP-145) if needed. */
export async function register(signer: Account, coin: string) {
  const bal = await view(coin, "storage_balance_of", { account_id: signer.accountId });
  if (bal) return;
  const bounds = await view<{ min: string }>(coin, "storage_balance_bounds");
  await call(signer, coin, "storage_deposit", { account_id: null, registration_only: true }, { deposit: BigInt(bounds.min), tgas: 20, label: `register ${signer.accountId} on ${coin}` });
}

/** Step 1 of a buy: swap USDC into every basket asset the quote needs (exact-out, one tx). */
export async function swapLegs(signer: Account, q: BuyQuote) {
  const legs: { method: string; args: object; deposit: bigint; tgas: number }[] = [];
  for (let i = 0; i < q.token_ids.length; i++) {
    const want = q.token_ids[i];
    if (want === USDC) continue;
    const amountIn = await view<string>(d().swapper, "quote_in", { token_in: USDC, token_out: want, amount_out: q.amounts[i] });
    legs.push({
      method: "mt_transfer_call",
      args: { receiver_id: d().swapper, token_id: USDC, amount: amountIn, approval: null, memo: null, msg: JSON.stringify({ want, amount_out: q.amounts[i] }) },
      deposit: ONE_YOCTO,
      tgas: 60,
    });
  }
  if (legs.length) await callBatch(signer, d().verifier, legs, `swap USDC into ${legs.length} basket asset(s)`);
}

/** Step 2 of a buy: send the basket to the coin in one batch transfer. */
export async function sendBasket(signer: Account, coin: string, q: BuyQuote, recipient?: string) {
  return call(
    signer,
    d().verifier,
    "mt_batch_transfer_call",
    { receiver_id: coin, token_ids: q.token_ids, amounts: q.amounts, approvals: null, memo: null, msg: JSON.stringify({ action: "buy", recipient: recipient ?? null, min_tokens_out: "0" }) },
    { deposit: ONE_YOCTO, tgas: 250, label: `buy ${coin} (${q.queued ? "queued in the fair-launch window" : `${fmt(q.tokens_out)} tokens`})` },
  );
}

/** Full two-step buy for `bu` basket units paid in USDC. */
export async function buyWithUsdc(signer: Account, coin: string, bu: bigint) {
  await register(signer, coin);
  const q = await view<BuyQuote>(coin, "quote_buy", { bu_in: bu.toString() });
  await swapLegs(signer, q);
  return sendBasket(signer, coin, q);
}

/** Buy by minting the basket assets from the faucet first (for large testnet buys). */
export async function buyWithFaucet(signer: Account, coin: string, bu: bigint) {
  await register(signer, coin);
  const q = await view<BuyQuote>(coin, "quote_buy", { bu_in: bu.toString() });
  await faucet(signer, q.token_ids.map((t, i) => ({ token_id: t, amount: BigInt(q.amounts[i]) })));
  return sendBasket(signer, coin, q);
}

/** Reporter: post swapper table prices for the given tokens. */
export async function reportPrices(reporter: Account, coin: string, tokenIds: string[]) {
  // Testnet: the stand-in swapper's price table. Mainnet: 1Click's public USD prices, same unit.
  const table = NETWORK === "mainnet" ? await fetchOneClickPrices(tokenIds) : await view<[string, string][]>(d().swapper, "get_prices");
  const prices = table.filter(([t]) => tokenIds.includes(t));
  if (prices.length) await call(reporter, coin, "report_prices", { prices }, { tgas: 30, label: `report ${prices.length} price(s) to ${coin}` });
}

export const swapperPrices = () => TOKENS.map((t) => [t.token_id, priceE36(t.usd, t.decimals).toString()] as [string, string]);

export const fmt = (raw: string | bigint, decimals = 18) => {
  const v = BigInt(raw);
  const whole = v / 10n ** BigInt(decimals);
  const frac = (v % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac}`;
};
