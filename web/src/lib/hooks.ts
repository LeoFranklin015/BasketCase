"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

export type Async<T> = { data: T | undefined; error: Error | undefined; loading: boolean; refresh: () => void };

/** Run `fn` on mount and every `intervalMs` (0 = once). Keeps the last good data on errors. */
export function usePoll<T>(fn: () => Promise<T>, deps: unknown[], intervalMs = 0): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    const run = () =>
      fnRef
        .current()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(undefined);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e : new Error(String(e))))
        .finally(() => alive && setLoading(false));
    void run();
    const timer = intervalMs > 0 ? setInterval(run, intervalMs) : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, intervalMs]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, refresh };
}

/** Current time, updated every `ms`. Starts at 0 on the server so markup matches before hydration. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Debounce a value for quotes while typing. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Width of an element in CSS px (ResizeObserver), so SVG text renders at its real size. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Whether a media query matches. False on the server and during hydration, then live. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
