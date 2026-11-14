"use client";

import { useEffect, useState } from "react";
import { THEME_KEY } from "./config";

export type Theme = "dark" | "light";
export { THEME_KEY };

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The active theme, kept in sync with <html data-theme> (other tabs and toggles included). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    setThemeState(current());
    const mo = new MutationObserver(() => setThemeState(current()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const setTheme = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  };
  return [theme, setTheme];
}

/** Resolved colours for canvas charts, which can't read CSS variables. */
export type ChartPalette = { bg: string; panel: string; pane: string; raised: string; gridLine: string; upLine: string; ink: string; ink2: string; muted: string; line: string; line2: string; floor: string; floorDeep: string; up: string; down: string };

export function readPalette(el?: Element | null): ChartPalette {
  const s = getComputedStyle(el ?? document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: v("--bg"),
    panel: v("--panel"),
    pane: v("--pane") || v("--panel"),
    raised: v("--raised") || v("--panel"),
    gridLine: v("--grid-line") || v("--line"),
    upLine: v("--up-line") || v("--up"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    muted: v("--muted"),
    line: v("--line"),
    line2: v("--line-2"),
    floor: v("--floor"),
    floorDeep: v("--floor-deep"),
    up: v("--up"),
    down: v("--down"),
  };
}

/** `#rrggbb` + alpha -> rgba(). */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
