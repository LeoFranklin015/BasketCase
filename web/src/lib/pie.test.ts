import { describe, expect, it } from "vitest";
import { arcs, donutPath, polar } from "./pie";

const TAU = Math.PI * 2;

describe("arcs", () => {
  it("splits the circle by share", () => {
    const a = arcs([1, 1, 2]);
    expect(a[0]).toEqual({ start: 0, end: TAU / 4 });
    expect(a[1]!.start).toBeCloseTo(TAU / 4);
    expect(a[2]!.end).toBeCloseTo(TAU);
  });
  it("leaves a gap between parts but not around a single part", () => {
    const two = arcs([1, 1], 0.1);
    expect(two[0]!.start).toBeCloseTo(0.05);
    expect(two[0]!.end).toBeCloseTo(Math.PI - 0.05);
    expect(arcs([5], 0.1)[0]).toEqual({ start: 0, end: TAU });
  });
  it("gives zero, negative and NaN values an empty arc and keeps the order", () => {
    const a = arcs([0, 3, NaN, -1, 1]);
    expect(a[0]!.end - a[0]!.start).toBe(0);
    expect(a[1]!.end).toBeCloseTo(TAU * 0.75);
    expect(a[2]!.end - a[2]!.start).toBe(0);
    expect(a[3]!.end - a[3]!.start).toBe(0);
    expect(a[4]!.end).toBeCloseTo(TAU);
  });
  it("returns empty arcs when there is nothing to draw", () => {
    expect(arcs([0, 0])).toEqual([
      { start: 0, end: 0 },
      { start: 0, end: 0 },
    ]);
  });
});

describe("donutPath", () => {
  it("starts at twelve o'clock and goes clockwise", () => {
    expect(polar(50, 50, 10, 0)).toEqual([50, 40]);
    const [x, y] = polar(50, 50, 10, Math.PI / 2);
    expect(x).toBeCloseTo(60);
    expect(y).toBeCloseTo(50);
  });
  it("draws a quarter segment with the small-arc flag", () => {
    const d = donutPath(50, 50, 30, 40, 0, Math.PI / 2);
    expect(d.startsWith("M50,10 A40,40 0 0 1 90,50 L80,50 A30,30 0 0 0 50,20 Z")).toBe(true);
  });
  it("uses the large-arc flag past half a turn", () => {
    expect(donutPath(50, 50, 30, 40, 0, Math.PI * 1.5)).toContain("A40,40 0 1 1");
  });
  it("draws a full ring as two halves and nothing for an empty arc", () => {
    const d = donutPath(50, 50, 30, 40, 0, TAU);
    expect(d.match(/A40,40/g)).toHaveLength(2);
    expect(d.match(/A30,30/g)).toHaveLength(2);
    expect(donutPath(50, 50, 30, 40, 1, 1)).toBe("");
  });
});
