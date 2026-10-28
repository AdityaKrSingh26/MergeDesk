"use client";

import { useMemo, type JSX } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { UserFlow } from "@/server/shared";

const NODE_WIDTH = 150;
const NODE_HEIGHT = 48;

type FlowNodeData = {
  label: string;
  kind: "actor" | "action";
};

type FlowNode = Node<FlowNodeData, "flow">;

export function layoutUserFlow(flow: UserFlow): { id: string; x: number; y: number }[] {
  if (flow.nodes.length === 0) return [];
  if (flow.edges.length === 0) {
    return flow.nodes.map((n, i) => ({
      id: n.id,
      x: (i % 4) * 170,
      y: Math.floor(i / 4) * 64,
    }));
  }
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 72 });
  for (const n of flow.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of flow.edges) {
    g.setEdge(e.from, e.to);
  }
  dagre.layout(g);
  return flow.nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  });
}

function FlowItem({ data }: NodeProps<FlowNode>): JSX.Element {
  const fill = data.kind === "actor" ? "var(--desk-chip)" : "var(--desk-ticket)";
  const border = data.kind === "actor" ? "var(--desk-brass)" : "var(--desk-rule)";
  return (
    <div className="relative h-full w-full">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div
        className="flex h-full w-full items-center justify-center px-2 text-center text-xs"
        style={{ background: fill, border: `1px solid ${border}`, color: "var(--foreground)" }}
      >
        {data.label}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { flow: FlowItem };

function UserFlowInner({ flow }: { flow: UserFlow }): JSX.Element {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const layout = useMemo(() => layoutUserFlow(flow), [flow]);
  const nodes: FlowNode[] = useMemo(
    () =>
      flow.nodes.map((n) => {
        const pos = layout.find((p) => p.id === n.id) ?? { x: 0, y: 0 };
        return {
          id: n.id,
          type: "flow",
          position: { x: pos.x, y: pos.y },
          data: { label: n.label, kind: n.kind },
          draggable: false,
          selectable: false,
        };
      }),
    [flow, layout],
  );
  const edges: Edge[] = useMemo(
    () =>
      flow.edges.map((e, i) => ({
        id: `e-${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        label: e.label,
        selectable: false,
      })),
    [flow],
  );

  return (
    <>
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button type="button" className="border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-2 py-1 text-xs" onClick={() => zoomIn()}>
          Zoom in
        </button>
        <button type="button" className="border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-2 py-1 text-xs" onClick={() => zoomOut()}>
          Zoom out
        </button>
        <button type="button" className="border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-2 py-1 text-xs" onClick={() => fitView({ padding: 0.2 })}>
          Fit flow
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--desk-rule)" gap={20} />
      </ReactFlow>
    </>
  );
}

export function UserFlowCanvas({ flow }: { flow: UserFlow }): JSX.Element {
  if (flow.nodes.length === 0) {
    return <p className="text-sm text-[var(--desk-muted)]">No user-flow nodes in this walkthrough.</p>;
  }
  return (
    <div
      role="region"
      aria-label="User flow"
      className="desk-grid relative h-[240px] border border-[var(--desk-rule)]"
    >
      <ReactFlowProvider>
        <UserFlowInner flow={flow} />
      </ReactFlowProvider>
    </div>
  );
}
