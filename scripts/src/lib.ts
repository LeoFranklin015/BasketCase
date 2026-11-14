// Shared helpers for the testnet scripts: config, keys, views, calls with explorer links.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, type KeyPairString, actions, teraToGas } from "near-api-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** NETWORK=mainnet switches RPC, explorer, deployment file and key directory. Mainnet also needs --yes-mainnet. */
export const NETWORK = (process.env.NETWORK ?? "testnet") as "testnet" | "mainnet";
if (NETWORK === "mainnet" && !process.argv.includes("--yes-mainnet")) {
  throw new Error("NETWORK=mainnet spends real money: rerun with --yes-mainnet once the owner has said go");
}
const RPCS = process.env.NEAR_RPC
  ? process.env.NEAR_RPC.split(",")
  : NETWORK === "mainnet"
    ? ["https://rpc.mainnet.fastnear.com", "https://free.rpc.fastnear.com", "https://near.drpc.org"]
    : ["https://rpc.testnet.fastnear.com", "https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"];
export const RPC = RPCS[0]!;
// Free public endpoints rate-limit; fail over between them. (rpc.*.near.org is deprecated and answers 429.)
export const provider = new FailoverRpcProvider(RPCS.map((url) => new JsonRpcProvider({ url })));
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

export type Token = { symbol: string; token_id: string; decimals: number; usd: number };
export type Deployment = {
  network: "testnet" | "mainnet";
  rpc: string;
  factory: string;
  verifier: string;
  swapper: string;
  reporter: string;
  protocol: string;
  tokens: Omit<Token, "usd">[];
  /** Mainnet demo without a factory (factory "none"): the coins deployed directly (scripts/src/mainnet-coin.ts). */
  coins?: { account_id: string; ticker: string; name: string; creator: string; created_ms: number }[];
  /** Rhea pools of graduated coins (scripts/src/rhea-list.ts): coin account → pool id. */
  rhea_pools?: Record<string, number>;
};

const constants = JSON.parse(readFileSync(join(ROOT, "constants.json"), "utf8"));
export const TOKENS: Token[] = constants.testnet_tokens;
export const tokenBySymbol = (s: string): Token => {
  const t = TOKENS.find((x) => x.symbol === s);
  if (!t) throw new Error(`unknown token ${s}`);
  return t;
};

export const DEPLOYMENT_FILE = join(ROOT, `deployments/${NETWORK}.json`);
export const loadDeployment = (): Deployment => JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
export const saveDeployment = (d: Deployment) => writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");

// ---------- Pure helpers (unit-tested) ----------

/** Parse a decimal string into an integer scaled by 10^scale (exact, truncates beyond scale). */
export function decimalToScaled(value: string | number, scale: number): bigint {
  const s = typeof value === "number" ? value.toFixed(Math.min(scale, 20)) : value;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole + frac.padEnd(scale, "0").slice(0, scale));
}

/** USD per raw unit, scaled by 1e36: the unit reporters and the mock swapper use. */
export function priceE36(usd: string | number, decimals: number): bigint {
  return decimalToScaled(usd, 18) * 10n ** 18n / 10n ** BigInt(decimals);
}

/** Raw units of an asset per basket unit: weight share of the BU's dollar size, rounded up. */
export function qFor(weightBps: number, buUsd: string | number, usd: string | number, decimals: number): bigint {
  const num = BigInt(weightBps) * decimalToScaled(buUsd, 18) * 10n ** BigInt(decimals);
  const den = 10_000n * decimalToScaled(usd, 18);
  return (num + den - 1n) / den;
}

export const txLink = (hash: string) => `${EXPLORER}/txns/${hash}`;

// ---------- Keys ----------

const CRED_DIR = process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), `.near-credentials/${NETWORK}`);

export function loadKey(accountId: string): KeyPairString | undefined {
  const f = join(CRED_DIR, `${accountId}.json`);
  if (!existsSync(f)) return undefined;
  return JSON.parse(readFileSync(f, "utf8")).private_key as KeyPairString;
}

export function saveKey(accountId: string, key: KeyPair) {
  mkdirSync(CRED_DIR, { recursive: true });
  const f = join(CRED_DIR, `${accountId}.json`);
  writeFileSync(f, JSON.stringify({ account_id: accountId, public_key: key.getPublicKey().toString(), private_key: key.toString() }), { mode: 0o600 });
}

export function account(accountId: string): Account {
  const key = loadKey(accountId);
  if (!key) throw new Error(`no key for ${accountId} in ${CRED_DIR}`);
  return new Account(accountId, provider, key);
}

// ---------- Chain ----------

export async function view<T = unknown>(contractId: string, method: string, args: object = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args: args as Record<string, unknown> })) as T;
}

export async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId } as never);
    return true;
  } catch {
    return false;
  }
}

/** Call a method, print a one-line receipt with the explorer link, return the parsed result. */
export async function call<T = unknown>(
  signer: Account,
  contractId: string,
  methodName: string,
  args: object,
  opts: { deposit?: bigint; tgas?: number; label?: string } = {},
): Promise<{ result: T; hash: string }> {
  const res = await signer.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(methodName, args, teraToGas(opts.tgas ?? 100), opts.deposit ?? 0n)],
    waitUntil: "FINAL",
  });
  const hash = res.transaction_outcome.id;
  const failure = findFailure(res);
  console.log(`  ${opts.label ?? `${methodName} on ${contractId}`}${failure ? ` FAILED: ${failure}` : ""}\n    ${txLink(hash)}`);
  if (failure) throw new Error(`${methodName} failed: ${failure}`);
  return { result: lastResult<T>(res), hash };
}

/** Several function calls to one contract in a single transaction. */
export async function callBatch(signer: Account, contractId: string, calls: { method: string; args: object; deposit?: bigint; tgas?: number }[], label: string) {
  const res = await signer.signAndSendTransaction({
    receiverId: contractId,
    actions: calls.map((c) => actions.functionCall(c.method, c.args, teraToGas(c.tgas ?? 50), c.deposit ?? 0n)),
    waitUntil: "FINAL",
  });
  const hash = res.transaction_outcome.id;
  const failure = findFailure(res);
  console.log(`  ${label}${failure ? ` FAILED: ${failure}` : ""}\n    ${txLink(hash)}`);
  if (failure) throw new Error(`${label} failed: ${failure}`);
  return hash;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findFailure(res: any): string | undefined {
  const outcomes = [res.transaction_outcome, ...(res.receipts_outcome ?? [])];
  for (const o of outcomes) {
    const st = o?.outcome?.status;
    if (st && typeof st === "object" && "Failure" in st) return JSON.stringify(st.Failure).slice(0, 400);
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastResult<T>(res: any): T {
  const v = res.status?.SuccessValue;
  if (!v) return undefined as T;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString()) as T;
  } catch {
    return undefined as T;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const ONE_YOCTO = 1n;
export const near = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
