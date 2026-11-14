// Read-only proof that NEAR Intents on mainnet accepts our wallet signatures: signs payloads with throwaway
// MetaMask-style (ERC-191) and Phantom-style (raw Ed25519) keys and runs them through `simulate_intents`, a view
// call. Nothing is sent and nothing is spent.
//   pnpm --filter scripts exec tsx src/intents-check.ts
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { base58, buyIntent, erc191Signed, intentsIdFor, payloadString, rawEd25519Signed, sellIntent, versionedNonce, type SignedIntent } from "../../packages/client/src/index.ts";

const RPCS = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org", "https://near.lava.build"];
const enc = new TextEncoder();
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

async function view(method: string, args: object): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
      });
      const j = (await r.json()) as { result?: { result?: number[]; error?: string }; error?: { data?: string; cause?: { info?: { error_message?: string } } } };
      if (j.result?.result) return { ok: true, value: JSON.parse(Buffer.from(j.result.result).toString()) };
      const err = j.result?.error ?? j.error?.cause?.info?.error_message ?? j.error?.data ?? JSON.stringify(j.error);
      if (err && !/rate|Too Many|timeout/i.test(err)) return { ok: false, error: err };
    } catch {
      // next RPC
    }
  }
  throw new Error("no RPC answered");
}

const salt = (await view("current_salt", {})) as { ok: true; value: string };
const deadline = new Date(Date.now() + 5 * 60_000);

function evm(): { id: string; sign: (p: string) => SignedIntent } {
  const sk = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(sk, false);
  const id = "0x" + Buffer.from(keccak_256(pub.slice(1)).slice(12)).toString("hex");
  return {
    id,
    sign: (p) => {
      const m = enc.encode(p);
      const s = secp256k1.sign(keccak_256(new Uint8Array([...enc.encode(`\x19Ethereum Signed Message:\n${m.length}`), ...m])), sk);
      return erc191Signed(p, "0x" + s.toCompactHex() + (27 + s.recovery).toString(16)); // as MetaMask returns it
    },
  };
}
function sol(): { id: string; sign: (p: string) => SignedIntent } {
  const sk = ed25519.utils.randomPrivateKey();
  const pk = ed25519.getPublicKey(sk);
  return { id: intentsIdFor("solana", base58(pk)), sign: (p) => rawEd25519Signed(p, pk, ed25519.sign(enc.encode(p), sk)) };
}

let failed = 0;
for (const [name, w] of [["MetaMask (erc191)", evm()], ["Phantom (raw_ed25519)", sol()]] as const) {
  const mk = (intents: Parameters<typeof payloadString>[0]["intents"]) =>
    w.sign(payloadString({ signer_id: w.id, verifier: "intents.near", deadline, nonce: versionedNonce(salt.value, deadline), intents }));
  // 1. Nothing to do: only the signature, nonce and deadline are checked. Must pass.
  const empty = await view("simulate_intents", { signed: [mk([])] });
  // 2. A buy with money the throwaway key doesn't have: must get past the signature and fail on the balance.
  const buy = await view("simulate_intents", { signed: [mk([buyIntent("coin.example.near", { [USDC]: "1000000" }, "1")])] });
  // 3. Same for a sell.
  const sell = await view("simulate_intents", { signed: [mk([sellIntent("coin.example.near", "1000", "0", w.id)])] });
  // 4. A tampered signature must be rejected.
  const good = mk([]);
  const bad = { ...good, payload: good.payload.replace(w.id, w.id === w.id.toLowerCase() ? w.id : w.id) + " " };
  const tampered = await view("simulate_intents", { signed: [bad] });
  const rows: [string, boolean, string][] = [
    ["signature accepted (empty intents)", empty.ok, empty.ok ? "ok" : empty.error],
    ["buy parses, stops at balance", !buy.ok && /balance|overflow|insufficient/i.test(buy.error), buy.ok ? "unexpectedly ok" : buy.error],
    ["sell parses, stops at balance", !sell.ok && /balance|overflow|insufficient/i.test(sell.error), sell.ok ? "unexpectedly ok" : sell.error],
    ["tampered payload rejected", !tampered.ok && !/balance/i.test(tampered.error), tampered.ok ? "unexpectedly ok" : tampered.error],
  ];
  console.log(`\n${name}  signer ${w.id}`);
  for (const [what, pass, detail] of rows) {
    if (!pass) failed++;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${what}  — ${detail.slice(0, 160)}`);
  }
}
process.exit(failed ? 1 : 0);
