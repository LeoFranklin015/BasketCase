/**
 * Simulates a coin from a list of operations so fixture state, logs and quotes agree with
 * each other. Shaped exactly like the contract views in docs/interface.md.
 */

import { computeQ, usdToPriceE36, type BasketEntry, type CoinState, type LogEntry } from "@backed/client";
import { tokenInfo } from "../config";
import type { ChainEvent } from "../history";
import { curveBuy, curveFloor, curvePrice, curveSell, E18, feeOf, poolBuy, poolSell, SPEC_CURVE, splitFee, surplusPerToken, type CurveSt } from "./curve";

export const USD: Record<string, string> = {
  "nep141:usdc.mock": "1",
  "nep141:btc.mock": "100000",
  "nep141:eth.mock": "3500",
  "nep141:sol.mock": "180",
  "nep141:pepe.mock": "0.00001",
  "nep141:doge.mock": "0.2",
  "nep141:wif.mock": "1.5",
  "nep141:bonk.mock": "0.00002",
  "nep141:nvda.mock": "180",
  "nep141:frog.coin-maker.testnet": "0.004",
};

export function priceE36(token_id: string): bigint {
  return usdToPriceE36(USD[token_id] ?? "0", tokenInfo(token_id).decimals);
}

export type FixtureBasketSpec = { token_id: string; share_bps: number; weight_bps: number; anchored: boolean; joined_epoch: number };

export type Op =
  | { kind: "buy"; who: string; bu: number; at: number }
  | { kind: "sell"; who: string; pct: number; at: number }
  | { kind: "burn"; who: string; tokens: number; at: number; reason: "challenge" | "defend"; target: string; replacement?: string }
  | { kind: "redeem"; who: string; pct: number; at: number }
  | { kind: "graduate"; at: number }
  /** Fair-launch window: every deposit pays the same average price, minted at settle time. */
  | { kind: "fairlaunch"; deposits: { who: string; bu: number }[]; at: number };

export class SimCoin {
  readonly c = SPEC_CURVE;
  st: CurveSt = { reserve: 0n, surplus: 0n, sold: 0n };
  mode: "launch" | "curve" | "index" = "curve";
  creatorOwed = 0n;
  protocolOwed = 0n;
  poolBu = 0n;
  poolTokens = 0n;
  supply = 0n;
  graduatedMs: number | null = null;
  /** Fair-launch deposits waiting for settle_launch. */
  queuedBu = 0n;
  balances = new Map<string, bigint>();
  log: LogEntry[] = [];
  /** Every NEP-297 event the contract would emit, oldest first, with the exact floor after it (for tests). */
  history: { ev: ChainEvent; floor: bigint }[] = [];
  private seq = 0;
  /** Epoch tallies: burns tagged with a target, by epoch index. */
  burns: { epoch: number; who: string; bu: bigint; target: string; replacement?: string }[] = [];

  constructor(
    readonly account: string,
    readonly feeBps: number,
    readonly epochOf: (ms: number) => number,
  ) {}

  private bal(who: string) {
    return this.balances.get(who) ?? 0n;
  }
  private credit(who: string, t: bigint) {
    this.balances.set(who, this.bal(who) + t);
  }

  price(): bigint {
    if (this.mode === "index") return this.poolTokens === 0n ? 0n : (this.poolBu * E18) / this.poolTokens;
    return curvePrice(this.c, this.st);
  }
  floor(): bigint {
    if (this.mode === "index") return this.supply === 0n ? 0n : (this.st.reserve * E18) / this.supply;
    return curveFloor(this.c, this.st);
  }
  bTotal(): bigint {
    return this.st.reserve + this.st.surplus + this.creatorOwed + this.protocolOwed + this.poolBu + this.queuedBu;
  }

  private takeFee(bu: bigint) {
    const fee = feeOf(bu, this.feeBps);
    this.creditFee(fee);
    return bu - fee;
  }

  /** The contract's credit_fee: the vault's share raises s (curve) or the reserve (index). */
  private creditFee(fee: bigint) {
    const s = splitFee(fee);
    if (this.mode === "index") this.st.reserve += s.vault;
    else this.st.surplus += s.vault;
    this.creatorOwed += s.creator;
    this.protocolOwed += s.protocol;
  }

  private push(at: number, kind: "mint" | "burn", who: string, tokens: bigint, bu: bigint, reason: string) {
    this.log.unshift({ ts_ms: at, kind, account_id: who, tokens: tokens.toString(), bu: bu.toString(), reason, price_after: this.price().toString() });
  }

  private emit(at: number, event: string, data: Record<string, unknown>) {
    const tx = `fx${this.account.slice(0, 4)}${(this.seq + 1).toString(36).padStart(5, "0")}`;
    this.history.push({ ev: { ts: at, seq: ++this.seq, event, data, tx }, floor: this.floor() });
  }

  apply(op: Op) {
    switch (op.kind) {
      case "buy": {
        const buIn = BigInt(Math.round(op.bu * 1e6)) * 10n ** 12n;
        if (this.mode === "index") {
          const net = this.takeFee(buIn);
          const t = poolBuy(this.poolBu, this.poolTokens, net);
          this.poolBu += net;
          this.poolTokens -= t;
          this.credit(op.who, t);
          this.emit(op.at, "buy", { account_id: op.who, bu_in: buIn.toString(), fee: (buIn - net).toString(), tokens_out: t.toString(), path: "pool", price_after: this.price().toString() });
          return;
        }
        // Like the contract: price the buy first, then credit the fee.
        const fee = feeOf(buIn, this.feeBps);
        const net = buIn - fee;
        const b = curveBuy(this.c, this.st, net);
        this.st = { reserve: this.st.reserve + b.curveCost, surplus: this.st.surplus + b.surplusPart, sold: this.st.sold + b.tokens };
        this.supply = this.st.sold;
        this.creditFee(fee);
        this.credit(op.who, b.tokens);
        this.push(op.at, "mint", op.who, b.tokens, buIn - b.unused, "buy");
        this.emit(op.at, "buy", { account_id: op.who, bu_in: (buIn - b.unused).toString(), fee: (buIn - net).toString(), tokens_out: b.tokens.toString(), price_after: this.price().toString() });
        if (b.graduates) this.apply({ kind: "graduate", at: op.at });
        return;
      }
      case "sell": {
        const t = (this.bal(op.who) * BigInt(Math.round(op.pct * 100))) / 10_000n;
        if (this.mode === "index") {
          const out = poolSell(this.poolBu, this.poolTokens, t);
          this.poolBu -= out;
          this.poolTokens += t;
          this.balances.set(op.who, this.bal(op.who) - t);
          const net = this.takeFee(out);
          this.emit(op.at, "sell", { account_id: op.who, tokens: t.toString(), bu_out: net.toString(), fee: (out - net).toString(), path: "pool", price_after: this.price().toString() });
          return;
        }
        const s = curveSell(this.c, this.st, t);
        this.st = { reserve: this.st.reserve - s.curveOut, surplus: this.st.surplus - s.surplusOut, sold: this.st.sold - t };
        this.supply = this.st.sold;
        this.balances.set(op.who, this.bal(op.who) - t);
        const gross = s.curveOut + s.surplusOut;
        const net = this.takeFee(gross);
        this.push(op.at, "burn", op.who, t, gross, "sell");
        this.emit(op.at, "sell", { account_id: op.who, tokens: t.toString(), bu_out: net.toString(), fee: (gross - net).toString(), path: "curve", price_after: this.price().toString() });
        return;
      }
      case "burn": {
        const t = BigInt(op.tokens) * E18;
        let value: bigint;
        let reported: bigint;
        if (this.mode === "index") {
          value = (t * this.st.reserve) / this.supply;
          reported = value;
          this.supply -= t;
        } else {
          const cs = curveSell(this.c, this.st, t);
          value = cs.curveOut;
          // The contract reports the burn's full value: its curve part plus the surplus it carried.
          reported = cs.curveOut + cs.surplusOut;
          this.st = { reserve: this.st.reserve - value, surplus: this.st.surplus + value, sold: this.st.sold - t };
          this.supply = this.st.sold;
        }
        this.balances.set(op.who, this.bal(op.who) - t);
        this.burns.push({ epoch: this.epochOf(op.at), who: op.who, bu: value, target: op.target, replacement: op.replacement });
        this.push(op.at, "burn", op.who, t, value, op.reason);
        this.emit(op.at, "burn", { account_id: op.who, tokens: t.toString(), bu: reported.toString(), reason: op.reason });
        return;
      }
      case "redeem": {
        const t = (this.bal(op.who) * BigInt(Math.round(op.pct * 100))) / 10_000n;
        const gross = (t * this.st.reserve) / this.supply;
        const out = gross - feeOf(gross, 50);
        this.st.reserve -= out;
        this.supply -= t;
        this.balances.set(op.who, this.bal(op.who) - t);
        this.push(op.at, "burn", op.who, t, out, "redeem");
        this.emit(op.at, "redeem", { account_id: op.who, tokens: t.toString(), bu_out: out.toString(), fee: (gross - out).toString() });
        return;
      }
      case "fairlaunch": {
        const nets = op.deposits.map((d) => ({ who: d.who, net: this.takeFee(BigInt(Math.round(d.bu * 1e6)) * 10n ** 12n) }));
        const D = nets.reduce((a, d) => a + d.net, 0n);
        const b = curveBuy(this.c, this.st, D);
        this.st = { reserve: this.st.reserve + b.curveCost, surplus: this.st.surplus + b.surplusPart, sold: this.st.sold + b.tokens };
        this.supply = this.st.sold;
        let left = b.tokens;
        nets.forEach((d, i) => {
          const t = i === nets.length - 1 ? left : (b.tokens * d.net) / D;
          left -= t;
          this.credit(d.who, t);
          this.push(op.at + i, "mint", d.who, t, d.net, "settle");
        });
        this.emit(op.at, "settle", { tokens: b.tokens.toString(), bu: D.toString(), accounts: nets.length });
        return;
      }
      case "graduate": {
        const backing = this.st.reserve + this.st.surplus;
        const poolBu = (backing * 2_000n) / 10_000n;
        const x = this.c.x0 + this.st.reserve;
        const y = this.c.y0 - this.st.sold;
        const pLast = (x * E18 + y - 1n) / y + (this.st.sold === 0n ? 0n : (this.st.surplus * E18 + this.st.sold - 1n) / this.st.sold);
        this.poolTokens = (poolBu * E18) / pLast;
        this.poolBu = poolBu;
        this.supply = this.st.sold + this.poolTokens;
        this.st = { reserve: backing - poolBu, surplus: 0n, sold: this.st.sold };
        this.mode = "index";
        this.graduatedMs = op.at;
        this.push(op.at, "mint", this.account, this.poolTokens, poolBu, "graduation");
        this.emit(op.at, "graduated", { pool_bu: poolBu.toString(), reserve: this.st.reserve.toString(), pool_tokens: this.poolTokens.toString() });
        return;
      }
    }
  }

  stateView(extra: { launch: CoinState["launch"]; epoch: CoinState["epoch"]; auction_open: boolean }): CoinState {
    const index = this.mode === "index";
    return {
      mode: this.mode,
      reserve: this.st.reserve.toString(),
      surplus: index ? "0" : this.st.surplus.toString(),
      creator_owed: this.creatorOwed.toString(),
      protocol_owed: this.protocolOwed.toString(),
      pool_bu: index ? this.poolBu.toString() : "0",
      pool_tokens: index ? this.poolTokens.toString() : "0",
      sold: this.st.sold.toString(),
      supply: this.supply.toString(),
      circulating: (index ? this.supply - this.poolTokens : this.st.sold).toString(),
      b_total: this.bTotal().toString(),
      price: this.price().toString(),
      floor: this.floor().toString(),
      surplus_per_token: index ? "0" : surplusPerToken(this.st).toString(),
      launch: extra.launch,
      epoch: extra.epoch,
      auction_open: extra.auction_open,
      graduated_ms: this.graduatedMs,
    };
  }

  basketView(spec: FixtureBasketSpec[], bu_usd_e6: number, held?: Record<string, bigint>): BasketEntry[] {
    const bTotal = this.bTotal();
    return spec.map((b) => {
      const q = computeQ({ weight_bps: b.share_bps, bu_usd_e6, price_e36: priceE36(b.token_id) });
      const h = held?.[b.token_id] ?? (bTotal * BigInt(q)) / E18;
      return { token_id: b.token_id, q, held: h.toString(), anchored: b.anchored, weight_bps: b.weight_bps, joined_epoch: b.joined_epoch };
    });
  }
}
