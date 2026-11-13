"use client";

import { formatCompact, formatTiny } from "@backed/client";
import { useEffect, useRef, useState } from "react";
import { usePoll } from "@/lib/hooks";
import { orderSeries, parseSim, prettyKey, type Scenario, type Series } from "@/lib/sim-data";

/** Width of an element in CSS px, so chart text renders at its real size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
import { Empty, ErrorNote, Skeleton, Tabs } from "./ui";

async function loadSim() {
  const res = await fetch("/sim.json", { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`sim.json: HTTP ${res.status}`);
  return parseSim(await res.json());
}

function fmt(n: number): string {
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 10_000) return formatCompact(n);
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return formatTiny(n, 3);
}

export function SimView() {
  const q = usePoll(loadSim, [], 0);
  const [sel, setSel] = useState<string | null>(null);

  if (q.loading && !q.data) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data || q.data.scenarios.length === 0) {
    return (
      <Empty title="No simulation output yet">
        The simulator writes <code className="font-mono">web/public/sim.json</code>. Run <code className="font-mono">cargo run -p sim --release</code> and reload.
      </Empty>
    );
  }
  const data = q.data;
  const current = data.scenarios.find((s) => s.id === sel) ?? data.scenarios[0]!;
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <div className="min-w-max">
          <Tabs label="Scenario" value={current.id} onChange={setSel} options={data.scenarios.map((s) => ({ id: s.id, label: s.title }))} />
        </div>
      </div>
      <ScenarioView s={current} />
      {data.params.length > 0 && (
        <details className="card p-5 text-sm">
          <summary className="cursor-pointer font-semibold">Parameters</summary>
          <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {data.params.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line py-1">
                <dt className="text-muted">{prettyKey(k)}</dt>
                <dd className="num text-right text-xs">{v}</dd>
              </div>
            ))}
          </dl>
          {data.generatedBy && <p className="mono mt-3 text-[11px] text-muted">{data.generatedBy}</p>}
        </details>
      )}
    </div>
  );
}

type Unit = "$" | "%" | "BU" | "tokens";
type Combo = { keys: [string, string]; title: string; caption: string; unit: Unit; labels: [string, string] };
const COMBOS: Combo[] = [
  { keys: ["price_usd", "floor_usd"], title: "Price and floor", caption: "Dollars per token. The yellow block is the floor: the least a sell pays.", unit: "$", labels: ["price", "floor"] },
  { keys: ["price_bu", "floor_bu"], title: "Price and floor", caption: "Basket units per token. The yellow block is the floor.", unit: "BU", labels: ["price", "floor"] },
  {
    keys: ["holders_avg_cost_bu", "floor_bu"],
    title: "Floor against what holders paid",
    caption: "Basket units per token. When the line meets the yellow block, an average holder could sell at the floor and get their money back.",
    unit: "BU",
    labels: ["what holders paid on average", "floor"],
  },
];

/** Plain names and units for the single-series charts. `scale` turns a 0..1 share into percent. */
const PLAIN: Record<string, { title: string; unit: Unit; scale?: number; noun?: string }> = {
  floor_pct_of_price: { title: "How much of the price the floor covers", unit: "%" },
  price_usd: { title: "Price", unit: "$" },
  floor_usd: { title: "Floor", unit: "$" },
  price_bu: { title: "Price, in basket units", unit: "BU" },
  floor_bu: { title: "Floor, in basket units", unit: "BU" },
  vault_bu: { title: "What the vault holds", unit: "BU" },
  surplus_per_token: { title: "Backing each token gained from fees and burns", unit: "BU" },
  holders_avg_cost_bu: { title: "What holders paid on average", unit: "BU" },
  supply: { title: "Tokens in existence", unit: "tokens" },
  circulating: { title: "Tokens held by people", unit: "tokens" },
  burned_total: { title: "Tokens burned", unit: "tokens", noun: "burns" },
  redeemed_total: { title: "Tokens redeemed", unit: "tokens", noun: "redeems" },
  bu_usd: { title: "What one basket unit is worth", unit: "$" },
  graduated_share: { title: "Runs that graduated", unit: "%", scale: 100, noun: "graduations" },
};

const plain = (key: string) => PLAIN[key] ?? { title: prettyKey(key), unit: "tokens" as Unit };

function scaled(x: Series, k = 1): Series {
  return k === 1 ? x : { ...x, points: x.points.map((p) => ({ x: p.x, mid: p.mid * k, lo: p.lo === undefined ? undefined : p.lo * k, hi: p.hi === undefined ? undefined : p.hi * k })) };
}

const isFlatZero = (x: Series) => x.points.every((p) => p.mid === 0 && (p.lo ?? 0) === 0 && (p.hi ?? 0) === 0);

function ScenarioView({ s }: { s: Scenario }) {
  const byKey = new Map(s.series.map((x) => [x.key, x]));
  // One price-and-floor chart (dollars if present), then the cost comparison.
  const combos = COMBOS.filter((c) => c.keys.every((k) => byKey.has(k))).filter((c, i, all) => !(c.title === "Price and floor" && all.findIndex((x) => x.title === c.title) !== i));
  const used = new Set(combos.flatMap((c) => c.keys));
  const rest = orderSeries(s.series).filter((x) => !used.has(x.key));
  const flat = rest.filter(isFlatZero);
  const moving = rest.filter((x) => !isFlatZero(x));
  const [main, ...others] = combos;
  return (
    <section aria-labelledby="scenario-h" className="space-y-6">
      <div className="max-w-3xl">
        <h2 id="scenario-h" className="text-2xl font-bold tracking-[-0.03em]">
          {s.title}
        </h2>
        {s.description && <p className="mt-1 text-ink-2">{s.description}</p>}
      </div>
      {main && (
        <div className="card p-5 sm:p-6">
          <ChartTitle title={main.title} caption={main.caption} />
          <Chart series={[byKey.get(main.keys[0])!, byKey.get(main.keys[1])!]} floorIndex={1} unit={main.unit} labels={main.labels} events={s.events} height={300} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        {others.map((c) => (
          <div key={c.title + c.unit} className="card p-5 sm:p-6">
            <ChartTitle title={c.title} caption={c.caption} />
            <Chart series={[byKey.get(c.keys[0])!, byKey.get(c.keys[1])!]} floorIndex={1} unit={c.unit} labels={c.labels} events={s.events} height={220} />
          </div>
        ))}
        {s.stats.length > 0 && (
          <div className="card p-5 sm:p-6">
            <h3 className="h2">Across all runs</h3>
            <p className="caption">The middle run, with the 10th to 90th percentile in brackets where there is a range.</p>
            <dl className="mt-3 divide-y divide-line">
              {s.stats.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1.5 text-sm">
                  <dt className="text-ink-2">{prettyKey(k)}</dt>
                  <dd className="num text-right font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
      {moving.length > 0 && (
        <section aria-labelledby="more-h">
          <h3 id="more-h" className="text-lg font-bold tracking-[-0.02em]">
            The rest of the coin, day by day
          </h3>
          <p className="caption">Middle run as a line; the grey band covers the 10th to 90th percentile.</p>
          <div className="card mt-3 grid gap-x-8 gap-y-7 p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
            {moving.map((x) => {
              const m = plain(x.key);
              return (
                <div key={x.key} className="min-w-0">
                  <ChartTitle title={m.title} caption={m.unit === "tokens" ? "tokens" : m.unit === "BU" ? "basket units" : undefined} />
                  <Chart series={[scaled(x, m.scale)]} unit={m.unit} labels={[m.title]} events={s.events} height={130} />
                </div>
              );
            })}
          </div>
        </section>
      )}
      {flat.length > 0 && (
        <p className="caption rounded-[14px] bg-sunk px-4 py-3">
          No {joinWords(flat.map((x) => plain(x.key).noun ?? plain(x.key).title.toLowerCase()))} in this scenario.
        </p>
      )}
    </section>
  );
}

function joinWords(w: string[]): string {
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} or ${w.at(-1)}`;
}

function ChartTitle({ title, caption }: { title: string; caption?: string }) {
  return (
    <div className="mb-3">
      <h3 className="font-semibold">{title}</h3>
      {caption && <p className="caption text-xs">{caption}</p>}
    </div>
  );
}

function tick(v: number, unit: Unit): string {
  if (unit === "$") return `$${fmt(v)}`;
  if (unit === "%") return `${fmt(v)}%`;
  return fmt(v);
}

function Chart({ series, floorIndex, unit, labels, events, height }: { series: Series[]; floorIndex?: number; unit: Unit; labels: string[]; events: Scenario["events"]; height: number }) {
  const [ref, measured] = useWidth<HTMLElement>();
  const W = measured || 320;
  const H = height;
  const pad = { l: 64, r: 8, t: 10, b: 20 };
  const all = series.flatMap((s) => s.points);
  if (all.length < 2)
    return (
      <figure ref={ref}>
        <p className="caption">Not enough points.</p>
      </figure>
    );
  const xs = all.map((p) => p.x);
  const ys = all.flatMap((p) => [p.lo ?? p.mid, p.hi ?? p.mid]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMax = Math.max(...ys);
  const yMin = Math.min(0, ...ys);
  const span = yMax - yMin || 1;
  const X = (x: number) => pad.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const Y = (y: number) => pad.t + (1 - (y - yMin) / span) * (H - pad.t - pad.b);
  const ticks = [yMin, yMin + span / 2, yMax];
  const lastVals = series.map((s) => s.points.at(-1)?.mid ?? 0);
  const line = (s: Series) => `M${s.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.mid).toFixed(1)}`).join(" L")}`;
  return (
    <figure ref={ref}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block max-w-full"
        role="img"
        aria-label={series.map((s, i) => `${labels[i]}: ${tick(s.points[0]?.mid ?? 0, unit)} on day ${x0} to ${tick(lastVals[i] ?? 0, unit)} on day ${x1}`).join("; ")}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={pad.l - 6} y={Y(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--muted)" className="num">
              {tick(t, unit)}
            </text>
          </g>
        ))}
        {/* The floor first, as a solid yellow block, so the price draws over it. */}
        {floorIndex !== undefined && series[floorIndex] && (
          <g>
            <path
              d={`${line(series[floorIndex])} L${X(series[floorIndex].points.at(-1)!.x).toFixed(1)},${Y(yMin).toFixed(1)} L${X(series[floorIndex].points[0]!.x).toFixed(1)},${Y(yMin).toFixed(1)} Z`}
              fill="var(--floor)"
            />
            <path d={line(series[floorIndex])} fill="none" stroke="var(--floor-deep)" strokeWidth="1.5" />
          </g>
        )}
        {events.map((e) => (
          <g key={`${e.x}-${e.label}`}>
            <line x1={X(e.x)} x2={X(e.x)} y1={pad.t} y2={H - pad.b} stroke="var(--line-2)" strokeDasharray="3 3" />
            <text x={X(e.x) + 3} y={pad.t + 9} fontSize="10" fill="var(--ink-2)">
              {e.label}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          if (i === floorIndex) return null;
          const hasBand = s.points.some((p) => p.lo !== undefined && p.hi !== undefined);
          const bandPath = hasBand
            ? `M${s.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.hi ?? p.mid).toFixed(1)}`).join(" L")} L${[...s.points]
                .reverse()
                .map((p) => `${X(p.x).toFixed(1)},${Y(p.lo ?? p.mid).toFixed(1)}`)
                .join(" L")} Z`
            : null;
          return (
            <g key={s.key}>
              {bandPath && <path d={bandPath} fill="var(--ink)" opacity="0.1" />}
              <path d={line(s)} fill="none" stroke="var(--ink)" strokeWidth="1.75" strokeLinejoin="round" />
            </g>
          );
        })}
        <text x={pad.l} y={H - 5} fontSize="10.5" fill="var(--muted)" className="num">
          day {x0}
        </text>
        <text x={W - pad.r} y={H - 5} textAnchor="end" fontSize="10.5" fill="var(--muted)" className="num">
          day {x1}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        {series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            {i === floorIndex ? <span aria-hidden className="size-2.5 rounded-[3px] bg-floor ring-1 ring-floor-deep" /> : <span aria-hidden className="h-1 w-3.5 rounded-full bg-ink" />}
            {labels[i]} <span className="num text-muted">day {x1}: {tick(lastVals[i] ?? 0, unit)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
