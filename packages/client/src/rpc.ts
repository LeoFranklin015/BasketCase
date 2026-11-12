/** Minimal NEAR JSON-RPC view helper: fetch-based, works in browsers and Node 22+. */

export class RpcError extends Error {
  readonly contractId: string;
  readonly method: string;
  constructor(message: string, contractId: string, method: string) {
    super(`${contractId}.${method}: ${message}`);
    this.name = "RpcError";
    this.contractId = contractId;
    this.method = method;
  }
}

export type ViewOptions = {
  fetch?: typeof fetch;
  finality?: "final" | "optimistic";
  signal?: AbortSignal;
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function encodeArgs(args: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(args ?? {})));
}

export function decodeResult<T>(bytes: number[]): T {
  if (bytes.length === 0) return null as T;
  const text = new TextDecoder().decode(Uint8Array.from(bytes));
  return JSON.parse(text) as T;
}

let nextId = 0;

/** Call a view method and parse its JSON result. Throws RpcError on any failure. */
export async function viewFunction<T>(
  rpcUrl: string,
  contractId: string,
  method: string,
  args: unknown = {},
  opts: ViewOptions = {},
): Promise<T> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const body = {
    jsonrpc: "2.0",
    id: `backed-${++nextId}`,
    method: "query",
    params: {
      request_type: "call_function",
      finality: opts.finality ?? "final",
      account_id: contractId,
      method_name: method,
      args_base64: encodeArgs(args),
    },
  };
  let res: Response;
  try {
    res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    throw new RpcError(`network error: ${(e as Error).message}`, contractId, method);
  }
  if (!res.ok) throw new RpcError(`HTTP ${res.status}`, contractId, method);
  const json = (await res.json()) as {
    error?: { name?: string; message?: string; cause?: { name?: string; info?: unknown }; data?: unknown };
    result?: { result?: number[]; error?: string };
  };
  if (json.error) {
    const e = json.error;
    const detail = [e.cause?.name, e.name, e.message, typeof e.data === "string" ? e.data : undefined].filter(Boolean).join(" / ");
    throw new RpcError(detail || "RPC error", contractId, method);
  }
  if (!json.result) throw new RpcError("empty RPC response", contractId, method);
  if (json.result.error) throw new RpcError(json.result.error, contractId, method);
  return decodeResult<T>(json.result.result ?? []);
}
