import { cx } from "../ui";

type Pt = { t: number; p: number };

/** A small price line with the floor drawn under it. Pure SVG; no axes. */
export function Sparkline({ price, floor, width = 112, height = 32, className, label, fluid }: { price: Pt[]; floor?: Pt[]; width?: number; height?: number; className?: string; label: string; /** Stretch to the container width. */ fluid?: boolean }) {
  if (price.length < 2) {
    return (
      <span className={cx("inline-flex items-center text-xs text-muted", className)} style={{ width, height }}>
        no trades
      </span>
    );
  }
  const all = [...price, ...(floor ?? [])];
  const t0 = Math.min(...all.map((x) => x.t));
  const t1 = Math.max(...all.map((x) => x.t));
  const lo = Math.min(...all.map((x) => x.p));
  const hi = Math.max(...all.map((x) => x.p));
  const span = hi - lo || hi || 1;
  const X = (t: number) => 1 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 2);
  const Y = (p: number) => 2 + (1 - (p - lo) / span) * (height - 4);
  const line = (pts: Pt[]) => pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`).join(" ");
  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      className={cx("block overflow-visible", className)}
      role="img"
      aria-label={label}
    >
      {floor && floor.length > 1 && (
        <>
          <path d={`${line(floor)} L${X(floor.at(-1)!.t)},${height} L${X(floor[0]!.t)},${height} Z`} fill="var(--floor)" fillOpacity={0.35} />
          <path d={line(floor)} fill="none" stroke="var(--floor-deep)" strokeWidth="1.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </>
      )}
      <path
        d={line(price)}
        fill="none"
        stroke={price.at(-1)!.p < price[0]!.p ? "var(--down)" : "var(--up-line)"}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
