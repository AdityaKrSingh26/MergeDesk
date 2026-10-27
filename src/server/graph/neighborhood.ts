import type { Neighborhood, RepoGraph } from "@/server/shared";
import { graphNodeLabel } from "./mermaid";

export function neighborhoodFromGraph(graph: RepoGraph): Neighborhood {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path));
  const edges = [...graph.edges].sort(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      path: n.path,
      label: graphNodeLabel(n.path, n.label),
      changed: n.changed,
    })),
    edges: edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind })),
  };
}
