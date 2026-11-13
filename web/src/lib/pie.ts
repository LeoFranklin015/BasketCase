/**
 * Donut geometry for the basket pie. Angles are radians, 0 at twelve o'clock, clockwise.
 */

export type Arc = { start: number; end: number };

const TAU = Math.PI * 2;

/** One arc per value, in order, sized by its share of the total. Non-positive values get no arc. */
export function arcs(values: number[], gap = 0): Arc[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  if (total <= 0) return values.map(() => ({ start: 0, end: 0 }));
  const parts = clean.filter((v) => v > 0).length;
  const g = parts > 1 ? gap : 0;
  let at = 0;
  return clean.map((v) => {
    const span = (v / total) * TAU;
    const a = { start: at + (v > 0 ? g / 2 : 0), end: at + span - (v > 0 ? g / 2 : 0) };
    at += span;
    return a.end > a.start ? a : { start: a.start, end: a.start };
  });
}

/** A point on a circle at `angle` (0 = top, clockwise). */
export function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

const f = (n: number) => (Math.abs(n) < 1e-9 ? 0 : Math.round(n * 1000) / 1000);

/** SVG path for a ring segment between radii r0 (inner) and r1 (outer). A full turn draws a whole ring. */
export function donutPath(cx: number, cy: number, r0: number, r1: number, start: number, end: number): string {
  const span = end - start;
  if (span <= 0) return "";
  if (span >= TAU - 1e-6) {
    // Two half rings: one arc can't start and end on the same point.
    return [
      `M${f(cx)},${f(cy - r1)}`,
      `A${r1},${r1} 0 1 1 ${f(cx)},${f(cy + r1)}`,
      `A${r1},${r1} 0 1 1 ${f(cx)},${f(cy - r1)}`,
      `M${f(cx)},${f(cy - r0)}`,
      `A${r0},${r0} 0 1 0 ${f(cx)},${f(cy + r0)}`,
      `A${r0},${r0} 0 1 0 ${f(cx)},${f(cy - r0)}`,
      "Z",
    ].join(" ");
  }
  const large = span > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, r1, start);
  const [x2, y2] = polar(cx, cy, r1, end);
  const [x3, y3] = polar(cx, cy, r0, end);
  const [x4, y4] = polar(cx, cy, r0, start);
  return `M${f(x1)},${f(y1)} A${r1},${r1} 0 ${large} 1 ${f(x2)},${f(y2)} L${f(x3)},${f(y3)} A${r0},${r0} 0 ${large} 0 ${f(x4)},${f(y4)} Z`;
}
