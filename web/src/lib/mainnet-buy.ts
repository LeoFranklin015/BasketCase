// Mainnet buy route: the basket assets come from 1Click inside NEAR Intents instead of the testnet
// stand-in swapper. Step 1 of a buy becomes one signed NEP-413 intent per basket asset (quote,
// generate-intent, sign, submit, wait for SUCCESS); step 2 is unchanged (mt_batch_transfer_call of
// the basket to the coin). Written and unit-tested against the 1Click OpenAPI shapes; it has not
// moved real funds yet because nothing is deployed on mainnet (ARCHITECTURE.md, "Testnet and mainnet").
import {
  intentsAddPublicKeyTx,
  oneClickQuoteIn,
  swapInsideIntents,
  viewFunction,
  waitForSwap,
  type Nep413Payload,
  type Nep413Signed,
  type SwapLeg,
  type Transaction,
} from "@backed/client";
import { deployment, tokenInfo } from "./config";
import { failoverFetch } from "./rpc";

/** `quoteIn` for prepareBuy on mainnet. */
export const mainnetQuoteIn = (account: string) => (token_in: string, token_out: string, amount_out: string) => oneClickQuoteIn(token_in, token_out, amount_out, account);

export type OneClickDeps = {
  account: string;
  signNep413: (p: Nep413Payload) => Promise<Nep413Signed>;
  send: (txs: Transaction[], title: string) => Promise<unknown>;
  /** Injected in tests; defaults to the live 1Click and RPC calls. */
  swap?: typeof swapInsideIntents;
  wait?: typeof waitForSwap;
  hasPublicKey?: (account: string, publicKey: string) => Promise<boolean>;
};

const liveHasPublicKey = (account_id: string, public_key: string) =>
  viewFunction<boolean>(deployment.rpc, deployment.verifier, "has_public_key", { account_id, public_key }, { fetch: failoverFetch });

/** Run every swap leg through 1Click. Throws on the first leg that does not settle; nothing reaches the coin then. */
export async function swapLegsViaOneClick(legs: SwapLeg[], deps: OneClickDeps, progress: (detail: string) => void): Promise<string[]> {
  const swap = deps.swap ?? swapInsideIntents;
  const wait = deps.wait ?? waitForSwap;
  const hasKey = deps.hasPublicKey ?? liveHasPublicKey;
  const hashes: string[] = [];
  for (const [i, leg] of legs.entries()) {
    const sym = tokenInfo(leg.want).symbol;
    progress(`swap ${i + 1} of ${legs.length} into ${sym}`);
    const r = await swap({
      from: leg.token_in,
      to: leg.want,
      amountOut: leg.amount_out,
      account: deps.account,
      standard: "nep413",
      // The intent is checked before signing (one transfer, at most the quoted input, to the deposit
      // address), and the quote may not cost more than this leg's planned input.
      verifier: deployment.verifier,
      maxIn: leg.amount_in,
      sign: async (intent) => {
        const payload = (intent as { payload?: Nep413Payload }).payload;
        if (!payload) throw new Error("1Click returned an intent without a NEP-413 payload.");
        const signed = await deps.signNep413(payload);
        // NEAR Intents only accepts intents signed by a key it knows for the account. Implicit
        // accounts are known by their own key; a named account registers its key once.
        if (!(await hasKey(deps.account, signed.public_key))) {
          progress("letting your key sign NEAR Intents swaps (once)");
          await deps.send([intentsAddPublicKeyTx(deployment.verifier, signed.public_key)], "Let your key sign NEAR Intents swaps");
        }
        return signed;
      },
    });
    progress(`waiting for 1Click to deliver ${sym}`);
    const status = await wait(r.depositAddress);
    if (status !== "SUCCESS") throw new Error(`The 1Click swap into ${sym} ended as ${status}. Nothing was sent to the coin; anything not swapped stays in your NEAR Intents balance.`);
    hashes.push(r.intentHash);
  }
  return hashes;
}
