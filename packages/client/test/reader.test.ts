import { describe, expect, it } from "vitest";
import { createRpcReader } from "../src/index.ts";

type Call = { account: string; method: string; args: unknown };

/** A fake RPC that records each view call and answers with `answer(call)`. */
function fakeRpc(answer: (c: Call) => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (_url: any, init: any) => {
    const p = JSON.parse(init.body).params;
    const call = { account: p.account_id, method: p.method_name, args: JSON.parse(atob(p.args_base64)) };
    calls.push(call);
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(answer(call))));
    return new Response(JSON.stringify({ result: { result: bytes } }));
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const deployment = {
  rpc: "https://rpc.example",
  factory: "factory.testnet",
  verifier: "intents.testnet",
  swapper: "swapper.testnet",
};

describe("createRpcReader", () => {
  it("reads the factory, a coin, the verifier and the swapper with the interface's method names and args", async () => {
    const { calls, fetchImpl } = fakeRpc(() => "ok");
    const r = createRpcReader(deployment, { fetch: fetchImpl });
    const coin = r.coin("degen-1.factory.testnet");

    await r.listCoins(0, 50);
    await r.getFactoryConfig();
    await coin.getState();
    await coin.quoteBuy("1000000000000000000");
    await coin.quoteSell("5");
    await coin.getTombstones(0, 20);
    await coin.ftBalanceOf("alice.testnet");
    await coin.storageBalanceOf("alice.testnet");
    await r.verifier.mtBatchBalanceOf("alice.testnet", ["nep141:btc.mock"]);
    await r.swapper.quoteIn("nep141:usdc.mock", "nep141:btc.mock", "1000");

    expect(calls).toEqual([
      { account: "factory.testnet", method: "list_coins", args: { from: 0, limit: 50 } },
      { account: "factory.testnet", method: "get_config", args: {} },
      { account: "degen-1.factory.testnet", method: "get_state", args: {} },
      { account: "degen-1.factory.testnet", method: "quote_buy", args: { bu_in: "1000000000000000000" } },
      { account: "degen-1.factory.testnet", method: "quote_sell", args: { amount: "5" } },
      { account: "degen-1.factory.testnet", method: "get_tombstones", args: { from: 0, limit: 20 } },
      { account: "degen-1.factory.testnet", method: "ft_balance_of", args: { account_id: "alice.testnet" } },
      { account: "degen-1.factory.testnet", method: "storage_balance_of", args: { account_id: "alice.testnet" } },
      { account: "intents.testnet", method: "mt_batch_balance_of", args: { account_id: "alice.testnet", token_ids: ["nep141:btc.mock"] } },
      {
        account: "swapper.testnet",
        method: "quote_in",
        args: { token_in: "nep141:usdc.mock", token_out: "nep141:btc.mock", amount_out: "1000" },
      },
    ]);
  });

  it("lists every coin by paging through list_coins", async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ account_id: `c${i}.f`, ticker: `C${i}`, name: "", creator: "x", created_ms: i }));
    const { calls, fetchImpl } = fakeRpc((c) => {
      const { from, limit } = c.args as { from: number; limit: number };
      return all.slice(from, from + limit);
    });
    const r = createRpcReader(deployment, { fetch: fetchImpl });
    const coins = await r.listAllCoins(2);
    expect(coins.map((c) => c.ticker)).toEqual(["C0", "C1", "C2", "C3", "C4"]);
    expect(calls.map((c) => c.args)).toEqual([
      { from: 0, limit: 2 },
      { from: 2, limit: 2 },
      { from: 4, limit: 2 },
    ]);
  });
});
