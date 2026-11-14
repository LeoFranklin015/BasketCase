import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import testnet from "../../../deployments/testnet.json";
import mainnet from "../../../deployments/mainnet.json";
import { CHAIN_NAME, WALLET_ICON, chainIconPath, originChain, tokenIconPath, type ChainId } from "./icons";

const pub = (p: string) => path.join(__dirname, "../../public", p);

describe("icons", () => {
  it("every icon path points at a file in public/icons", () => {
    const symbols = [...testnet.tokens, ...mainnet.tokens].map((t) => t.symbol);
    for (const s of symbols) {
      const p = tokenIconPath(s);
      if (p) expect(existsSync(pub(p)), `${s} -> ${p}`).toBe(true);
    }
    for (const c of Object.keys(CHAIN_NAME) as ChainId[]) expect(existsSync(pub(chainIconPath(c))), c).toBe(true);
    for (const w of Object.values(WALLET_ICON)) expect(existsSync(pub(w)), w).toBe(true);
  });

  it("knows the real logos and origin chains, and falls back for the rest", () => {
    expect(tokenIconPath("btc")).toBe("/icons/tokens/btc.png");
    expect(tokenIconPath("wNEAR")).toBe("/icons/tokens/near.jpg");
    expect(tokenIconPath("WIF")).toBe("/icons/tokens/wif.jpg");
    expect(tokenIconPath("BLACKDRAGON")).toBe("/icons/tokens/blackdragon.png");
    expect(tokenIconPath("FROG")).toBeNull();
    expect(originChain("PEPE")).toBe("ethereum");
    expect(originChain("WIF")).toBe("solana");
    expect(originChain("DOGE")).toBe("dogecoin");
    expect(originChain("wNEAR")).toBe("near");
    expect(originChain("SHITZU")).toBe("near");
    expect(originChain("TRUMP")).toBe("solana");
    expect(originChain("NVDAon")).toBe("bsc"); // Ondo's tokenized NVIDIA, bridged from BNB Chain
    expect(originChain("FROG")).toBeNull();
  });
});
