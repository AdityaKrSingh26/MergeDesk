"use client";

import type { JSX } from "react";
import type { UserFlow, UserFlowNode } from "@/server/shared";
import { beatsFromUserFlow } from "./userFlowBeats";

function SlipChip({ label, kind }: { label: string; kind: UserFlowNode["kind"] }): JSX.Element {
  const actor = kind === "actor";
  return (
    <span
      className="inline-flex max-w-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: actor ? "var(--desk-chip)" : "var(--desk-paper)",
        border: `1px solid ${actor ? "var(--desk-brass)" : "var(--desk-rule)"}`,
        color: "var(--foreground)",
      }}
    >
      {label}
    </span>
  );
}

export function UserFlowCanvas({ flow }: { flow: UserFlow }): JSX.Element {
  if (flow.nodes.length === 0) {
    return <p className="text-sm text-[var(--desk-muted)]">No user-flow nodes in this walkthrough.</p>;
  }
  const slip = beatsFromUserFlow(flow);
  return (
    <div role="region" aria-label="User flow" className="flex max-w-[42rem] flex-col gap-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--desk-muted)]">
        Who does what
      </p>
      {slip.roles.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Roles">
          {slip.roles.map((role) => (
            <li key={role.id}>
              <SlipChip label={role.label} kind="actor" />
            </li>
          ))}
        </ul>
      ) : null}
      {slip.beats.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {slip.beats.map((beat, index) => (
            <li
              key={`${beat.fromId}-${beat.toId}-${index}`}
              className="desk-ticket px-3 py-2.5"
            >
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                <SlipChip label={beat.fromLabel} kind={beat.fromKind} />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="hidden h-px flex-1 sm:block"
                    style={{ background: "color-mix(in oklab, var(--desk-brass) 70%, transparent)" }}
                  />
                  <span className="max-w-[36ch] text-center text-xs leading-snug text-[var(--desk-muted)]">
                    {beat.label}
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden h-px flex-1 sm:block"
                    style={{ background: "color-mix(in oklab, var(--desk-brass) 70%, transparent)" }}
                  />
                </div>
                <SlipChip label={beat.toLabel} kind={beat.toKind} />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
