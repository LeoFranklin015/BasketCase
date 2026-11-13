"use client";

import type { Transaction } from "@backed/client";
import { useCallback, useState } from "react";
import { EXPLORER_TX } from "@/lib/config";
import { useWallet, type SendResult } from "@/lib/wallet";
import { IconCheck, IconExternal } from "./icons";
import { cx } from "./ui";

export type TxState = {
  busy: boolean;
  error?: string;
  result?: SendResult;
  note?: string;
  /** Index of the step being signed (0-based), and how many steps this run has. */
  step?: number;
  total?: number;
  /** Index of the step that failed. */
  failedStep?: number;
};

/**
 * One step of a flow: transactions signed together, or (mainnet 1Click swaps) a custom `run` that
 * signs messages instead of transactions and reports progress through `progress`.
 */
export type TxStep = { title: string; txs: Transaction[]; run?: (progress: (detail: string) => void) => Promise<void> };

/**
 * Send one or more steps in order. Each step is a list of transactions signed together.
 * `onDone` runs after the last step succeeds (e.g. refresh data, record a buy).
 */
export function useTx() {
  const { send } = useWallet();
  const [state, setState] = useState<TxState>({ busy: false });

  const run = useCallback(
    async (steps: TxStep[], onDone?: (r: SendResult) => void) => {
      setState({ busy: true, step: 0, total: steps.length });
      const hashes: string[] = [];
      let last: SendResult | undefined;
      let current = 0;
      try {
        for (const [i, s] of steps.entries()) {
          current = i;
          if (s.txs.length === 0 && !s.run) continue;
          const note = steps.length > 1 ? `Step ${i + 1} of ${steps.length}: ${s.title}` : s.title;
          setState({ busy: true, note, step: i, total: steps.length });
          if (s.run) {
            await s.run((detail) => setState({ busy: true, note: `${note}: ${detail}`, step: i, total: steps.length }));
            continue;
          }
          last = await send(s.txs, note);
          hashes.push(...last.hashes);
        }
        const result = { fixture: last?.fixture ?? false, hashes, outcomes: last?.outcomes ?? [] };
        setState({ busy: false, result, step: steps.length, total: steps.length });
        onDone?.(result);
        return result;
      } catch (e) {
        setState({ busy: false, error: e instanceof Error ? e.message : String(e), failedStep: current, total: steps.length });
        return undefined;
      }
    },
    [send],
  );

  return { ...state, run, reset: () => setState({ busy: false }) };
}

export function TxStatus({ s }: { s: TxState }) {
  if (s.busy) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-ink" />
        {s.note ?? "Waiting for the wallet…"}
      </p>
    );
  }
  if (s.error) {
    return (
      <p role="alert" className="break-words rounded-[14px] bg-down-soft px-3.5 py-2.5 text-sm text-ink">
        <span className="font-semibold text-down">Not sent. </span>
        {s.error}
      </p>
    );
  }
  if (s.result) {
    return (
      <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center gap-1 font-semibold text-up">
          <IconCheck size={14} />
          {s.result.fixture ? "Done (fixture mode: nothing was sent)" : "Confirmed"}
        </span>
        {s.result.hashes.map((h) => (
          <a key={h} href={EXPLORER_TX(h)} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-0.5 text-xs text-muted hover:text-ink">
            {h.slice(0, 8)}
            <IconExternal size={11} />
          </a>
        ))}
      </p>
    );
  }
  return null;
}

/** A numbered list of the transactions a flow will ask the wallet to sign, with live progress. */
export function TxSteps({ steps, s }: { steps: { title: string; detail?: string; skip?: boolean }[]; s: TxState }) {
  return (
    <ol className="space-y-2" aria-label="Transactions to sign">
      {steps.map((st, i) => {
        const done = (s.result && !s.busy) || (s.step !== undefined && s.busy && i < s.step);
        const active = s.busy && s.step === i;
        const failed = !s.busy && s.failedStep === i && !!s.error;
        return (
          <li key={st.title} className={cx("flex gap-2.5 text-sm", st.skip && "opacity-50")}>
            <span
              aria-hidden
              className={cx(
                "num mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                done ? "bg-ink text-card" : active ? "bg-card text-ink ring-2 ring-ink" : failed ? "bg-down text-card" : "bg-sunk text-muted",
              )}
            >
              {done ? <IconCheck size={12} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={cx("block font-semibold", active ? "text-ink" : "text-ink-2")}>
                {st.title}
                {st.skip && <span className="font-normal text-muted"> (not needed)</span>}
                {active && <span className="font-normal text-ink"> · sign in your wallet</span>}
              </span>
              {st.detail && <span className="caption block">{st.detail}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
