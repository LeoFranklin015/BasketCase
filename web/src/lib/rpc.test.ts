import { afterEach, describe, expect, it, vi } from "vitest";
import { failoverFetch, RPC_URLS } from "./rpc";

const view = (args: string, id = "1") =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "query", params: { request_type: "call_function", finality: "final", account_id: "c.testnet", method_name: "get_state", args_base64: args } });

afterEach(() => vi.unstubAllGlobals());

describe("failoverFetch", () => {
  it("lists more than one endpoint", () => {
    expect(RPC_URLS.length).toBeGreaterThanOrEqual(3);
  });

  it("moves to the next endpoint on 429 and dedupes identical view calls", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === RPC_URLS[0]) return new Response("Rate limits exceeded", { status: 429 });
        return new Response('{"jsonrpc":"2.0","id":"x","result":{"result":[]}}', { status: 200 });
      }),
    );
    const init = (body: string) => ({ method: "POST", body, headers: { "content-type": "application/json" } });
    // Two components reading the same view at once, with different request ids.
    const [a, b] = await Promise.all([failoverFetch(RPC_URLS[0]!, init(view("e30=", "1"))), failoverFetch(RPC_URLS[0]!, init(view("e30=", "2")))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(calls).toEqual([RPC_URLS[0], RPC_URLS[1]]);
    // The rate-limited endpoint is cooled down: the next call starts at a working one.
    await failoverFetch(RPC_URLS[0]!, init(view("eyJ4IjoxfQ==")));
    expect(calls.at(-1)).not.toBe(RPC_URLS[0]);
  });

  it("passes other requests straight through", async () => {
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    await failoverFetch("https://example.com/x");
    expect(f).toHaveBeenCalledWith("https://example.com/x", undefined);
  });
});
