export type VerdictStamp = "SHIP" | "FIX" | "BLOCK";
// Display: SHIP → "No cited exceptions"
//          FIX  → "Cited exceptions"
//          BLOCK → "High-certainty exception"

export type FindingKind =
  | "scope_drift"
  | "invented_surface"
  | "looks_right_logic"
  | "visual_contradiction"
  | "secret";

export type Severity = "high" | "medium"; // no "blocker" except secret, which the gate treats as high-certainty

export type RunSource = "live" | "fixture" | "replay";

export interface Coverage {
  source: RunSource;
  snapshot: "full" | "patch-only" | "failed";
  parser: "tree-sitter" | "regex" | "none";
  graphFilesKept: number;
  graphFileCap: 40;
  hops: 1 | 2;
  tavily: "ok" | "failed" | "skipped";
  vision: "ok" | "skipped" | "failed";
  review: "ok" | "failed" | "skipped";
  budgetCapped: boolean;
  timedOut: boolean;
  packTruncated: boolean;
}

export interface Evidence {
  kind: "file" | "tavily" | "screenshot" | "graph";
  path?: string;
  startLine?: number;
  endLine?: number;
  url?: string;
  quote: string; // ≤ 240 chars
  nodeId?: string;
  tavilyHits?: number; // required when kind === "tavily"
}

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  confidence: number; // model self-report, uncalibrated; used only to skip/keep Ultra
  title: string;
  body: string;
  evidence: Evidence[];
  model: string;
  cited: true;
}

export interface TokenLine {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  usdEstimate: number; // display rates
  skipped: boolean;
  reason?: string;
}

export interface Verdict {
  stamp: VerdictStamp;
  displayStamp: string;
  findings: Finding[];
  residualNotes: string[]; // SHIP only; includes coverage caveats
  coverage: Coverage;
  ledger: TokenLine[];
  usdEstimateTotal: number;
}

export type FixtureId = "fixture-ship" | "fixture-fix" | "fixture-block";
export type ProgressStep =
  | "Fetch"
  | "Snapshot"
  | "Graph"
  | "Pack"
  | "Triage"
  | "Tavily"
  | "Vision"
  | "Gate"
  | "Review";

export const DESK_STEPS: ProgressStep[] = [
  "Fetch",
  "Snapshot",
  "Graph",
  "Pack",
  "Triage",
  "Tavily",
  "Vision",
  "Gate",
  "Review",
];

export interface NeighborhoodNode {
  id: string;
  path: string;
  label: string;
  changed: boolean;
}

export interface NeighborhoodEdge {
  from: string;
  to: string;
  kind: "import" | "reference";
}

export interface Neighborhood {
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
}

export interface ChangedFile {
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

export type ReviewCommentSeverity = "issue" | "suggestion" | "nit";

export interface ReviewComment {
  id: string;
  path: string;
  startLine: number;
  endLine?: number;
  title: string;
  body: string;
  severity: ReviewCommentSeverity;
  quote: string;
}

export interface SuggestedDiff {
  id: string;
  path: string;
  title: string;
  unifiedDiff: string;
}

export interface UserFlowNode {
  id: string;
  label: string;
  kind: "actor" | "action";
}

export interface UserFlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface UserFlow {
  nodes: UserFlowNode[];
  edges: UserFlowEdge[];
}

export interface FileLayer {
  name: string;
  paths: string[];
  why: string;
}

export interface Walkthrough {
  summary: string[];
  userFlow: UserFlow;
  fileLayers: FileLayer[];
  comments: ReviewComment[];
  suggestions: SuggestedDiff[];
}

export interface RunHeadline {
  title: string;
  subtitle: string;
  githubUrl?: string;
}

export interface OrientationMap {
  size: {
    linesAdded: number;
    linesRemoved: number;
    fileCount: number;
    languages: Record<string, number>;
    concernCount: number;
  };
  startHere: Array<{ path: string; symbol: string; why: string }>;
  concerns: Array<{ name: string; paths: string[] }>;
  functions: Array<{ name: string; path: string; job: string }>;
  mermaid: string;
  mermaidCaption: string;
  neighborhood?: Neighborhood;
  changedFiles?: ChangedFile[];
  blastRadius: {
    neighborsNotInDiff: string[];
    testsAdded: string[];
    testsMissing: string[];
    envKeys: string[];
  };
  multipleJobs: boolean;
}

export interface RepoGraph {
  nodes: Array<{
    id: string;
    path: string;
    kind: "file" | "symbol";
    label: string;
    changed: boolean;
  }>;
  edges: Array<{ from: string; to: string; kind: "import" | "reference" }>;
  parser: Coverage["parser"];
  hops: 1 | 2;
  filesKept: string[];
}

export interface ContextPack {
  issue: string;
  patch: string;
  repoMap: string;
  neighbors: string;
  tavily: string;
  truncated: boolean;
  approxTokens: {
    issue: number;
    patch: number;
    repoMap: number;
    neighbors: number;
    tavily: number;
  };
}

export type RunStatus = "queued" | "running" | "done" | "error";

export interface Run {
  id: string;
  status: RunStatus;
  source: RunSource;
  coverage: Coverage;
  map?: OrientationMap;
  walkthrough?: Walkthrough;
  verdict?: Verdict;
  ledger: TokenLine[];
  headline?: RunHeadline;
  error?: { code: string; message: string };
  modelParseFailed?: boolean;
  createdAt: number;
}

export type RunRequest =
  | { kind: "fixture"; fixtureId: FixtureId }
  | { kind: "pr"; prUrl: string }
  | { kind: "paste"; issue: string; diff: string; imageUrls?: string[] };
