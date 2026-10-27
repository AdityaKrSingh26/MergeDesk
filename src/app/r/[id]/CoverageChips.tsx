import type { Coverage } from "@/server/shared";

export function CoverageChips({
  coverage,
  modelParseFailed,
}: {
  coverage: Coverage;
  modelParseFailed?: boolean;
}) {
  const chips = [
    `snapshot: ${coverage.snapshot}`,
    `parser: ${coverage.parser}`,
    `${coverage.graphFilesKept}/${coverage.graphFileCap}`,
    `hops: ${coverage.hops}`,
    `tavily: ${coverage.tavily}`,
    `vision: ${coverage.vision}`,
  ];
  if (coverage.budgetCapped) chips.push("budget_capped");
  if (coverage.timedOut) chips.push("timed_out");
  if (coverage.packTruncated) chips.push("pack_truncated");
  if (modelParseFailed) chips.push("model_parse_failed");

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Coverage">
      {chips.map((chip) => (
        <li
          key={chip}
          className="border border-[var(--desk-rule)] bg-[var(--desk-chip)] px-2 py-1 font-mono text-xs"
        >
          {chip}
        </li>
      ))}
    </ul>
  );
}
