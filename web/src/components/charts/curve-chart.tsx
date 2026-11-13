"use client";

import { formatCompact } from "@backed/client";
import { useMemo, useState } from "react";
import { curvePriceAt, soldAtGraduation, tokensForNet, type CurveF } from "@/lib/curve";
import { useWidth } from "@/lib/hooks";
import { axisPrice, fmtUnit, unitPrice, type PriceUnit } from "@/lib/money";
import { cx, pctText } from "../ui";

type Props = {
  curve: CurveF;
  /** Tokens sold on the curve now (whole tokens). */
  sold: number;
  /** Surplus per token now (BU). */
  s: number;
  /** The floor now (BU per token); in Index mode this is reserve / supply. */
  floor: number;
  graduated: boolean;
  unit: PriceUnit;
  buE6: number;
  /** A typed buy, in BU after the fee, to show where it lands. */
  previewNet?: number | null;
  height?: number;
  className?: string;
};

const PAD_BASE = { l: 8, r: 64, t: 16, b: 24 };

/**
 * The bonding curve over tokens sold: what has been bought, where the price is now, the floor
 * under it, the graduation point, and where a typed buy would land.
 */
export function CurveChart({ curve, sold, s, floor, graduated, unit, buE6, previewNet, height = 320, className }: Props) {
  // Small embeds (the launch preview) drop the legend and the graduation detail line.
  const compact = height < 220;
  const [ref, measured] = useWidth<HTMLDivElement>();
  const W = Math.max(measured || 640, 160);
  const H = height;
  // In a narrow panel the readout row (top left) would run into the graduation label (top right),
  // so the plot starts below it.
  const PAD = W < 560 ? { ...PAD_BASE, t: 40 } : PAD_BASE;
  const gradSold = soldAtGraduation(curve);
  const xMax = gradSold * 1.06;
  const priceAt = (t: number) => curvePriceAt(curve, t) + (graduated ? 0 : s);
  const yMax = priceAt(gradSold) * 1.08;
  const X = (t: number) => PAD.l + (t / xMax) * (W - PAD.l - PAD.r);
  const Y = (p: number) => PAD.t + (1 - p / yMax) * (H - PAD.t - PAD.b);
  const u = (p: number) => unitPrice(p, unit, buE6);

  const path = useMemo(() => {
    const pts: string[] = [];
    const n = 160;
    for (let i = 0; i <= n; i++) {
      const t = (gradSold * i) / n;
      pts.push(`${i ? "L" : "M"}${X(t).toFixed(1)},${Y(priceAt(t)).toFixed(1)}`);
    }
    return pts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, H, s, graduated, curve.x0, curve.y0, curve.grad]);

  const area = (from: number, to: number) => {
    const n = 80;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      pts.push(`${X(t).toFixed(1)},${Y(priceAt(t)).toFixed(1)}`);
    }
    return `M${X(from).toFixed(1)},${Y(0)} L${pts.join(" L")} L${X(to).toFixed(1)},${Y(0)} Z`;
  };

  const here = graduated ? gradSold : Math.min(sold, gradSold);
  const pNow = priceAt(here);
  const land = !graduated && previewNet && previewNet > 0 ? tokensForNet(curve, here, s, previewNet) : null;
  const landSold = land ? here + land.tokens : null;
  const pLand = landSold !== null ? priceAt(landSold) : null;

  const [hoverT, setHoverT] = useState<number | null>(null);
  const yTicks = [0.25, 0.5, 0.75, 1].map((f) => (yMax / 1.08) * f);
  const xTicks = [0, 200e6, 400e6, 600e6, 800e6].filter((t) => t < xMax);

  return (
    <div ref={ref} className={cx("relative w-full select-none", className)} style={{ height: H }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        role="img"
        aria-label={`Bonding curve. ${formatCompact(here)} of ${formatCompact(gradSold)} tokens sold; price ${fmtUnit(u(pNow), unit)}, floor ${fmtUnit(u(floor), unit)}.`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = ((e.clientX - r.left - PAD.l) / (W - PAD.l - PAD.r)) * xMax;
          setHoverT(t >= 0 && t <= gradSold ? t : null);
        }}
        onPointerLeave={() => setHoverT(null)}
      >
        {yTicks.map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(p)} y2={Y(p)} stroke="var(--line)" />
            <text x={W - PAD.r + 6} y={Y(p) + 3.5} fontSize="10.5" fill="var(--muted)" className="num">
              {axisPrice(u(p), unit)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={X(t)} y={H - 7} fontSize="10.5" fill="var(--muted)" className="num" textAnchor={t === 0 ? "start" : "middle"}>
            {t === 0 ? "0 sold" : formatCompact(t)}
          </text>
        ))}

        {/* Bought so far. */}
        {here > 0 && <path d={area(0, here)} fill="var(--ink)" opacity="0.07" />}
        {/* A typed buy. */}
        {landSold !== null && <path d={area(here, landSold)} fill="var(--ink)" opacity="0.2" />}
        {/* The floor: everything under it is backed. */}
        <rect x={PAD.l} y={Y(floor)} width={Math.max(0, W - PAD.l - PAD.r)} height={Math.max(0, Y(0) - Y(floor))} fill="var(--floor)" />
        <line x1={PAD.l} x2={W - PAD.r} y1={Y(floor)} y2={Y(floor)} stroke="var(--floor-deep)" strokeWidth="1.5" />
        <rect x={W - PAD.r + 2} y={Y(floor) - 8} width={PAD.r - 4} height={16} rx={8} fill="var(--floor)" />
        <text x={W - PAD.r + 8} y={Y(floor) + 3.5} fontSize="10.5" fill="var(--floor-ink)" className="num" fontWeight="700">
          {axisPrice(u(floor), unit)}
        </text>

        <path d={path} fill="none" stroke="var(--ink-2)" strokeWidth="1.75" strokeLinejoin="round" />

        {/* Graduation. */}
        <line x1={X(gradSold)} x2={X(gradSold)} y1={PAD.t} y2={Y(0)} stroke="var(--line-2)" strokeDasharray="3 3" />
        <text x={X(gradSold) - 6} y={PAD.t + 10} fontSize="11" fill="var(--ink-2)" textAnchor="end" fontWeight="600">
          Graduation
        </text>
        <text x={X(gradSold) - 6} y={PAD.t + 24} display={compact ? "none" : undefined} fontSize="10.5" fill="var(--muted)" textAnchor="end" className="num">
          {formatCompact(gradSold)} sold · {formatCompact(curve.grad)} BU
        </text>
        <circle cx={X(gradSold)} cy={Y(priceAt(gradSold))} r="3" fill="var(--panel)" stroke="var(--ink-2)" strokeWidth="1.5" />

        {/* Now. */}
        <line x1={X(here)} x2={X(here)} y1={Y(pNow)} y2={Y(0)} stroke="var(--ink)" strokeDasharray="2 3" opacity="0.6" />
        <circle cx={X(here)} cy={Y(pNow)} r="4.5" fill="var(--ink)" stroke="var(--panel)" strokeWidth="2" />
        <text x={X(here) + (X(here) > W * 0.6 ? -8 : 8)} y={Y(pNow) - 8} fontSize="11" fill="var(--ink)" fontWeight="650" className="num" textAnchor={X(here) > W * 0.6 ? "end" : "start"}>
          {graduated ? "Graduated: the pool sets the price" : `Now ${fmtUnit(u(pNow), unit)}`}
        </text>

        {landSold !== null && pLand !== null && (
          <g>
            <circle cx={X(landSold)} cy={Y(pLand)} r="4" fill="var(--panel)" stroke="var(--ink)" strokeWidth="1.75" />
            <text x={X(landSold) + 8} y={Y(pLand) + 14} fontSize="11" fill="var(--ink)" className="num">
              {fmtUnit(u(pLand), unit)} ({pctText((pLand / pNow - 1) * 100)})
            </text>
          </g>
        )}

        {hoverT !== null && (
          <g pointerEvents="none">
            <line x1={X(hoverT)} x2={X(hoverT)} y1={PAD.t} y2={Y(0)} stroke="var(--line-2)" />
            <circle cx={X(hoverT)} cy={Y(priceAt(hoverT))} r="3" fill="var(--ink-2)" />
          </g>
        )}
      </svg>
      <div className={cx("pointer-events-none absolute left-2.5 top-2 flex flex-wrap gap-x-3 text-xs", compact && "hidden")}>
        {hoverT !== null ? (
          <>
            <span>
              <span className="text-muted">Sold </span>
              <span className="num">{formatCompact(hoverT)}</span>
            </span>
            <span>
              <span className="text-muted">Price </span>
              <span className="num">{fmtUnit(u(priceAt(hoverT)), unit, { suffix: false })}</span>
            </span>
          </>
        ) : (
          <>
            <span>
              <span className="text-muted">Sold </span>
              <span className="num">
                {formatCompact(here)} / {formatCompact(gradSold)}
              </span>
            </span>
            <span>
              <span className="text-muted">Floor </span>
              <span className="num rounded-[4px] bg-floor px-1 font-semibold text-floor-ink">{fmtUnit(u(floor), unit, { suffix: false })}</span>
            </span>
            {land && (
              <span>
                <span className="text-muted">Your buy </span>
                <span className="num">+{formatCompact(land.tokens)} tokens</span>
                {land.capped && <span className="font-semibold"> · reaches graduation</span>}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
