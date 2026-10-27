"use client";

import type { JSX } from "react";
import { OVERLAY_WORDMARK, type ProgressStep } from "@/server/shared";

export const OVERLAY_MIN_MS = 400;

export function RunOverlay(props: {
  step: ProgressStep;
  detail: string;
  index: number;
  total: number;
  error?: string;
}): JSX.Element {
  const { step, detail, index, total, error } = props;
  return (
    <div className="desk-grid fixed inset-0 z-20 flex items-center justify-center bg-[var(--desk-paper)] px-4">
      <div
        role="status"
        aria-live="polite"
        className="desk-ticket w-full max-w-md p-8 text-center"
      >
        <p className="text-xs font-medium tracking-[0.22em] text-[var(--desk-brass)] uppercase">
          {OVERLAY_WORDMARK}
        </p>
        <p className="mt-4 text-2xl font-semibold">{step}</p>
        {detail ? (
          <p className="mt-2 font-mono text-sm text-[var(--desk-muted)]">{detail}</p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-6 text-sm text-[var(--desk-wax)]">
            {error}
          </p>
        ) : (
          <>
            <div aria-hidden="true" className="mt-6 h-[3px] w-full bg-[var(--desk-rule)]">
              <div
                className="h-[3px] bg-[var(--desk-brass)]"
                style={{ width: `${(index / total) * 100}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-[var(--desk-muted)]">
              {index} of {total}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
