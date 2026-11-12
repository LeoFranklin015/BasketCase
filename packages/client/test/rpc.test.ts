import { describe, expect, it } from "vitest";
import { viewFunction, RpcError } from "../src/index.ts";

type Captured = { url: string; body: any };

function fakeFetch(response: unknown, captured: Captured[] = [], status = 200): typeof fetch {
  return (async (url: any, init: any) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

function bytesOf(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

describe("viewFunction", () => {
  it("sends a call_function query with base64 JSON args and decodes the JSON result", async () => {
    const captured: Captured[] = [];
    const fetchImpl = fakeFetch({ jsonrpc: "2.0", id: "1", result: { result: bytesOf([{ ticker: "DEGEN" }]), logs: [] } }, captured);

    const out = await viewFunction<{ ticker: string }[]>(
      "https://rpc.example",
      "factory.testnet",
      "list_coins",
      { from: 0, limit: 2 },
      { fetch: fetchImpl },
    );

    expect(out).toEqual([{ ticker: "DEGEN" }]);
    expect(captured[0]!.url).toBe("https://rpc.example");
    expect(captured[0]!.body).toMatchObject({
      jsonrpc: "2.0",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: "factory.testnet",
        method_name: "list_coins",
        // base64 of {"from":0,"limit":2}
        args_base64: "eyJmcm9tIjowLCJsaW1pdCI6Mn0=",
      },
    });
  });

  it("encodes non-ASCII args as UTF-8", async () => {
    const captured: Captured[] = [];
    await viewFunction("https://rpc.example", "c.testnet", "m", { name: "é" }, {
      fetch: fakeFetch({ result: { result: bytesOf(null) } }, captured),
    });
    // {"name":"é"} in UTF-8, base64.
    expect(captured[0]!.body.params.args_base64).toBe("eyJuYW1lIjoiw6kifQ==");
  });

  it("returns null when the view returns no bytes", async () => {
    const out = await viewFunction("https://rpc.example", "c.testnet", "get_auction", {}, {
      fetch: fakeFetch({ result: { result: [] } }),
    });
    expect(out).toBeNull();
  });

  it("throws an RpcError with the contract's message when the call panics", async () => {
    const fetchImpl = fakeFetch({ result: { error: "wasm execution failed with error: FunctionCallError(...)", logs: [] } });
    await expect(viewFunction("https://rpc.example", "c.testnet", "get_state", {}, { fetch: fetchImpl })).rejects.toThrow(RpcError);
    await expect(viewFunction("https://rpc.example", "c.testnet", "get_state", {}, { fetch: fetchImpl })).rejects.toThrow(/wasm execution failed/);
  });

  it("throws an RpcError when the RPC answers with a JSON-RPC error", async () => {
    const fetchImpl = fakeFetch({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT" }, message: "Server error" } });
    await expect(viewFunction("https://rpc.example", "nobody.testnet", "get_state", {}, { fetch: fetchImpl })).rejects.toThrow(/UNKNOWN_ACCOUNT/);
  });

  it("throws an RpcError on an HTTP failure", async () => {
    const fetchImpl = fakeFetch({}, [], 503);
    await expect(viewFunction("https://rpc.example", "c.testnet", "get_state", {}, { fetch: fetchImpl })).rejects.toThrow(/503/);
  });
});
