// Rhea (NEAR's main DEX, formerly Ref Finance) listing for graduated coins: a coin/wNEAR pool seeded at the
// coin's own price. Used automatically by the keeper when a coin graduates, and by rhea-list.ts by hand.
// Permissionless: anyone holding the coin can do it; the coin contract is untouched. The floor still holds on
// Rhea: if the pool trades below it, buying there and redeeming from the vault pays the difference.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Account } from "near-api-js";
import { NETWORK, ONE_YOCTO, call, callBatch, loadDeployment, near, saveDeployment, view } from "./lib.js";

export const EXCHANGE = NETWORK === "mainnet" ? "v2.ref-finance.near" : "ref-finance-101.testnet";
export const WNEAR = NETWORK === "mainnet" ? "wrap.near" : "wrap.testnet";
/** Read live by the web app (/api/rhea), so a pool the keeper opens shows up without a rebuild. */
export const POOLS_FILE = process.env.RHEA_POOLS_FILE ?? join(homedir(), `backed-ops/rhea-pools-${NETWORK}.json`);

export function knownPools(): Record<string, number> {
  const fromFile = existsSync(POOLS_FILE) ? (JSON.parse(readFileSync(POOLS_FILE, "utf8")) as Record<string, number>) : {};
  return { ...((loadDeployment() as { rhea_pools?: Record<string, number> }).rhea_pools ?? {}), ...fromFile };
}

export function recordPool(coin: string, poolId: number) {
  const pools = { ...knownPools(), [coin]: poolId };
  mkdirSync(dirname(POOLS_FILE), { recursive: true });
  writeFileSync(POOLS_FILE, JSON.stringify(pools, null, 1) + "\n");
  const d = loadDeployment() as ReturnType<typeof loadDeployment> & { rhea_pools?: Record<string, number> };
  saveDeployment({ ...d, rhea_pools: { ...(d.rhea_pools ?? {}), [coin]: poolId } });
}

async function nearUsd(): Promise<number> {
  try {
    const tokens = (await (await fetch("https://1click.chaindefuser.com/v0/tokens")).json()) as { assetId: string; price: number }[];
    return tokens.find((t) => t.assetId === "nep141:wrap.near")?.price ?? 3;
  } catch {
    return 3;
  }
}

/** Coin tokens (raw, 18 decimals) worth `nearIn` NEAR at the coin's current price. */
export async function coinAmountFor(coin: string, nearIn: number): Promise<bigint> {
  const st = await view<{ price: string }>(coin, "get_state");
  const priceBu = Number(BigInt(st.price)) / 1e18; // BU per token; 1 BU ≈ $1 at launch
  return BigInt(Math.floor((((nearIn * (await nearUsd())) / priceBu) * 1e6))) * 10n ** 12n;
}

/** Open and seed the coin/wNEAR pool from `p`'s tokens and NEAR. Returns the pool id. */
export async function listOnRhea(coin: string, p: Account, nearIn: number): Promise<number> {
  const st = await view<{ mode: string }>(coin, "get_state");
  if (st.mode !== "index") throw new Error(`${coin} has not graduated (mode ${st.mode})`);
  const coinAmount = await coinAmountFor(coin, nearIn);
  const nearAmount = near(nearIn);
  const have = BigInt(await view<string>(coin, "ft_balance_of", { account_id: p.accountId }));
  if (have < coinAmount) throw new Error(`${p.accountId} holds ${have} of ${coin}, needs ${coinAmount}`);

  if (!(await view<object | null>(EXCHANGE, "storage_balance_of", { account_id: p.accountId }))) {
    await call(p, EXCHANGE, "storage_deposit", { account_id: p.accountId, registration_only: false }, { deposit: near(0.1), tgas: 30, label: "storage on Rhea" });
  }
  await call(p, EXCHANGE, "register_tokens", { token_ids: [coin, WNEAR] }, { deposit: BigInt(ONE_YOCTO), tgas: 30, label: "register both tokens with Rhea" });
  for (const t of [coin, WNEAR]) {
    if (!(await view<object | null>(t, "storage_balance_of", { account_id: EXCHANGE }))) {
      const b = await view<{ min: string }>(t, "storage_balance_bounds", {});
      await call(p, t, "storage_deposit", { account_id: EXCHANGE, registration_only: true }, { deposit: BigInt(b.min), tgas: 30, label: `register Rhea on ${t}` });
    }
  }
  if (!(await view<object | null>(WNEAR, "storage_balance_of", { account_id: p.accountId }))) {
    await call(p, WNEAR, "storage_deposit", { account_id: p.accountId, registration_only: true }, { deposit: near(0.00125), tgas: 30, label: "register on wNEAR" });
  }
  const { result: poolId } = await call<number>(p, EXCHANGE, "add_simple_pool", { tokens: [coin, WNEAR], fee: 30 }, { deposit: near(0.1), tgas: 50, label: "create the coin/wNEAR pool" });
  await callBatch(
    p,
    WNEAR,
    [
      { method: "near_deposit", args: {}, deposit: nearAmount, tgas: 10 },
      { method: "ft_transfer_call", args: { receiver_id: EXCHANGE, amount: nearAmount.toString(), msg: "" }, deposit: BigInt(ONE_YOCTO), tgas: 80 },
    ],
    `wrap and deposit ${nearIn} NEAR`,
  );
  await call(p, coin, "ft_transfer_call", { receiver_id: EXCHANGE, amount: coinAmount.toString(), msg: "" }, { deposit: BigInt(ONE_YOCTO), tgas: 100, label: "deposit the coin" });
  await call(p, EXCHANGE, "add_liquidity", { pool_id: poolId, amounts: [coinAmount.toString(), nearAmount.toString()] }, { deposit: near(0.01), tgas: 80, label: `add liquidity to Rhea pool ${poolId}` });
  recordPool(coin, poolId);
  return poolId;
}
