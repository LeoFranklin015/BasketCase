import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { intentsAddPublicKeyTx, intentsDepositTx, nep413Hash, nep413SignedPayload } from "../src/nep413.ts";

const payload = { message: '{"signer_id":"alice.near","intents":[]}', nonce: Buffer.alloc(32, 7).toString("base64"), recipient: "intents.near" };

describe("NEP-413 message signing for NEAR Intents (mainnet swaps)", () => {
  it("hashes the borsh tag 2^31+413 followed by the payload, as the NEP specifies", async () => {
    // Built by hand from the NEP-413 layout: u32 tag, string message, [u8;32] nonce, string recipient, Option<string> callbackUrl.
    const msg = Buffer.from(payload.message);
    const rec = Buffer.from(payload.recipient);
    const u32 = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const expected = createHash("sha256")
      .update(Buffer.concat([u32(2147484061), u32(msg.length), msg, Buffer.alloc(32, 7), u32(rec.length), rec, Buffer.from([0])]))
      .digest();
    expect(Buffer.from(await nep413Hash(payload)).equals(expected)).toBe(true);
  });

  it("includes a callback url when there is one", async () => {
    expect(Buffer.from(await nep413Hash({ ...payload, callbackUrl: "https://x.y" })).equals(Buffer.from(await nep413Hash(payload)))).toBe(false);
  });

  it("rejects a nonce that is not 32 bytes", async () => {
    await expect(nep413Hash({ ...payload, nonce: Buffer.alloc(31).toString("base64") })).rejects.toThrow(/32 bytes/);
  });

  it("assembles the signed payload 1Click submits, and the signature verifies against the hash", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const hash = await nep413Hash(payload);
    const sig = sign(null, hash, privateKey);
    const signed = nep413SignedPayload(payload, raw, sig);
    expect(signed.standard).toBe("nep413");
    expect(signed.payload).toEqual(payload);
    expect(signed.public_key.startsWith("ed25519:")).toBe(true);
    expect(signed.signature.startsWith("ed25519:")).toBe(true);
    expect(verify(null, hash, publicKey, sig)).toBe(true);
  });

  it("deposits the pay token into NEAR Intents with ft_transfer_call", async () => {
    const tx = intentsDepositTx("intents.near", "usdc.near", "1000000");
    expect(tx.receiverId).toBe("usdc.near");
    expect(tx.actions[0]!.params).toMatchObject({ methodName: "ft_transfer_call", args: { receiver_id: "intents.near", amount: "1000000", msg: "" }, deposit: "1" });
  });

  it("registers a named account's key with NEAR Intents so it can sign intents", async () => {
    const tx = intentsAddPublicKeyTx("intents.near", "ed25519:abc");
    expect(tx.receiverId).toBe("intents.near");
    expect(tx.actions[0]!.params).toMatchObject({ methodName: "add_public_key", args: { public_key: "ed25519:abc" }, deposit: "1" });
  });
});

describe("base58", () => {
  it("matches known vectors", async () => {
    const { base58 } = await import("../src/nep413.ts");
    expect(base58(new TextEncoder().encode("Hello World!"))).toBe("2NEpo7TZRRrLZSi2U");
    expect(base58(new Uint8Array(3))).toBe("111");
  });
});
