import type { UserFlow, UserFlowNode } from "@/server/shared";

export type FlowBeat = {
  fromId: string;
  fromLabel: string;
  fromKind: UserFlowNode["kind"];
  toId: string;
  toLabel: string;
  toKind: UserFlowNode["kind"];
  label: string;
};

export type FlowSlip = {
  roles: Array<{ id: string; label: string }>;
  beats: FlowBeat[];
};

export function beatsFromUserFlow(flow: UserFlow): FlowSlip {
  const byId = new Map(flow.nodes.map((node) => [node.id, node]));
  const beats: FlowBeat[] = [];
  const onABeat = new Set<string>();
  for (const edge of flow.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const verb = edge.label?.trim() ?? "";
    beats.push({
      fromId: from.id,
      fromLabel: from.label,
      fromKind: from.kind,
      toId: to.id,
      toLabel: to.label,
      toKind: to.kind,
      label: verb.length > 0 ? verb : "then",
    });
    onABeat.add(from.id);
    onABeat.add(to.id);
  }
  const roles = flow.nodes
    .filter((node) => node.kind === "actor" && !onABeat.has(node.id))
    .map((node) => ({ id: node.id, label: node.label }));
  return { roles, beats };
}
