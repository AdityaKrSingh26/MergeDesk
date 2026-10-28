import { ADVISORY_CHECK_NAME, tavilyHitsLabel } from "@/server/shared";
import { displayStamp } from "@/server/shared";
import { mermaidFromUserFlow } from "@/server/graph/mermaid";
import type { Coverage, Finding, OrientationMap, Run } from "@/server/shared";

export type AdvisoryCheck = {
  name: "MergeDesk (advisory)";
  conclusion: "neutral";
  output: { title: string; summary: string };
};

function coverageChips(coverage: Coverage): string {
  const chips = [
    `snapshot: ${coverage.snapshot}`,
    `parser: ${coverage.parser}`,
    `${coverage.graphFilesKept}/${coverage.graphFileCap}`,
    `hops: ${coverage.hops}`,
    `tavily: ${coverage.tavily}`,
    `vision: ${coverage.vision}`,
    `review: ${coverage.review ?? "skipped"}`,
  ];
  if (coverage.budgetCapped) chips.push("budget_capped");
  if (coverage.timedOut) chips.push("timed_out");
  return chips.join(" · ");
}

function shortNeighborhood(map: OrientationMap): string {
  const nodes: string[] = [];
  for (const match of map.mermaid.matchAll(/([^\s["]+)\s*-->\s*([^\s[]+)/g)) {
    for (const id of [match[1], match[2]]) {
      if (id && !nodes.includes(id)) nodes.push(id);
    }
    if (nodes.length >= 3) break;
  }
  if (nodes.length >= 2) return nodes.slice(0, 3).join(" → ");
  const files = map.startHere.map((item) => item.path.split("/").pop() ?? item.path);
  return files.slice(0, 3).join(" → ") || "—";
}

function topFindingLine(finding: Finding): string {
  const tavilyEv = finding.evidence.find((item) => item.kind === "tavily");
  if (tavilyEv) {
    const label = tavilyHitsLabel(tavilyEv.tavilyHits ?? 0);
    return finding.title ? `${finding.title} — ${label}` : label;
  }
  const ev = finding.evidence[0];
  if (!ev) return finding.title;
  const loc = [ev.path, ev.startLine].filter((part) => part !== undefined).join(":");
  const bit = loc || ev.quote;
  return bit ? `${finding.title} — ${bit}` : finding.title;
}

function stampLabel(run: Run): string {
  return run.verdict ? displayStamp(run.verdict.stamp) : "pending";
}

export function advisoryComment(run: Run, origin: string): string {
  const lines = [
    `${ADVISORY_CHECK_NAME} · ${stampLabel(run)}`,
    `This is not a merge gate. Coverage: ${coverageChips(run.coverage)}`,
    "",
  ];
  const map = run.map;
  if (map) {
    const n = map.size.linesAdded + map.size.linesRemoved;
    lines.push(`Size: ${n} lines · ${map.size.fileCount} files · ${map.size.concernCount} concerns`);
    lines.push(`Import neighborhood: ${shortNeighborhood(map)}`);
    lines.push("");
    if (map.startHere.length > 0) {
      lines.push("Start here");
      map.startHere.forEach((item, index) => {
        lines.push(`${index + 1}. ${item.path}  ${item.symbol}`);
      });
      lines.push("");
    }
  }
  const walk = run.walkthrough;
  if (walk && walk.summary.length > 0) {
    lines.push("Summary");
    for (const bullet of walk.summary) lines.push(`- ${bullet}`);
    lines.push("");
    if (walk.userFlow.nodes.length > 0) {
      lines.push("```mermaid");
      lines.push(mermaidFromUserFlow(walk.userFlow));
      lines.push("```");
      lines.push("");
    }
  }
  const top = run.verdict?.findings[0];
  if (top) {
    lines.push(topFindingLine(top));
    lines.push("");
  }
  const base = origin.replace(/\/$/, "");
  lines.push(`Full map: ${base}/r/${run.id}`);
  return lines.join("\n");
}

export function advisoryCheck(run: Run): AdvisoryCheck {
  const stamp = stampLabel(run);
  return {
    name: ADVISORY_CHECK_NAME,
    conclusion: "neutral",
    output: {
      title: `${ADVISORY_CHECK_NAME} · ${stamp}`,
      summary: "This is not a merge gate.",
    },
  };
}
