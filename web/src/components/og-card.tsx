import { coinColor, coinHue } from "../lib/assets";

/**
 * The link card (1200×630) for a coin, drawn for `next/og` (Satori): every box is flex, styles are
 * inline, and the hatch is an SVG pattern. It repeats the landing hero's picture: the coin as one tall
 * block, solid yellow up to its backed share with the ink floor line, ink stripes (hype) above.
 * The light money-app look of DESIGN.md (shared with the X player card): soft grey page, a white card,
 * the coin's own colour on its avatar and glow, Inter throughout; yellow only for the floor.
 * Pure presentation: the caller passes numbers already formatted.
 */
export type OgCardProps = {
  brand: string;
  /** e.g. "NEAR testnet". */
  network: string;
  ticker: string;
  name: string | null;
  /** "Fair launch" / "Growing" / "Graduated", or null when the coin could not be read. */
  stage: string | null;
  /** "per 1M tokens" etc.; the unit both prices are shown in. */
  unit: string;
  price: string | null;
  floor: string | null;
  /** Backed share of the price, 0..1. */
  share: number;
  /** `icon` / `chainIcon`: data: URIs of the token logo and its origin chain's logo, when there is one. */
  basket: { symbol: string; share: number; color: string; icon?: string | null; chainIcon?: string | null }[];
};

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 700 | 800; style: "normal" };

/** One TTF from Google Fonts' CSS API (Satori reads TTF/OTF, not WOFF2). `stretch` picks a width instance. */
async function googleTtf(family: string, query: string, stretch?: string): Promise<ArrayBuffer | null> {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:${query}`)).text();
  const faces = css.split("@font-face").slice(1);
  const face = faces.find((f) => !stretch || f.includes(`font-stretch: ${stretch}`)) ?? faces[0];
  const url = face && /src: url\((.+?)\) format\('(?:truetype|opentype)'\)/.exec(face)?.[1];
  return url ? (await fetch(url)).arrayBuffer() : null;
}

let fontsOnce: Promise<OgFont[]> | null = null;

/**
 * Fonts for the card: Inter 400/500/700/800. Fetched once per server process; on any failure the card
 * falls back to the default font rather than failing.
 * Usage: `new ImageResponse(<OgCard … />, { width: 1200, height: 630, fonts: await loadOgFonts() })`.
 */
export function loadOgFonts(): Promise<OgFont[]> {
  fontsOnce ??= (async () => {
    try {
      const weights = [400, 500, 700, 800] as const;
      const files = await Promise.all(weights.map((w) => googleTtf("Inter", `wght@${w}`)));
      return files.flatMap((data, i) => (data ? [{ name: "Inter", data, weight: weights[i]!, style: "normal" as const }] : []));
    } catch {
      fontsOnce = null;
      return [];
    }
  })();
  return fontsOnce;
}

const C = { page: "#f6f6f6", card: "#ffffff", ink: "#111111", muted: "#6e6e73", faint: "#8e8e93", pill: "#ececec", floor: "#ffe14d", floorDeep: "#e0b400", hatchBg: "#f2f2f2" };

function Hatch({ w, h }: { w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: 0, top: 0 }}>
      <defs>
        <pattern id="h" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <rect width="14" height="14" fill={C.hatchBg} />
          <rect width="4" height="14" fill="rgba(17,17,17,0.12)" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#h)" />
    </svg>
  );
}

/** "$560.92" as "$560" + grey ".92". */
function Money({ text, size }: { text: string; size: number }) {
  const m = /^(.*\d)(\.\d+)$/.exec(text);
  return (
    <div style={{ display: "flex", fontSize: size, fontWeight: 700, letterSpacing: -size * 0.035, lineHeight: 1 }}>
      <div style={{ display: "flex" }}>{m ? m[1] : text}</div>
      {m && <div style={{ display: "flex", color: C.faint }}>{m[2]}</div>}
    </div>
  );
}

export function OgCard(p: OgCardProps) {
  const pct = Math.round(Math.max(0, Math.min(1, p.share)) * 100);
  const BW = 330;
  const BH = 440;
  const yellow = Math.round((BH * pct) / 100);
  const backedBy = p.basket.length ? p.basket.slice(0, 2).map((b) => b.symbol).join(" + ") + (p.basket.length > 2 ? ` + ${p.basket.length - 2} more` : "") : "";
  const hue = coinHue(p.ticker);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: `radial-gradient(60% 70% at 25% 0%, hsla(${hue}, 85%, 62%, 0.35), ${C.page} 72%)`,
        color: C.ink,
        padding: "0 70px",
        fontFamily: "Inter",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>{`$${p.ticker}`}</div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 500, letterSpacing: 0.5, background: C.pill, borderRadius: 999, padding: "8px 18px", textTransform: "uppercase" }}>
            {`${p.brand} · ${p.network}`}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 30 }}>
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 104, height: 104, borderRadius: 999, background: coinColor(p.ticker), color: "#fff", fontSize: 42, fontWeight: 700, letterSpacing: -2 }}
          >
            {p.ticker.slice(0, 2)}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 500, color: C.muted }}>{p.name ?? "Coin not found"}</div>
            {p.stage && <div style={{ display: "flex", marginTop: 8, fontSize: 18, fontWeight: 500, color: C.ink, background: C.pill, borderRadius: 999, padding: "4px 14px", alignSelf: "flex-start" }}>{p.stage}</div>}
          </div>
        </div>
        {p.price && p.floor && (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
            <Money text={p.price} size={92} />
            <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 18, fontSize: 26, fontWeight: 500 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", background: C.floor, borderRadius: 9, padding: "3px 10px" }}>{p.floor}</div>
                <div style={{ display: "flex", color: C.faint, textTransform: "uppercase", fontSize: 22 }}>floor</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex" }}>{`${pct}%`}</div>
                <div style={{ display: "flex", color: C.faint, textTransform: "uppercase", fontSize: 22 }}>backed</div>
              </div>
              <div style={{ display: "flex", color: C.faint, fontSize: 22 }}>{`price ${p.unit}`}</div>
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22, fontSize: 22, color: C.muted }}>
          <div style={{ display: "flex" }}>
            {p.basket.slice(0, 4).map((b, i) =>
              b.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={b.symbol} src={b.icon} width={34} height={34} alt="" style={{ borderRadius: 999, border: "3px solid #fff", marginLeft: i ? -10 : 0 }} />
              ) : (
                <div key={b.symbol} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 999, border: "3px solid #fff", marginLeft: i ? -10 : 0, background: b.color, color: "#fff", fontSize: 14, fontWeight: 700 }}>
                  {b.symbol.slice(0, 1)}
                </div>
              ),
            )}
          </div>
          <div style={{ display: "flex" }}>{backedBy ? `backed by ${backedBy}` : "basket loading"}</div>
        </div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 18, color: C.faint }}>The floor is the least a sell pays per token, before the fee. It moves with the assets; not a guarantee.</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: 22, background: C.card, borderRadius: 36, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", position: "relative", width: BW, height: BH, borderRadius: 24, overflow: "hidden" }}>
          <Hatch w={BW} h={BH} />
          <div style={{ display: "flex", position: "absolute", left: 0, right: 0, bottom: 0, height: yellow, background: C.floor }} />
          {pct > 0 && pct < 100 && <div style={{ display: "flex", position: "absolute", left: 0, right: 0, bottom: yellow - 2, height: 4, borderTop: `4px dashed ${C.floorDeep}` }} />}
          <div style={{ display: "flex", position: "absolute", left: 16, top: 16, fontSize: 18, fontWeight: 500, background: C.card, borderRadius: 999, padding: "4px 12px" }}>hype</div>
          <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 22, right: 22, bottom: 22, ...(pct < 38 ? { background: C.card, borderRadius: 16, padding: "10px 14px" } : {}) }}>
            <div style={{ display: "flex", fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 0.95 }}>{`${pct}%`}</div>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 500, marginTop: 8 }}>{backedBy ? `backed by ${backedBy}` : "backed"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
