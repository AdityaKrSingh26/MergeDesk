"use client";

import type { JSX } from "react";
import { WALKTHROUGH_PENDING, WALKTHROUGH_UNAVAILABLE, type Run } from "@/server/shared";
import { UserFlowCanvas } from "./UserFlowCanvas";

function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function pathLines(path: string): { primary: string; secondary?: string } {
  const base = fileName(path);
  if (path === base || path.length <= 42) return { primary: path };
  return { primary: base, secondary: path };
}

export function WalkthroughPanel({
  run,
  onSelectPath,
}: {
  run: Run;
  onSelectPath: (path: string | null) => void;
}): JSX.Element {
  const walk = run.walkthrough;
  if (!walk) {
    const pending = run.status !== "done" && run.status !== "error";
    return (
      <section aria-labelledby="walkthrough-heading" className="flex flex-col gap-3">
        <h2 id="walkthrough-heading" className="text-lg font-semibold">
          Walkthrough
        </h2>
        <p className="text-sm text-[var(--desk-muted)]">
          {pending ? WALKTHROUGH_PENDING : WALKTHROUGH_UNAVAILABLE}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="walkthrough-heading" className="flex flex-col gap-5">
      <h2 id="walkthrough-heading" className="text-lg font-semibold">
        Walkthrough
      </h2>
      <ol className="flex max-w-[42rem] flex-col gap-2.5">
        {walk.summary.map((line, index) => (
          <li
            key={`${index}-${line}`}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 text-sm leading-relaxed"
          >
            <span className="font-mono text-xs tabular-nums text-[var(--desk-brass)]" aria-hidden="true">
              {index + 1}
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
      <UserFlowCanvas flow={walk.userFlow} />
      {walk.fileLayers.length > 0 ? (
        <div>
          <h3 className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--desk-muted)]">
            Files by job
          </h3>
          <ol className="mt-3 flex max-w-[42rem] flex-col gap-4">
            {walk.fileLayers.map((layer) => (
              <li key={layer.name}>
                <p className="text-sm font-medium">{layer.name}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--desk-muted)]">{layer.why}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {layer.paths.map((path) => {
                    const lines = pathLines(path);
                    return (
                      <li key={path}>
                        <button
                          type="button"
                          aria-label={path}
                          title={path}
                          className="max-w-full border border-[var(--desk-rule)] bg-[var(--desk-chip)] px-2 py-1 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--desk-forest)]"
                          onClick={() => onSelectPath(path)}
                        >
                          <span className="block font-mono text-xs text-[var(--desk-brass)]">{lines.primary}</span>
                          {lines.secondary ? (
                            <span className="mt-0.5 block max-w-[36ch] break-all font-mono text-[10px] leading-snug text-[var(--desk-muted)]">
                              {lines.secondary}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
