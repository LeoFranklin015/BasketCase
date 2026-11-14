"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  LineSeries,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  LineType,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  createTextWatermark,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { autoLogScale, type Candle } from "@/lib/history";
import { axisPrice, axisPrices, buFloatUsd, fmtQty, fmtUnit, priceUnit, unitPrice, usd, type PriceUnit } from "@/lib/money";
import { alpha, readPalette, useTheme, type ChartPalette } from "@/lib/theme";
import { cx, pctText } from "../ui";

export type ChartMarker = { time: number; kind: "burn" | "graduate" | "launch" };
export type ChartStyle = "line" | "candles";

type Props = {
  candles: Candle[];
  unit: PriceUnit;
  buE6: number;
  /** Omitted: log when the prices in view span more than 20x (a graduation jump), so the floor stays visible. */
  logScale?: boolean;
  /** A price line over the yellow floor (default), or candles with volume. */
  style?: ChartStyle;
  markers?: ChartMarker[];
  /** "$TICKER": set faint across the pane, terminal style, and at the head of the legend. */
  title?: string;
  /** The candle size, shown beside the title ("5m"). */
  interval?: string;
  /** Hide the legend and volume for a small embed. */
  compact?: boolean;
  className?: string;
  /** Shown over an empty chart. */
  empty?: React.ReactNode;
};

const WATERMARK = false;

/** Candles display in the viewer's local time; the library draws UTC, so shift by the offset. */
const tzShift = () => -new Date().getTimezoneOffset() * 60;

/** A min tick that keeps four significant digits at the smallest price shown. */
function minMoveFor(values: number[]): number {
  const lo = Math.min(...values.filter((v) => v > 0));
  if (!Number.isFinite(lo)) return 0.01;
  return Math.min(0.01, 10 ** (Math.floor(Math.log10(lo)) - 4));
}

function chartOptions(p: ChartPalette, compact: boolean, style: ChartStyle) {
  const font = typeof document === "undefined" ? "sans-serif" : getComputedStyle(document.body).fontFamily;
  const cross = { color: alpha(p.muted, 0.5), width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: p.ink };
  return {
    layout: {
      background: { type: ColorType.Solid, color: p.pane },
      textColor: p.muted,
      fontFamily: font,
      fontSize: 11,
      // The attribution is a text link under every chart instead (see TradingViewCredit), so the logo never sits on the data.
      attributionLogo: false,
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: !compact, color: p.gridLine, style: LineStyle.Solid },
    },
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: compact ? { top: 0.12, bottom: 0.04 } : style === "candles" ? { top: 0.16, bottom: 0.22 } : { top: 0.14, bottom: 0.06 },
      minimumWidth: compact ? 0 : 72,
      visible: !compact,
    },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 10, minBarSpacing: 2, visible: !compact },
    crosshair: { mode: CrosshairMode.Normal, vertLine: cross, horzLine: cross },
    handleScale: { axisPressedMouseMove: true, mouseWheel: !compact, pinch: true },
    handleScroll: { mouseWheel: !compact, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  };
}

/** A CSS font stack from a next/font variable, for the canvas (which can't read var()). */
function fontVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

type Legend = { c: Candle; prev: Candle | null } | null;

export function PriceChart({ candles, unit, buE6, logScale, style = "line", markers = [], title, interval, compact = false, className, empty }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    candle: ISeriesApi<"Candlestick">;
    line: ISeriesApi<"Line">;
    floor: ISeriesApi<"Area">;
    vol: ISeriesApi<"Histogram">;
    marks: ISeriesMarkersPluginApi<Time>;
    mark: ReturnType<typeof createTextWatermark<Time>> | null;
  } | null>(null);
  const [theme] = useTheme();
  const [hover, setHover] = useState<Legend>(null);
  const byTime = useMemo(() => new Map(candles.map((c, i) => [c.time + tzShift(), i])), [candles]);
  // Tiny dollar prices read better per 1K or 1M tokens (the same unit as the coin header); BU stays per token.
  const last = candles.at(-1);
  const per = unit === "usd" && last ? priceUnit(unitPrice(last.close, "usd", buE6)) : { mult: 1, label: "per token" };
  const scale = per.mult;
  const lastKey = useRef("");

  // Create once.
  useEffect(() => {
    if (!el.current) return;
    const p = readPalette(el.current);
    const chart = createChart(el.current, { autoSize: true, ...chartOptions(p, compact, styleRef.current) });
    // Volume first, so it sits at the back under the floor and the price.
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    // The floor: a yellow line stepping up under the price as fees and burns raise it, with a faint yellow area below.
    const floor = chart.addSeries(AreaSeries, {
      lineType: LineType.WithSteps,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: !compact,
      title: compact ? "" : "floor",
      crosshairMarkerVisible: false,
    });
    const candle = chart.addSeries(CandlestickSeries, { borderVisible: true, priceLineStyle: LineStyle.Dashed, priceLineWidth: 1, lastValueVisible: !compact });
    const line = chart.addSeries(LineSeries, { lineWidth: 2, priceLineStyle: LineStyle.Dashed, crosshairMarkerRadius: 4, lastValueVisible: !compact });
    const marks = createSeriesMarkers(styleRef.current === "candles" ? candle : line, []);
    // No watermark in this design: the title sits in the legend instead.
    const mark = WATERMARK && !compact && titleRef.current ? createTextWatermark(chart.panes()[0]!, { horzAlign: "center", vertAlign: "center", lines: [] }) : null;
    api.current = { chart, candle, line, floor, vol, marks, mark };
    // A new chart (strict mode mounts twice) needs its visible range set again.
    lastKey.current = "";
    const onMove = (e: MouseEventParams<Time>) => {
      if (e.time === undefined) return setHover(null);
      const i = byTimeRef.current.get(e.time as number);
      if (i === undefined) return setHover(null);
      setHover({ c: candlesRef.current[i]!, prev: candlesRef.current[i - 1] ?? null });
    };
    chart.subscribeCrosshairMove(onMove);
    // The library keeps bar spacing, not the visible range, when its box resizes; until the viewer
    // scrolls or zooms, keep fitting the chosen range to whatever width the layout settles on.
    const host = el.current;
    const ro = new ResizeObserver(() => {
      if (autoRange.current && range.current && host.clientWidth > 0) chart.timeScale().setVisibleLogicalRange(range.current);
    });
    ro.observe(host);
    const manual = () => {
      autoRange.current = false;
    };
    host.addEventListener("wheel", manual, { passive: true });
    host.addEventListener("pointerdown", manual);
    return () => {
      rafs.current.forEach(cancelAnimationFrame);
      rafs.current = [];
      ro.disconnect();
      host.removeEventListener("wheel", manual);
      host.removeEventListener("pointerdown", manual);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, style]);

  const styleRef = useRef(style);
  styleRef.current = style;
  const titleRef = useRef(title);
  titleRef.current = title;
  const range = useRef<{ from: number; to: number } | null>(null);
  const autoRange = useRef(true);
  const rafs = useRef<number[]>([]);

  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const byTimeRef = useRef(byTime);
  byTimeRef.current = byTime;

  // Colours follow the theme.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const p = readPalette(el.current);
    a.chart.applyOptions(chartOptions(p, compact, style));
    a.candle.applyOptions({
      upColor: p.upLine,
      downColor: p.down,
      borderUpColor: p.upLine,
      borderDownColor: p.down,
      wickUpColor: p.upLine,
      wickDownColor: p.down,
      visible: style === "candles",
    });
    a.line.applyOptions({ crosshairMarkerBorderColor: p.pane, visible: style === "line" });
    a.floor.applyOptions({ lineColor: p.floorDeep, lineStyle: LineStyle.Dashed, topColor: alpha(p.floor, 0.32), bottomColor: alpha(p.floor, 0.1) });
    a.vol.applyOptions({ visible: style === "candles" && !compact });
    a.mark?.applyOptions({
      lines: [{ text: title ? `${title}${interval ? ` · ${interval}` : ""}` : "", color: alpha(p.ink, 0.035), fontSize: (el.current?.clientWidth ?? 800) < 560 ? 36 : 64, fontFamily: fontVar("--font-inter", "sans-serif") }],
    });
  }, [theme, compact, style, title, interval]);

  // Data.
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const p = readPalette(el.current);
    const shift = tzShift();
    const conv = (v: number) => unitPrice(v, unit, buE6) * scale;
    const prices = candles.flatMap((c) => [conv(c.low), conv(c.high)]).concat(candles.filter((c) => c.floor !== null).map((c) => conv(c.floor!)));
    const priceFormat = {
      type: "custom" as const,
      minMove: minMoveFor(prices),
      formatter: (v: number) => (v < 0 ? "" : axisPrice(v, unit)),
      tickmarksFormatter: (vs: number[]) => axisPrices(vs, unit),
    };
    a.candle.applyOptions({ priceFormat });
    a.line.applyOptions({ priceFormat });
    a.floor.applyOptions({ priceFormat });
    const log = logScale ?? autoLogScale(candles);
    // Log scale puts the top tick right at the edge; give it and the "Graduated" marker more headroom.
    const margins = compact ? { top: 0.12, bottom: 0.04 } : style === "candles" ? { top: log ? 0.18 : 0.16, bottom: 0.22 } : { top: log ? 0.18 : 0.14, bottom: 0.06 };
    a.chart.priceScale("right").applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal, scaleMargins: margins });

    a.candle.setData(candles.map((c) => ({ time: (c.time + shift) as UTCTimestamp, open: conv(c.open), high: conv(c.high), low: conv(c.low), close: conv(c.close) })));
    a.line.setData(candles.map((c) => ({ time: (c.time + shift) as UTCTimestamp, value: conv(c.close) })));
    // The line is green when the price is up over the range shown, red when it is down.
    const lineCol = candles.length > 1 && candles.at(-1)!.close < candles[0]!.open ? p.down : p.upLine;
    a.line.applyOptions({ color: lineCol, priceLineColor: lineCol, crosshairMarkerBackgroundColor: lineCol });
    a.floor.setData(candles.map((c) => (c.floor === null ? { time: (c.time + shift) as UTCTimestamp } : { time: (c.time + shift) as UTCTimestamp, value: conv(c.floor) })));
    a.vol.setData(
      compact
        ? []
        : candles.map((c) => ({
            time: (c.time + shift) as UTCTimestamp,
            value: unit === "usd" ? buFloatUsd(c.volume, buE6) : c.volume,
            color: c.buyVolume >= c.volume - c.buyVolume ? alpha(p.upLine, 0.28) : alpha(p.down, 0.28),
          })),
    );
    const ms: SeriesMarker<Time>[] = markers
      .filter((m) => byTime.has(m.time + shift))
      .map((m) =>
        m.kind === "burn"
          ? { time: (m.time + shift) as UTCTimestamp, position: "aboveBar", shape: "circle", color: p.ink2, size: 0.5 }
          : m.kind === "graduate"
            ? { time: (m.time + shift) as UTCTimestamp, position: "aboveBar", shape: "arrowDown", color: p.ink2, text: "Graduated" }
            : { time: (m.time + shift) as UTCTimestamp, position: "aboveBar", shape: "arrowDown", color: p.ink2, text: "Launch" },
      );
    a.marks.setMarkers(ms);

    // Keep bars a readable width: show the last ~120 bars, and pad short histories to the right edge.
    const key = `${candles.length ? candles[0]!.time : 0}:${candles.length > 1 ? candles[1]!.time - candles[0]!.time : 0}:${unit}:${style}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      autoRange.current = true;
      const n = candles.length;
      // A short history fills the width: at least 12 bar slots for candles (so four bars do not turn
      // into slabs), none extra for the line; a long one shows its latest 120 bars.
      const minSlots = style === "candles" ? 12 : 2;
      range.current =
        n === 0
          ? null
          : style === "line" && n < 24
            ? // A short line runs edge to edge, with a small margin so its end markers stay inside.
              { from: -0.2, to: n - 1 + (compact ? 0.2 : 0.35) }
            : { from: n <= 120 ? Math.min(-0.5, n - minSlots) : n - 120, to: n - 0.5 + (compact ? 0.5 : Math.max(1, n * 0.04)) };
      const r = range.current;
      if (r) {
        a.chart.timeScale().setVisibleLogicalRange(r);
        const raf = requestAnimationFrame(() => api.current === a && autoRange.current && a.chart.timeScale().setVisibleLogicalRange(r));
        rafs.current.push(raf);
      }
    }
  }, [candles, unit, buE6, logScale, markers, compact, theme, byTime, style, scale]);

  const shown = hover ?? (candles.length ? { c: candles.at(-1)!, prev: candles.at(-2) ?? null } : null);
  const chg = shown ? (shown.c.close / shown.c.open - 1) * 100 : null;
  const fmt = (v: number) => fmtUnit(unitPrice(v, unit, buE6) * scale, unit, { suffix: false });

  return (
    <div className={cx("relative bg-pane", className)}>
      <div ref={el} className="absolute inset-0" data-testid="price-chart" />
      {!compact && shown && (
        <div
          className="pointer-events-none absolute left-3 top-2 z-[2] flex max-w-[calc(100%-6.5rem)] flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs leading-5"
          aria-live="off"
          data-testid="chart-legend"
        >
          {title && (
            <span className="text-[14px] font-bold leading-5 text-ink">
              {title}
              {interval && <span className="ml-1.5 font-sans text-xs font-semibold text-muted">{interval}</span>}
            </span>
          )}
          {style === "candles" ? (
            <>
              <span className="text-muted max-sm:hidden">Price</span>
              <LegendItem k="O" v={fmt(shown.c.open)} tone={chg} className="max-sm:hidden" />
              <LegendItem k="H" v={fmt(shown.c.high)} tone={chg} className="max-sm:hidden" />
              <LegendItem k="L" v={fmt(shown.c.low)} tone={chg} className="max-sm:hidden" />
              <LegendItem k="C" v={fmt(shown.c.close)} tone={chg} />
              {chg !== null && <span className={cx("num font-semibold", chg < 0 ? "text-down" : chg > 0 ? "text-up" : "text-muted")}>{pctText(chg, 2)}</span>}
            </>
          ) : (
            <LegendItem k="Price" v={fmt(shown.c.close)} />
          )}
          {shown.c.floor !== null && <LegendItem k="Floor" v={fmt(shown.c.floor)} floor />}
          {style === "candles" && <LegendItem k="Vol" v={unit === "usd" ? usd(buFloatUsd(shown.c.volume, buE6)) : `${fmtQty(shown.c.volume)} BU`} className="max-sm:hidden" />}
          {unit === "bu" && <span className="text-muted">BU per token</span>}
          {scale > 1 && <span className="text-muted">{per.label}</span>}
        </div>
      )}
      {compact && scale > 1 && candles.length > 0 && (
        <span className="pointer-events-none absolute right-2 top-1.5 z-[2] rounded-full bg-pane/90 px-1.5 text-[11px] font-semibold text-muted">{per.label}</span>
      )}
      {candles.length === 0 && empty && <div className="absolute inset-0 z-[2] flex items-center justify-center bg-pane/85">{empty}</div>}
    </div>
  );
}

function LegendItem({ k, v, floor, tone, className }: { k: string; v: string; floor?: boolean; tone?: number | null; className?: string }) {
  return (
    <span className={cx("inline-flex items-baseline gap-1 whitespace-nowrap", className)}>
      {floor && <span aria-hidden className="size-2 self-center rounded-[2px] bg-floor" />}
      <span className="text-muted">{k}</span>
      <span className={cx("num font-semibold", floor ? "text-floor-text" : tone === undefined || tone === null || tone === 0 ? "text-ink" : tone < 0 ? "text-down" : "text-up")}>{v}</span>
    </span>
  );
}

/** Lightweight Charts' licence asks for attribution; this is it, under the plot rather than on it. */
export function TradingViewCredit({ className }: { className?: string }) {
  return (
    <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className={cx("link", className)}>
      Chart by TradingView
    </a>
  );
}
