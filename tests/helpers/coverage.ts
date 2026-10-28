import type { Coverage } from "@/server/shared";

export function makeCoverage(partial: Partial<Coverage> = {}): Coverage {
  return {
    source: "fixture",
    snapshot: "full",
    parser: "regex",
    graphFilesKept: 4,
    graphFileCap: 40,
    hops: 1,
    tavily: "skipped",
    vision: "skipped",
    review: "skipped",
    budgetCapped: false,
    timedOut: false,
    packTruncated: false,
    ...partial,
  };
}
