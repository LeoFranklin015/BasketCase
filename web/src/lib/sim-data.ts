/**
 * Turns whatever web/public/sim.json holds into scenarios of daily series. It accepts
 * `{scenarios: [...]}` or `{scenarios: {...}}` or a top-level map, and days as an array of
 * records whose values are numbers or `{p10, median, p90}` bands.
 */

export type Point = { x: number; mid: number; lo?: number; hi?: number };
export type Series = { key: string; points: Point[] };
export type Scenario = { id: string; title: string; description?: string; series: Series[]; stats: [string, string][]; events: { x: number; label: string }[] };
export type SimData = { scenarios: Scenario[]; generatedBy?: string; params: [string, string][] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function band(v: unknown): { mid: number; lo?: number; hi?: number } | null {
  if (isNum(v)) return { mid: v };
  if (!isObj(v)) return null;
  const mid = v.median ?? v.p50 ?? v.mean ?? v.mid;
  if (!isNum(mid)) return null;
  const lo = v.p10 ?? v.p5 ?? v.p25 ?? v.min;
  const hi = v.p90 ?? v.p95 ?? v.p75 ?? v.max;
  return { mid, lo: isNum(lo) ? lo : undefined, hi: isNum(hi) ? hi : undefined };
}

function fmtScalar(v: unknown): string | null {
  if (v === null || v === undefined) return "–";
  if (isNum(v)) return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toPrecision(4);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  const b = band(v);
  if (b) return b.lo !== undefined && b.hi !== undefined ? `${fmtScalar(b.mid)} (${fmtScalar(b.lo)}–${fmtScalar(b.hi)})` : fmtScalar(b.mid);
  if (Array.isArray(v) && v.length <= 8 && v.every((x) => isNum(x) || typeof x === "string")) return v.join(", ");
  return null;
}

function flatPairs(o: unknown): [string, string][] {
  if (!isObj(o)) return [];
  return Object.entries(o)
    .map(([k, v]) => [k, fmtScalar(v)] as [string, string | null])
    .filter((p): p is [string, string] => p[1] !== null);
}

function seriesFromDays(days: unknown[]): { series: Series[]; events: Scenario["events"] } {
  const map = new Map<string, Point[]>();
  const events: Scenario["events"] = [];
  let lastMode: unknown;
  days.forEach((d, i) => {
    if (!isObj(d)) return;
    const x = isNum(d.day) ? d.day : i;
    for (const [k, v] of Object.entries(d)) {
      if (k === "day") continue;
      if (k === "mode") {
        if (lastMode !== undefined && v !== lastMode) events.push({ x, label: String(v) });
        lastMode = v;
        continue;
      }
      const b = band(v);
      if (!b) continue;
      const arr = map.get(k) ?? [];
      arr.push({ x, ...b });
      map.set(k, arr);
    }
  });
  return { series: [...map.entries()].map(([key, points]) => ({ key, points })), events };
}

function seriesFromMap(m: Obj): Series[] {
  return Object.entries(m).flatMap(([key, v]) => {
    if (Array.isArray(v) && v.every(isNum)) return [{ key, points: v.map((mid, x) => ({ x, mid })) }];
    if (Array.isArray(v) && v.every((p) => band(p))) return [{ key, points: v.map((p, x) => ({ x, ...band(p)! })) }];
    return [];
  });
}

function scenarioFrom(raw: unknown, fallbackId: string): Scenario | null {
  if (!isObj(raw)) return null;
  const id = String(raw.id ?? raw.name ?? fallbackId);
  const days = raw.days ?? raw.daily;
  let series: Series[] = [];
  let events: Scenario["events"] = [];
  if (Array.isArray(days)) ({ series, events } = seriesFromDays(days));
  else if (isObj(raw.series)) series = seriesFromMap(raw.series);
  else if (Array.isArray(raw.series)) series = (raw.series as unknown[]).flatMap((s) => (isObj(s) && Array.isArray(s.values ?? s.data ?? s.points) ? seriesFromMap({ [String(s.name ?? s.key)]: s.values ?? s.data ?? s.points }) : []));
  else series = seriesFromMap(raw);
  if (series.length === 0) return null;
  return {
    id,
    title: String(raw.title ?? raw.name ?? id),
    description: typeof raw.description === "string" ? raw.description : undefined,
    series,
    stats: flatPairs(raw.stats ?? raw.summary),
    events,
  };
}

export function parseSim(json: unknown): SimData {
  if (!isObj(json)) return { scenarios: [], params: [] };
  const src = json.scenarios ?? json;
  const entries: [string, unknown][] = Array.isArray(src) ? src.map((s, i) => [String(i), s]) : isObj(src) ? Object.entries(src) : [];
  const scenarios = entries.map(([k, v]) => scenarioFrom(v, k)).filter((s): s is Scenario => s !== null);
  return {
    scenarios,
    generatedBy: typeof json.generated_by === "string" ? json.generated_by : undefined,
    params: flatPairs(json.params),
  };
}

const PREFERRED = ["floor_pct_of_price", "price_usd", "floor_usd", "price_bu", "floor_bu", "vault_bu", "surplus_per_token", "supply", "circulating", "burned_total", "redeemed_total"];

/** Known metrics first, then the rest in file order. */
export function orderSeries(series: Series[]): Series[] {
  const rank = (k: string) => {
    const i = PREFERRED.indexOf(k);
    return i === -1 ? PREFERRED.length : i;
  };
  return [...series].sort((a, b) => rank(a.key) - rank(b.key));
}

const LABELS: Record<string, string> = {
  floor_pct_of_price: "Floor as % of price",
  price_usd: "Price ($ per token)",
  floor_usd: "Floor ($ per token)",
  price_bu: "Price (BU per token)",
  floor_bu: "Floor (BU per token)",
  vault_bu: "Vault (BU)",
  surplus_per_token: "s: backing gained per token (BU)",
  holders_avg_cost_bu: "Holders' average cost (BU per token)",
  bu_usd: "1 BU in dollars",
  graduated_share: "Share of runs graduated",
};

export function prettyKey(k: string): string {
  if (LABELS[k]) return LABELS[k];
  const s = k.replace(/_/g, " ").replace(/\bbu\b/g, "(BU)").replace(/\busd\b/g, "($)").replace(/\bpct\b/g, "%");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
