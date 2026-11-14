import { createHash } from "node:crypto";
import { KeyPair, PublicKey, SignedTransaction, encodeTransaction } from "near-api-js";
import { describe, expect, it } from "vitest";
import { implicitPublicKey, sendWithRawSigner, signTransaction } from "./near-signer";

const sha256 = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

// A local ed25519 key stands in for Privy's raw sign: it signs whatever 32-byte hash it is given.
function localSigner() {
  const key = KeyPair.fromRandom("ed25519");
  const pk = key.getPublicKey();
  const accountId = Buffer.from(pk.data).toString("hex");
  const seen: Uint8Array[] = [];
  const sign = async (hash: Uint8Array) => {
    seen.push(hash);
    return key.sign(hash).signature;
  };
  return { key, pk, accountId, sign, seen };
}

const appTx = {
  receiverId: "intents.backedlab.testnet",
  actions: [
    { type: "FunctionCall" as const, params: { methodName: "faucet", args: { token_id: "nep141:usdc.mock", amount: "100000000" }, gas: "30000000000000", deposit: "1" } },
  ],
};

describe("implicitPublicKey", () => {
  it("turns a 64-hex implicit account id into its ed25519 public key", () => {
    const { pk, accountId } = localSigner();
    expect(implicitPublicKey(accountId).toString()).toBe(pk.toString());
  });

  it("rejects anything that is not a 64-hex implicit account", () => {
    expect(() => implicitPublicKey("alice.testnet")).toThrow();
    expect(() => implicitPublicKey("ab".repeat(31))).toThrow();
  });
});

describe("signTransaction", () => {
  it("signs sha256(borsh(tx)) and the signature verifies against the account's public key", async () => {
    const s = localSigner();
    const blockHash = new Uint8Array(32).fill(7);
    const { signed, hash } = await signTransaction({ accountId: s.accountId, nonce: 42n, blockHash, tx: appTx, sign: s.sign });

    // Round-trip through the wire format the RPC receives.
    const wire = SignedTransaction.decode(signed.encode());
    const expectedHash = sha256(encodeTransaction(wire.transaction));
    expect(hash).toEqual(expectedHash);
    expect(s.seen).toEqual([expectedHash]);
    const sig = Uint8Array.from(wire.signature.ed25519Signature!.data);
    expect(sig).toHaveLength(64);
    expect(PublicKey.fromString(s.pk.toString()).verify(expectedHash, sig)).toBe(true);

    expect(wire.transaction.signerId).toBe(s.accountId);
    expect(wire.transaction.receiverId).toBe("intents.backedlab.testnet");
    expect(wire.transaction.nonce).toBe(42n);
    expect(wire.transaction.publicKey.toString()).toBe(s.pk.toString());
    expect(Array.from(wire.transaction.blockHash)).toEqual(Array.from(blockHash));
  });

  it("carries every function call with its args, gas and deposit", async () => {
    const s = localSigner();
    const tx = {
      receiverId: "pad.backedlab.testnet",
      actions: [
        appTx.actions[0]!,
        { type: "FunctionCall" as const, params: { methodName: "buy", args: { min_out: "5" }, gas: "300000000000000", deposit: "1250000000000000000000" } },
      ],
    };
    const { signed } = await signTransaction({ accountId: s.accountId, nonce: 1n, blockHash: new Uint8Array(32), tx, sign: s.sign });
    const calls = SignedTransaction.decode(signed.encode()).transaction.actions.map((a) => a.functionCall!);
    expect(calls.map((c) => c.methodName)).toEqual(["faucet", "buy"]);
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(calls[1]!.args)))).toEqual({ min_out: "5" });
    expect(calls.map((c) => c.gas)).toEqual([30_000_000_000_000n, 300_000_000_000_000n]);
    expect(calls.map((c) => c.deposit)).toEqual([1n, 1_250_000_000_000_000_000_000n]);
  });

  it("refuses a signature that does not verify (e.g. a different key signed)", async () => {
    const s = localSigner();
    const other = localSigner();
    await expect(
      signTransaction({ accountId: s.accountId, nonce: 1n, blockHash: new Uint8Array(32), tx: appTx, sign: other.sign }),
    ).rejects.toThrow(/signature/i);
  });
});

describe("sendWithRawSigner", () => {
  // A fake RPC at the network boundary: it decodes what it is sent, so the test sees the real wire bytes.
  function fakeRpc(opts: { nonce: bigint; failAt?: number }) {
    const sent: { tx: SignedTransaction; waitUntil: string }[] = [];
    const rpc = {
      viewAccessKey: async () => ({ nonce: opts.nonce }),
      viewBlock: async (q: unknown) => {
        expect(q).toEqual({ finality: "final" });
        return { header: { hash: "11111111111111111111111111111111" } };
      },
      sendTransactionUntil: async (signed: SignedTransaction, waitUntil: string) => {
        const tx = SignedTransaction.decode(signed.encode());
        sent.push({ tx, waitUntil });
        const i = sent.length - 1;
        const status = i === opts.failAt ? { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: nope" } } } } } : { SuccessValue: "" };
        return { status, transaction: { hash: `hash-${i}` }, transaction_outcome: { id: `hash-${i}` } };
      },
    };
    return { rpc, sent };
  }

  it("sends each transaction in order with consecutive nonces, waiting for FINAL, and returns the RPC outcomes", async () => {
    const s = localSigner();
    const { rpc, sent } = fakeRpc({ nonce: 100n });
    const second = { ...appTx, receiverId: "pad.backedlab.testnet" };
    const outcomes = await sendWithRawSigner({ rpc, accountId: s.accountId, sign: s.sign }, [appTx, second]);
    expect(sent.map((x) => x.tx.transaction.nonce)).toEqual([101n, 102n]);
    expect(sent.map((x) => x.tx.transaction.receiverId)).toEqual(["intents.backedlab.testnet", "pad.backedlab.testnet"]);
    expect(sent.map((x) => x.waitUntil)).toEqual(["FINAL", "FINAL"]);
    expect(outcomes.map((o) => (o as { transaction: { hash: string } }).transaction.hash)).toEqual(["hash-0", "hash-1"]);
  });

  it("signs for a named account (the relayer, router.<master>) with the key it is given", async () => {
    const s = localSigner();
    const { rpc, sent } = fakeRpc({ nonce: 7n });
    await sendWithRawSigner({ rpc, accountId: "router.backedlab.near", sign: s.sign, publicKey: s.pk }, [appTx]);
    expect(sent[0]!.tx.transaction.signerId).toBe("router.backedlab.near");
    expect(sent[0]!.tx.transaction.publicKey.toString()).toBe(s.pk.toString());
    await expect(sendWithRawSigner({ rpc, accountId: "router.backedlab.near", sign: s.sign }, [appTx])).rejects.toThrow("implicit");
  });

  it("stops after a failed transaction so later steps are not sent", async () => {
    const s = localSigner();
    const { rpc, sent } = fakeRpc({ nonce: 5n, failAt: 0 });
    const outcomes = await sendWithRawSigner({ rpc, accountId: s.accountId, sign: s.sign }, [appTx, appTx]);
    expect(sent).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
  });
});

describe("sending through rate-limited RPCs", () => {
  it("re-sends the same signed transaction after a 429 and returns its outcome", async () => {
    const { sendWithRawSigner } = await import("./near-signer");
    const { KeyPair } = await import("near-api-js");
    const kp = KeyPair.fromRandom("ed25519");
    const accountId = Array.from(kp.getPublicKey().data, (b) => b.toString(16).padStart(2, "0")).join("");
    const sent: string[] = [];
    let calls = 0;
    const rpc = {
      viewAccessKey: async () => ({ nonce: 5 }),
      viewBlock: async () => ({ header: { hash: "11111111111111111111111111111111" } }),
      sendTransactionUntil: async (signed: { transaction: { nonce: bigint } }) => {
        calls++;
        sent.push(String(signed.transaction.nonce));
        if (calls === 1) throw new Error("Exceeded 3 providers to execute request");
        return { status: { SuccessValue: "" } };
      },
    };
    const tx = { receiverId: "coin.testnet", actions: [{ type: "FunctionCall" as const, params: { methodName: "x", args: {}, gas: "1", deposit: "0" } }] };
    const out = await sendWithRawSigner({ rpc: rpc as never, accountId, sign: async (h) => kp.sign(h).signature }, [tx]);
    expect(out).toHaveLength(1);
    expect(sent).toEqual(["6", "6"]); // same nonce: the same transaction, not a second one
  }, 20_000);
});
