"use client";

import { useMemo, type JSX, type KeyboardEvent } from "react";
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
import { resolveNeighborhood } from "@/server/shared";
import type { Neighborhood, OrientationMap } from "@/server/shared";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;

type FileNodeData = {
  filename: string;
  path: string;
  parent: string;
  changed: boolean;
  hasFinding: boolean;
  rank: number | null;
  onSelect: (path: string | null) => void;
};

type FileFlowNode = Node<FileNodeData, "file">;

export function layoutNeighborhood(nb: Neighborhood): { id: string; x: number; y: number }[] {
  if (nb.edges.length === 0) {
    return nb.nodes.map((n, i) => ({
      id: n.id,
      x: (i % 4) * 180,
      y: Math.floor(i / 4) * 72,
    }));
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 72 });
  for (const n of nb.nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of nb.edges) {
    g.setEdge(e.from, e.to);
  }
  dagre.layout(g);
  return nb.nodes.map((n) => {
    const pos = g.node(n.id);
    return { id: n.id, x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  });
}

function fileParts(path: string): { filename: string; parent: string } {
  const segs = path.split("/").filter((part) => part.length > 0);
  const filename = segs[segs.length - 1] ?? path;
  const parent = segs.length > 1 ? segs[segs.length - 2]! : ".";
  return { filename, parent };
}

function FileNode({ data, selected }: NodeProps<FileFlowNode>) {
  const border = selected
    ? "var(--desk-forest)"
    : data.changed
      ? "var(--desk-brass)"
      : "var(--desk-rule)";
  const fill = data.changed ? "var(--desk-chip)" : "var(--desk-ticket)";
  const select = () => data.onSelect(data.path);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  };

  return (
    <div className="relative h-full w-full">
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <button
        type="button"
        aria-pressed={selected === true}
        aria-label={data.filename}
        className="relative flex h-full w-full flex-col justify-center px-2.5 text-left"
        style={{
          background: fill,
          border: `1px solid ${border}`,
          color: "var(--foreground)",
        }}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        {data.rank != null ? (
          <span
            className="absolute font-mono text-[10px] font-semibold"
            style={{ top: 4, left: 6, color: "var(--desk-brass)" }}
          >
            {data.rank}
          </span>
        ) : null}
        {data.hasFinding ? (
          <span
            aria-hidden="true"
            className="absolute"
            style={{
              top: 6,
              right: 6,
              width: 7,
              height: 7,
              background: "var(--desk-wax)",
            }}
          />
        ) : null}
        <span className="truncate font-mono text-xs leading-4">{data.filename}</span>
        <span className="truncate text-[10px] leading-4 text-[var(--desk-muted)]">{data.parent}</span>
      </button>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const nodeTypes = { file: FileNode };

function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const btn =
    "border border-[var(--desk-rule)] bg-[var(--desk-paper)] px-2 py-1 text-xs text-[var(--foreground)]";
  return (
    <div className="absolute top-2 right-2 z-10 flex gap-1">
      <button type="button" className={btn} onClick={() => void zoomIn()}>
        Zoom in
      </button>
      <button type="button" className={btn} onClick={() => void zoomOut()}>
        Zoom out
      </button>
      <button type="button" className={btn} onClick={() => void fitView()}>
        Fit neighborhood
      </button>
    </div>
  );
}

function NeighborhoodFlow({
  map,
  selectedPath,
  onSelectPath,
  findingPaths,
  startHerePaths,
}: {
  map: OrientationMap;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  findingPaths: Set<string>;
  startHerePaths: string[];
}) {
  const nb = resolveNeighborhood(map);
  const positions = useMemo(() => layoutNeighborhood(nb), [nb]);
  const posById = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  const nodes: FileFlowNode[] = nb.nodes.map((n) => {
    const { filename, parent } = fileParts(n.path);
    const rankIdx = startHerePaths.indexOf(n.path);
    const pos = posById.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      type: "file",
      position: { x: pos.x, y: pos.y },
      selected: selectedPath === n.path,
      draggable: false,
      data: {
        filename,
        path: n.path,
        parent,
        changed: n.changed,
        hasFinding: findingPaths.has(n.path),
        rank: rankIdx >= 0 && rankIdx < 3 ? rankIdx + 1 : null,
        onSelect: onSelectPath,
      },
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    };
  });

  const edges: Edge[] = nb.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    style: { stroke: "var(--desk-rule)" },
  }));

  return (
    <>
      <ZoomControls />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        minZoom={0.35}
        maxZoom={1.8}
        onNodeClick={(_e, node) => onSelectPath(node.data.path)}
        onPaneClick={() => onSelectPath(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--desk-rule)" gap={20} />
      </ReactFlow>
    </>
  );
}

export function NeighborhoodCanvas(props: {
  runId: string;
  map: OrientationMap;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  findingPaths: Set<string>;
  startHerePaths: string[];
}): JSX.Element {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") props.onSelectPath(null);
  };

  return (
    <div
      role="region"
      aria-label="PR import neighborhood"
      data-run-id={props.runId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="desk-grid relative h-[420px] border border-[var(--desk-rule)]"
    >
      <ReactFlowProvider key={props.runId}>
        <NeighborhoodFlow {...props} />
      </ReactFlowProvider>
    </div>
  );
}
