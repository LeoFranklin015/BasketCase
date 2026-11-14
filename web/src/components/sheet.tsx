"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";
import { cx } from "./ui";

/**
 * A bottom sheet for phones. Not a modal <dialog>: wallet sign-in opens its own overlay on top,
 * which a top-layer dialog would make inert. Escape and the scrim close it; focus returns to the opener.
 */
export function Sheet({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="scrim-in absolute inset-0 bg-[var(--scrim)]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "sheet-in relative max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-[var(--radius)] bg-card pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-sheet)] outline-none",
          className,
        )}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-card px-5 pb-2 pt-3">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-2" />
          <h2 className="h2 pt-2">{title}</h2>
          <button type="button" onClick={onClose} className="icon-btn mt-2 size-9" aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
