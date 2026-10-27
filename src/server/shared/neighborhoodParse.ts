import type { Neighborhood, OrientationMap } from "./types";

export function neighborhoodFromMermaid(src: string): Neighborhood {
  const changed = new Set<string>();
  for (const match of src.matchAll(/style\s+(\S+)\s+fill:#fde68a/g)) changed.add(match[1]);
  const nodes: Neighborhood["nodes"] = [];
  const seen = new Set<string>();
  for (const match of src.matchAll(/^\s+(\S+)\["([^"]+)"\]/gm)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const label = match[2];
    nodes.push({ id, path: label, label, changed: changed.has(id) });
  }
  const edges: Neighborhood["edges"] = [];
  for (const match of src.matchAll(/^\s+(\S+)\s+-->\s+(\S+)/gm)) {
    edges.push({ from: match[1], to: match[2], kind: "import" });
  }
  return { nodes, edges };
}

export function resolveNeighborhood(
  map: Pick<OrientationMap, "neighborhood" | "mermaid">,
): Neighborhood {
  if (map.neighborhood && map.neighborhood.nodes.length > 0) return map.neighborhood;
  return neighborhoodFromMermaid(map.mermaid ?? "");
}

export function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export function evidencePinsNode(
  evidence: { path?: string; nodeId?: string },
  node: { id: string; path: string },
): boolean {
  if (evidence.nodeId && evidence.nodeId === node.id) return true;
  if (evidence.path && pathsMatch(evidence.path, node.path)) return true;
  return false;
}
