import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { describe, expect, it } from "vitest";
import {
  base58Decode,
  buyIntent,
  checkPayload,
  checkPayloads,
  checkOneClickDeposit,
  sentTo,
  erc191Signed,
  hexToBytes,
  intentsIdFor,
  payloadString,
  rawEd25519Signed,
  sellIntent,
  versionedNonce,
} from "../src/intents.ts";

const enc = new TextEncoder();
const COIN = "degen.backedlab.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const BTC = "nep141:nbtc.bridge.near";
const SOON = new Date(Date.now() + 10 * 60_000);

function evmAddress(pub65: Uint8Array): string {
  const h = keccak_256(pub65.slice(1));
  return "0x" + Array.from(h.slice(12), (b) => b.toString(16).padStart(2, "0")).join("");
}
function erc191Hash(msg: string): Uint8Array {
  const m = enc.encode(msg);
  return keccak_256(new Uint8Array([...enc.encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m]));
}

describe("versionedNonce", () => {
  it("matches the layout 1Click generates (magic, version, salt, deadline ns, random)", () => {
    // A nonce 1Click returned on 2026-11-14, with deadline 2026-11-17T13:17:03Z and salt 252812b3.
    const real = "Vij2xgAlKBKzAFanOYbX6Bj0WnHOE+R3ffRAJTtix84=";
    const bytes = Uint8Array.from(atob(real), (c) => c.charCodeAt(0));
    const ours = versionedNonce("252812b3", new Date("2026-11-17T13:17:03.000Z"), bytes.slice(17));
    expect(ours).toBe(real);
  });
});

describe("intentsIdFor", () => {
  it("lowercases EVM addresses and hex-encodes Solana keys", () => {
    expect(intentsIdFor("base", "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    const sol = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(intentsIdFor("solana", sol)).toHaveLength(64);
    expect(() => intentsIdFor("base", "alice.near")).toThrow();
  });
});

describe("wallet signatures NEAR Intents accepts", () => {
  it("erc191: MetaMask's 27/28 recovery byte becomes 0/1 and recovers the buyer's address", () => {
    const sk = secp256k1.utils.randomPrivateKey();
    const addr = evmAddress(secp256k1.getPublicKey(sk, false));
    const payload = payloadString({ signer_id: addr, verifier: "intents.near", deadline: SOON, nonce: versionedNonce("252812b3", SOON), intents: [] });
    const sig = secp256k1.sign(erc191Hash(payload), sk);
    const metamask = "0x" + sig.toCompactHex() + (27 + sig.recovery).toString(16);
    const signed = erc191Signed(payload, metamask);
    expect(signed.signature.startsWith("secp256k1:")).toBe(true);
    const raw = base58Decode(signed.signature.slice("secp256k1:".length));
    expect(raw).toHaveLength(65);
    const rec = secp256k1.Signature.fromCompact(raw.slice(0, 64)).addRecoveryBit(raw[64]!);
    expect(evmAddress(rec.recoverPublicKey(erc191Hash(payload)).toRawBytes(false))).toBe(addr);
  });

  it("raw_ed25519: Phantom's signature over the payload bytes verifies", () => {
    const sk = ed25519.utils.randomPrivateKey();
    const pk = ed25519.getPublicKey(sk);
    const payload = payloadString({ signer_id: intentsIdFor("solana", base58FromBytes(pk)), verifier: "intents.near", deadline: SOON, nonce: versionedNonce("252812b3", SOON), intents: [] });
    const signed = rawEd25519Signed(payload, pk, ed25519.sign(enc.encode(payload), sk));
    if (signed.standard !== "raw_ed25519") throw new Error();
    expect(ed25519.verify(base58Decode(signed.signature.slice(8)), enc.encode(payload), base58Decode(signed.public_key.slice(8)))).toBe(true);
  });
});

function base58FromBytes(b: Uint8Array): string {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let s = "";
  while (n > 0n) (s = A[Number(n % 58n)] + s), (n /= 58n);
  for (const x of b) if (x === 0) s = "1" + s;
    else break;
  return s;
}

describe("checkPayload", () => {
  const me = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
  const rules = { signer: me, verifier: "intents.near", receivers: ["depo1", COIN], coin: COIN, maxSpend: { [USDC]: "5000000", [BTC]: "3000" }, latest: new Date(Date.now() + 3 * 86400_000 + 60_000) };
  const mk = (intents: unknown[], extra: Record<string, unknown> = {}) =>
    JSON.stringify({ signer_id: me, verifying_contract: "intents.near", deadline: SOON.toISOString(), nonce: "x", intents, ...extra });

  it("accepts a 1Click swap transfer and a delivered buy within the caps", () => {
    expect(() => checkPayload(mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "2000000" } }]), rules)).not.toThrow();
    expect(() => checkPayload(mk([buyIntent(COIN, { [USDC]: "2900000", [BTC]: "2999" }, "1")]), rules)).not.toThrow();
    const buyWith = (msg: object) => mk([{ intent: "transfer", receiver_id: COIN, tokens: { [USDC]: "1" }, msg: JSON.stringify({ action: "buy", deliver: true, min_tokens_out: "1", ...msg }) }]);
    expect(() => checkPayload(buyWith({ recipient: "thief.near" }), rules)).toThrow("the buy pays thief.near");
    expect(() => checkPayload(buyWith({ min_tokens_out: "0" }), rules)).toThrow("no slippage limit");
    expect(() => checkPayload(buyWith({ extra: 1 }), rules)).toThrow("extra fields");
    expect(() => checkPayload(mk([sellIntent(COIN, "100", "0", me)]), { ...rules, maxSpend: { [`nep141:${COIN}`]: "100" } })).toThrow("no slippage limit");
    expect(() => checkPayload(mk([sellIntent(COIN, "100", "5", me)]), { ...rules, maxSpend: { [`nep141:${COIN}`]: "100" } })).not.toThrow();
  });

  it("refuses anything else", () => {
    const bad: [string, string][] = [
      [mk([{ intent: "transfer", receiver_id: "thief.near", tokens: { [USDC]: "1" } }]), "pays thief.near"],
      [mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "5000001" } }]), "more than"],
      [mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "3000000" } }, { intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "3000000" } }]), "more than"],
      [mk([{ intent: "transfer", receiver_id: COIN, tokens: { [USDC]: "1" } }]), "buy message"],
      [mk([{ intent: "add_public_key", public_key: "ed25519:x" }]), "add_public_key"],
      [mk([sellIntent(COIN, "100", "0", "thief.near")]), "not a sell paying you"],
      [mk([], {}), "no intents"],
      [mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "1" } }], { signer_id: "someone" }), "signed as"],
      [mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "1" } }], { verifying_contract: "evil.near" }), "is for"],
      [mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "1" } }], { deadline: "2099-01-01T00:00:00Z" }), "deadline"],
    ];
    for (const [p, why] of bad) expect(() => checkPayload(p, rules), why).toThrow(why);
  });

  it("caps the whole order, not each message", () => {
    const swap = mk([{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "3000000" } }]);
    expect(() => checkPayload(swap, rules)).not.toThrow();
    expect(() => checkPayloads([swap, swap], rules)).toThrow("together the messages spends 6000000");
    expect(() => checkPayloads([swap], rules)).not.toThrow();
  });

  it("hexToBytes rejects odd input", () => expect(() => hexToBytes("0xabc")).toThrow());
});

describe("checkOneClickDeposit", () => {
  const me = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
  const quote = (q: Record<string, string>) => ({
    quoteResponse: {
      quoteRequest: { originAsset: USDC, destinationAsset: BTC, depositType: "INTENTS", recipient: me, recipientType: "INTENTS", refundTo: me, refundType: "INTENTS", slippageTolerance: 100, ...q },
      quote: { amountIn: "2000000" },
    },
  });
  const want = { route: "swap" as const, token: USDC, amount: "2000000", intentsId: me, wallet: "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045", destinations: [BTC] };
  it("accepts a swap paying the wallet's own NEAR Intents account, or a cash-out to its own address", () => {
    expect(() => checkOneClickDeposit(quote({}), want)).not.toThrow();
    expect(() => checkOneClickDeposit(quote({ recipient: want.wallet, recipientType: "DESTINATION_CHAIN" }), { ...want, route: "cashout" })).not.toThrow();
    // The first deposit: from the wallet's chain into its NEAR Intents account, refunded on its chain.
    expect(() => checkOneClickDeposit(quote({ depositType: "ORIGIN_CHAIN", refundTo: want.wallet, refundType: "ORIGIN_CHAIN" }), { ...want, route: "deposit" })).not.toThrow();
  });
  it("refuses quotes that pay or refund anyone else, or take another token", () => {
    expect(() => checkOneClickDeposit(quote({ recipient: "thief.near" }), want)).toThrow("pays thief.near");
    // A buy leg may not pay out on another chain, and a cash-out may not stay inside NEAR Intents.
    expect(() => checkOneClickDeposit(quote({ recipient: want.wallet, recipientType: "DESTINATION_CHAIN" }), want)).toThrow("pays");
    expect(() => checkOneClickDeposit(quote({}), { ...want, route: "cashout" })).toThrow("pays");
    expect(() => checkOneClickDeposit(quote({ refundTo: "0x2222222222222222222222222222222222222222", refundType: "ORIGIN_CHAIN", depositType: "ORIGIN_CHAIN" }), { ...want, route: "deposit" })).toThrow("refunds to");
    expect(() => checkOneClickDeposit(quote({ refundTo: "thief.near" }), want)).toThrow("refunds to");
    expect(() => checkOneClickDeposit(quote({ recipient: "0x1111111111111111111111111111111111111111", recipientType: "DESTINATION_CHAIN" }), want)).toThrow("pays");
    expect(() => checkOneClickDeposit(quote({ originAsset: BTC }), want)).toThrow("is for");
    expect(() => checkOneClickDeposit({}, want)).toThrow("no quote");
    expect(() => checkOneClickDeposit(quote({ slippageTolerance: 10_000 } as never), want)).toThrow("slippage");
    expect(() => checkOneClickDeposit(quote({ destinationAsset: "nep141:junk.near" }), want)).toThrow("swaps into");
    expect(() => checkOneClickDeposit(quote({}), { ...want, amount: "2000001" })).toThrow("less than");
  });
  it("finds the one token a swap message sends", () => {
    const p = JSON.stringify({ intents: [{ intent: "transfer", receiver_id: "depo1", tokens: { [USDC]: "5" } }] });
    expect(sentTo(p, "depo1")).toEqual({ token: USDC, amount: "5" });
  });
});
