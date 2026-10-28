"use client";

import { useState, type JSX } from "react";
import type { Run } from "@/server/shared";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ReviewPanel({
  run,
  onSelectPath,
}: {
  run: Run;
  onSelectPath: (path: string | null) => void;
}): JSX.Element {
  const walk = run.walkthrough;
  const [copied, setCopied] = useState<string | null>(null);
  if (!walk || (walk.comments.length === 0 && walk.suggestions.length === 0)) {
    return (
      <section aria-labelledby="review-heading" className="flex flex-col gap-3">
        <h2 id="review-heading" className="text-lg font-semibold">
          Review
        </h2>
        <p className="text-sm text-[var(--desk-muted)]">No review comments in this run.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-4">
      <h2 id="review-heading" className="text-lg font-semibold">
        Review
      </h2>
      {walk.comments.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {walk.comments.map((comment) => (
            <li key={comment.id} className="desk-ticket p-3">
              <button
                type="button"
                className="font-mono text-xs text-[var(--desk-brass)]"
                onClick={() => onSelectPath(comment.path)}
              >
                {comment.path}:{comment.startLine}
              </button>
              <p className="mt-1 text-sm font-medium">{comment.title}</p>
              <p className="mt-1 text-sm text-[var(--desk-muted)]">{comment.body}</p>
              {comment.quote ? (
                <p className="mt-2 font-mono text-xs">{comment.quote}</p>
              ) : null}
              <p className="mt-1 text-xs uppercase tracking-wide text-[var(--desk-muted)]">{comment.severity}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {walk.suggestions.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Suggested diffs">
          {walk.suggestions.map((item) => (
            <li key={item.id} className="desk-ticket p-3">
              <p className="text-sm font-medium">{item.title}</p>
              <button
                type="button"
                className="mt-1 font-mono text-xs text-[var(--desk-brass)]"
                onClick={() => onSelectPath(item.path)}
              >
                {item.path}
              </button>
              <pre className="mt-2 overflow-x-auto font-mono text-xs">{item.unifiedDiff}</pre>
              <button
                type="button"
                className="mt-2 border border-[var(--desk-rule)] px-2 py-1 text-xs"
                onClick={() => {
                  void copyText(item.unifiedDiff).then((ok) => {
                    if (ok) setCopied(item.id);
                  });
                }}
              >
                {copied === item.id ? "Copied" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
