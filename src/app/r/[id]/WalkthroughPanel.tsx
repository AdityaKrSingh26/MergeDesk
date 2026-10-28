"use client";

import type { JSX } from "react";
import { WALKTHROUGH_PENDING, WALKTHROUGH_UNAVAILABLE, type Run } from "@/server/shared";
import { UserFlowCanvas } from "./UserFlowCanvas";

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
    <section aria-labelledby="walkthrough-heading" className="flex flex-col gap-4">
      <h2 id="walkthrough-heading" className="text-lg font-semibold">
        Walkthrough
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {walk.summary.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <UserFlowCanvas flow={walk.userFlow} />
      {walk.fileLayers.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">File flow</h3>
          <ol className="mt-2 flex flex-col gap-3">
            {walk.fileLayers.map((layer) => (
              <li key={layer.name}>
                <p className="text-sm font-medium">{layer.name}</p>
                <p className="text-xs text-[var(--desk-muted)]">{layer.why}</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {layer.paths.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        className="font-mono text-xs text-[var(--desk-brass)]"
                        onClick={() => onSelectPath(path)}
                      >
                        {path}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
