import type { RunSource } from "@/server/shared";

const LABEL: Record<RunSource, "Live" | "Fixture" | "Replay"> = {
  live: "Live",
  fixture: "Fixture",
  replay: "Replay",
};

export function SourceBadge({ source }: { source: RunSource }) {
  return (
    <span className="border border-[var(--desk-rule)] bg-[var(--desk-chip)] px-2 py-1 text-xs font-medium tracking-[0.12em]">
      {LABEL[source]}
    </span>
  );
}
