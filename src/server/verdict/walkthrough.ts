import { resolveNeighborhood } from "@/server/shared";
import type {
  FileLayer,
  OrientationMap,
  ReviewComment,
  ReviewCommentSeverity,
  SuggestedDiff,
  UserFlow,
  UserFlowEdge,
  UserFlowNode,
  Walkthrough,
} from "@/server/shared";

const COMMENT_CAP = 8;
const SUGGESTION_CAP = 5;
const NIT_CAP = 2;
const SUMMARY_MAX = 6;
const SUMMARY_CHARS = 200;
const LAYER_CAP = 6;
const FLOW_NODE_CAP = 16;
const FLOW_EDGE_CAP = 24;
const QUOTE_CHARS = 240;

const SEVERITIES: ReadonlySet<string> = new Set<ReviewCommentSeverity>([
  "issue",
  "suggestion",
  "nit",
]);

export type GateWalkthroughResult =
  | { ok: true; value: Walkthrough }
  | { ok: false };

export function allowedReviewPaths(map: OrientationMap | undefined): Set<string> {
  const out = new Set<string>();
  if (!map) return out;
  for (const file of map.changedFiles ?? []) out.add(file.path);
  for (const item of map.startHere) out.add(item.path);
  for (const fn of map.functions) out.add(fn.path);
  for (const node of resolveNeighborhood(map).nodes) out.add(node.path);
  for (const path of map.blastRadius.neighborsNotInDiff) out.add(path);
  for (const path of map.blastRadius.testsAdded) out.add(path);
  return out;
}

function pathAllowed(path: string, allowed: Set<string>): boolean {
  if (allowed.has(path)) return true;
  for (const candidate of allowed) {
    if (candidate.endsWith(`/${path}`) || path.endsWith(`/${candidate}`)) return true;
  }
  return false;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function parseSeverity(value: unknown): ReviewCommentSeverity | undefined {
  return typeof value === "string" && SEVERITIES.has(value)
    ? (value as ReviewCommentSeverity)
    : undefined;
}

function parseUserFlow(raw: unknown): UserFlow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { nodes: [], edges: [] };
  }
  const rec = raw as { nodes?: unknown; edges?: unknown };
  const nodes: UserFlowNode[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rec.nodes)) {
    for (const item of rec.nodes) {
      if (nodes.length >= FLOW_NODE_CAP) break;
      if (!item || typeof item !== "object") continue;
      const row = item as { id?: unknown; label?: unknown; kind?: unknown };
      const id = asString(row.id);
      const label = asString(row.label);
      const kind = row.kind === "actor" || row.kind === "action" ? row.kind : undefined;
      if (!id || !label || !kind || seen.has(id)) continue;
      seen.add(id);
      nodes.push({ id, label, kind });
    }
  }
  const edges: UserFlowEdge[] = [];
  if (Array.isArray(rec.edges)) {
    for (const item of rec.edges) {
      if (edges.length >= FLOW_EDGE_CAP) break;
      if (!item || typeof item !== "object") continue;
      const row = item as { from?: unknown; to?: unknown; label?: unknown };
      const from = asString(row.from);
      const to = asString(row.to);
      if (!seen.has(from) || !seen.has(to)) continue;
      const edge: UserFlowEdge = { from, to };
      const label = asString(row.label);
      if (label) edge.label = clip(label, 80);
      edges.push(edge);
    }
  }
  return { nodes, edges };
}

function parseLayers(raw: unknown, allowed: Set<string>): FileLayer[] {
  if (!Array.isArray(raw)) return [];
  const layers: FileLayer[] = [];
  for (const item of raw) {
    if (layers.length >= LAYER_CAP) break;
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; paths?: unknown; why?: unknown };
    const name = asString(row.name);
    const why = asString(row.why);
    if (!name || !why || !Array.isArray(row.paths)) continue;
    const paths = row.paths
      .filter((path): path is string => typeof path === "string" && pathAllowed(path.trim(), allowed))
      .map((path) => path.trim());
    if (paths.length === 0) continue;
    layers.push({ name: clip(name, 80), paths, why: clip(why, 200) });
  }
  return layers;
}

function hasDiffHunk(diff: string): boolean {
  return diff.includes("@@") || diff.includes("+++");
}

export function gateWalkthrough(raw: unknown, allowedPaths: Set<string>): GateWalkthroughResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false };
  const rec = raw as Record<string, unknown>;
  const summary: string[] = [];
  if (Array.isArray(rec.summary)) {
    for (const item of rec.summary) {
      if (summary.length >= SUMMARY_MAX) break;
      const line = clip(asString(item), SUMMARY_CHARS);
      if (line) summary.push(line);
    }
  }
  if (summary.length < 1) return { ok: false };

  const comments: ReviewComment[] = [];
  let nits = 0;
  if (Array.isArray(rec.comments)) {
    for (const item of rec.comments) {
      if (comments.length >= COMMENT_CAP) break;
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const path = asString(row.path);
      const title = asString(row.title);
      const body = asString(row.body);
      const startLine = typeof row.startLine === "number" ? row.startLine : Number(row.startLine);
      const severity = parseSeverity(row.severity);
      if (!path || !title || !body || !severity || !Number.isFinite(startLine) || startLine < 1) continue;
      if (!pathAllowed(path, allowedPaths)) continue;
      if (severity === "nit" && nits >= NIT_CAP) continue;
      if (severity === "nit") nits += 1;
      const comment: ReviewComment = {
        id: `comment-${comments.length}`,
        path,
        startLine: Math.floor(startLine),
        title: clip(title, 120),
        body: clip(body, 800),
        severity,
        quote: clip(asString(row.quote), QUOTE_CHARS),
      };
      if (typeof row.endLine === "number" && row.endLine >= comment.startLine) {
        comment.endLine = Math.floor(row.endLine);
      }
      comments.push(comment);
    }
  }

  const suggestions: SuggestedDiff[] = [];
  if (Array.isArray(rec.suggestions)) {
    for (const item of rec.suggestions) {
      if (suggestions.length >= SUGGESTION_CAP) break;
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const path = asString(row.path);
      const title = asString(row.title);
      const unifiedDiff = asString(row.unifiedDiff);
      if (!path || !title || !hasDiffHunk(unifiedDiff)) continue;
      if (!pathAllowed(path, allowedPaths)) continue;
      suggestions.push({
        id: `suggest-${suggestions.length}`,
        path,
        title: clip(title, 120),
        unifiedDiff: clip(unifiedDiff, 4000),
      });
    }
  }

  return {
    ok: true,
    value: {
      summary,
      userFlow: parseUserFlow(rec.userFlow),
      fileLayers: parseLayers(rec.fileLayers, allowedPaths),
      comments,
      suggestions,
    },
  };
}
