import type { RepoGraph, UserFlow } from "@/server/shared";

export function graphNodeLabel(path: string, label: string): string {
  const parts = path.split("/").filter(Boolean);
  const text = parts.length >= 2 ? parts.slice(-2).join("/") : label;
  return text.replace(/"/g, "'");
}

export function mermaidFromGraph(graph: RepoGraph): string {
  const lines: string[] = ["graph TD"];
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path));
  for (const n of nodes) {
    lines.push(`  ${n.id}["${graphNodeLabel(n.path, n.label)}"]`);
  }
  const edges = [...graph.edges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  for (const e of edges) {
    lines.push(`  ${e.from} --> ${e.to}`);
  }
  for (const n of nodes) {
    const fill = n.changed ? "#fde68a" : "#e0e7ff";
    lines.push(`  style ${n.id} fill:${fill}`);
  }
  return lines.join("\n");
}

function flowId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned.length > 0 ? cleaned : "n";
}

export function mermaidFromUserFlow(flow: UserFlow): string {
  const lines: string[] = ["flowchart LR"];
  for (const node of flow.nodes) {
    const label = node.label.replace(/"/g, "'");
    lines.push(`  ${flowId(node.id)}["${label}"]`);
  }
  for (const edge of flow.edges) {
    const label = edge.label ? `|${edge.label.replace(/\|/g, " ")}|` : "";
    lines.push(`  ${flowId(edge.from)} -->${label} ${flowId(edge.to)}`);
  }
  return lines.join("\n");
}
