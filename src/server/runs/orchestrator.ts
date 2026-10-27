import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractTarball,
  fetchPullRequest,
  fetchTarball,
  findSecrets,
  loadFixture,
  parsePrUrl,
  type ExtractTarballArgs,
  type SnapshotResult,
} from "@/server/ingest";
import { GRAPH_CAPTION, PACK_TRUNCATED_NOTE, tavilyHitsLabel } from "@/server/shared";
import { nanoid } from "./ids";
import { gate, type GateInput } from "@/server/verdict";
import {
  buildGraph,
  changedFilesFromDiff,
  inventedImportNames,
  mermaidFromGraph,
  neighborhoodFromGraph,
  personalize,
} from "@/server/graph";
import {
  createTokenFactoryClient,
  findingFromSuperVl,
  loadLiveModels,
  MODELS,
  packContext,
  runSuper,
  runSuperVl,
  runTriage,
  runUltra,
  searchClaims,
  shouldCallUltra,
  type ChatClient,
  type TavilyClaim,
  type WebEvidence,
} from "@/server/llm";
import { recordLiveSpend } from "./spend";
import { store } from "./store";
import type {
  Coverage,
  Evidence,
  Finding,
  FixtureId,
  OrientationMap,
  ProgressStep,
  RepoGraph,
  Run,
  RunHeadline,
  RunRequest,
  RunSource,
  TokenLine,
} from "@/server/shared";

export interface RunDeps {
  chat?: ChatClient;
  tavilyFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  githubFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  snapshot?: (args: ExtractTarballArgs) => Promise<SnapshotResult>;
}

export interface SseRecord {
  event: string;
  data: unknown;
}

const bus = new EventEmitter();
bus.setMaxListeners(100);

const events = new Map<string, SseRecord[]>();
const inflight = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emit(id: string, event: string, data: unknown): void {
  const rec: SseRecord = { event, data: structuredClone(data) };
  const list = events.get(id) ?? [];
  list.push(rec);
  events.set(id, list);
  bus.emit(id, rec);
}

function emitStep(id: string, name: ProgressStep, detail: string): void {
  emit(id, "step", { name, detail });
}

export function getRunEvents(id: string): SseRecord[] {
  return events.get(id) ?? [];
}

export function subscribeRun(id: string, fn: (rec: SseRecord) => void): () => void {
  bus.on(id, fn);
  return () => {
    bus.off(id, fn);
  };
}

function baseCoverage(source: RunSource): Coverage {
  return {
    source,
    snapshot: "full",
    parser: "none",
    graphFilesKept: 0,
    graphFileCap: 40,
    hops: 1,
    tavily: "skipped",
    vision: "skipped",
    budgetCapped: false,
    timedOut: false,
    packTruncated: false,
  };
}

function patchRun(id: string, patch: Partial<Run>): Run {
  const current = store.get(id);
  const next: Run = {
    id,
    status: patch.status ?? current?.status ?? "queued",
    source: patch.source ?? current?.source ?? "replay",
    coverage: patch.coverage ?? current?.coverage ?? baseCoverage("replay"),
    map: patch.map ?? current?.map,
    verdict: patch.verdict ?? current?.verdict,
    ledger: patch.ledger ?? current?.ledger ?? [],
    headline: patch.headline ?? current?.headline,
    error: patch.error ?? current?.error,
    modelParseFailed: patch.modelParseFailed ?? current?.modelParseFailed,
    createdAt: patch.createdAt ?? current?.createdAt ?? 0,
  };
  store.put(next);
  return next;
}

function failRun(id: string, err: unknown): void {
  const error = {
    code: "run_failed",
    message: err instanceof Error ? err.message : "run failed",
  };
  emit(id, "error", error);
  patchRun(id, { status: "error", error });
}

function failCoded(id: string, code: string, message: string): void {
  const error = { code, message };
  emit(id, "error", error);
  patchRun(id, { status: "error", error });
}

function filesFromPatch(diff: string): Record<string, string> {
  const files: Record<string, string> = {};
  let path = "";
  let lines: string[] = [];
  const flush = () => {
    if (path && path !== "/dev/null") files[path] = lines.join("\n");
  };
  for (const line of diff.split("\n")) {
    const plus = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (plus) {
      flush();
      path = plus[1];
      lines = [];
      continue;
    }
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity ") ||
      line.startsWith("rename ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("--- ") ||
      line.startsWith("@@")
    ) {
      continue;
    }
    if (line.startsWith("+")) lines.push(line.slice(1));
    else if (line.startsWith("-") || line.startsWith("\\")) continue;
    else if (line.startsWith(" ")) lines.push(line.slice(1));
  }
  flush();
  return files;
}

function emitTerminal(
  id: string,
  map: OrientationMap,
  coverage: Coverage,
  verdict: NonNullable<Run["verdict"]>,
  modelParseFailed = false,
): void {
  emit(id, "map", map);
  emit(id, "coverage", coverage);
  emit(id, "verdict", verdict);
  emit(id, "done", { modelParseFailed });
}

function collectFiles(repoRoot: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(ent.name)) continue;
      files[relPath.replaceAll("\\", "/")] = readFileSync(abs, "utf8");
    }
  };
  walk(repoRoot, "");
  return files;
}

interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
  fileCount: number;
  languages: Record<string, number>;
  changedPaths: string[];
}

function languageOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot).toLowerCase();
  if (ext === ".ts" || ext === ".tsx") return "ts";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "js";
  if (ext === ".py") return "py";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rs";
  if (ext === ".md" || ext === ".markdown") return "md";
  if (ext === ".json") return "json";
  return "other";
}

function fileBase(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function usableStartHere(
  raw: Array<{ path: string; symbol: string; why: string }>,
  changedPaths: string[],
): Array<{ path: string; symbol: string; why: string }> {
  const kept = raw.filter((item) => typeof item.path === "string" && item.path.trim().length > 0);
  if (kept.length > 0) return kept;
  const code = changedPaths.filter((p) => /\.(?:go|ts|tsx|js|jsx|mjs|cjs|py|rs)$/i.test(p));
  const seeds = (code.length > 0 ? code : changedPaths).slice(0, 5);
  return seeds.map((path) => ({
    path,
    symbol: fileBase(path),
    why: "changed in this PR",
  }));
}

function diffStats(diff: string): DiffStats {
  let linesAdded = 0;
  let linesRemoved = 0;
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus && plus[1] !== "/dev/null") files.add(plus[1]);
    if (line.startsWith("+") && !line.startsWith("+++")) linesAdded += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) linesRemoved += 1;
  }
  const languages: Record<string, number> = {};
  for (const p of files) {
    const lang = languageOf(p);
    languages[lang] = (languages[lang] ?? 0) + 1;
  }
  return { linesAdded, linesRemoved, fileCount: files.size, languages, changedPaths: [...files] };
}

function blastFromGraph(graph: RepoGraph, changedPaths: string[]): OrientationMap["blastRadius"] {
  const changed = new Set(changedPaths);
  return {
    neighborsNotInDiff: graph.filesKept.filter((p) => !changed.has(p)),
    testsAdded: changedPaths.filter((p) => /test/i.test(p)),
    testsMissing: [],
    envKeys: [],
  };
}

function formatRepoMap(graph: RepoGraph): string {
  const nodes = graph.nodes.map((n) => `${n.path}${n.changed ? " *" : ""}`).join("\n");
  const edges = graph.edges.map((e) => `${e.from} --> ${e.to}`).join("\n");
  return [nodes, edges].filter(Boolean).join("\n");
}

function formatNeighbors(graph: RepoGraph, files: Record<string, string>, changedPaths: string[]): string {
  const changed = new Set(changedPaths);
  const parts: string[] = [];
  for (const path of graph.filesKept) {
    if (changed.has(path)) continue;
    const body = files[path];
    if (body === undefined) continue;
    parts.push(`// ${path}\n${body}`);
  }
  return parts.join("\n\n");
}

function secretFindings(diff: string): Finding[] {
  return findSecrets(diff).map((hit, index) => ({
    id: `secret-${index}`,
    kind: "secret",
    severity: "high",
    confidence: 1,
    title: "Secret in patch",
    body: "Regex detected a secret in added lines.",
    evidence: [
      {
        kind: "file",
        path: hit.path,
        startLine: hit.startLine,
        quote: hit.quote,
      },
    ],
    model: "regex",
    cited: true,
  }));
}

function tavilyToEvidence(item: WebEvidence): Evidence {
  return {
    kind: "tavily",
    quote: item.quote,
    tavilyHits: item.tavilyHits,
    ...(item.url ? { url: item.url } : {}),
  };
}

function coerceEvidence(raw: unknown): Evidence[] {
  if (!Array.isArray(raw)) return [];
  const out: Evidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.kind !== "file" && rec.kind !== "tavily" && rec.kind !== "screenshot" && rec.kind !== "graph") {
      continue;
    }
    const ev: Evidence = {
      kind: rec.kind,
      quote: typeof rec.quote === "string" ? rec.quote : "",
    };
    if (typeof rec.path === "string") ev.path = rec.path;
    if (typeof rec.startLine === "number") ev.startLine = rec.startLine;
    if (typeof rec.endLine === "number") ev.endLine = rec.endLine;
    if (typeof rec.url === "string") ev.url = rec.url;
    if (typeof rec.nodeId === "string") ev.nodeId = rec.nodeId;
    if (typeof rec.tavilyHits === "number") ev.tavilyHits = rec.tavilyHits;
    out.push(ev);
  }
  return out;
}

function modelFindings(
  raw: unknown[],
  tavily: WebEvidence[],
  model: string,
  skipPackages?: ReadonlySet<string>,
): GateInput["rawFindings"] {
  const tavilyEv = tavily.map(tavilyToEvidence);
  const out: GateInput["rawFindings"] = [];
  for (let index = 0; index < raw.length; index++) {
    const item = raw[index];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.kind === "secret") continue;
    if (rec.kind === "invented_surface" && skipPackages && skipPackages.size > 0) {
      const blob = [rec.title, rec.body, JSON.stringify(rec.evidence ?? [])].join("\n");
      let dup = false;
      for (const name of skipPackages) {
        if (!name) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|[^A-Za-z0-9_-])${escaped}(?:$|[^A-Za-z0-9_-])`);
        if (re.test(blob)) {
          dup = true;
          break;
        }
      }
      if (dup) continue;
    }
    const evidence = coerceEvidence(rec.evidence);
    if (rec.kind === "invented_surface" && !evidence.some((e) => e.kind === "tavily")) {
      const zeroHit = tavilyEv.filter((item) => item.tavilyHits === 0);
      if (zeroHit.length > 0) evidence.unshift(...zeroHit);
    }
    out.push({
      id: typeof rec.id === "string" ? rec.id : `m-${index}`,
      kind: typeof rec.kind === "string" ? (rec.kind as Finding["kind"]) : undefined,
      severity: rec.severity === "high" || rec.severity === "medium" ? rec.severity : undefined,
      confidence: typeof rec.confidence === "number" ? rec.confidence : undefined,
      title: typeof rec.title === "string" ? rec.title : undefined,
      body: typeof rec.body === "string" ? rec.body : undefined,
      evidence,
      model,
      cited: true as const,
    });
  }
  return out;
}

function inventedNamesFor(files: Record<string, string>, changedPaths: string[], diff: string): string[] {
  const patchFiles = filesFromPatch(diff);
  const names = new Set<string>([
    ...inventedImportNames(files, changedPaths),
    ...inventedImportNames(patchFiles, Object.keys(patchFiles)),
  ]);
  return [...names].sort();
}

function unionClaims(lightning: TavilyClaim[], invented: string[]): TavilyClaim[] {
  const out: TavilyClaim[] = [];
  const seen = new Set<string>();
  const push = (claim: TavilyClaim) => {
    if (out.length >= 5) return;
    const keys = [claim.packageName, claim.query].filter((key): key is string => Boolean(key));
    if (keys.length === 0 || keys.some((key) => seen.has(key))) return;
    for (const key of keys) seen.add(key);
    out.push(claim);
  };
  for (const claim of lightning) push(claim);
  for (const name of invented) push({ type: "package", query: name, packageName: name });
  return out;
}

function seededInventedFindings(names: string[], evidence: WebEvidence[]): Finding[] {
  const wanted = new Set(names);
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const ev of evidence) {
    if (ev.tavilyHits !== 0) continue;
    if (!wanted.has(ev.query) || seen.has(ev.query)) continue;
    seen.add(ev.query);
    const quote = tavilyHitsLabel(ev.tavilyHits).slice(0, 240);
    findings.push({
      id: `invented-${ev.query}`,
      kind: "invented_surface",
      severity: "high",
      confidence: 1,
      title: `Unknown package ${ev.query}`,
      body: "Bare import; this search returned no documents.",
      evidence: [
        {
          kind: "tavily",
          quote,
          tavilyHits: ev.tavilyHits,
          ...(ev.url ? { url: ev.url } : {}),
        },
      ],
      model: "tavily",
      cited: true,
    });
  }
  return findings;
}

function attachGraphFields(map: OrientationMap, graph: RepoGraph, diff: string): OrientationMap {
  return {
    ...map,
    neighborhood: neighborhoodFromGraph(graph),
    changedFiles: changedFilesFromDiff(diff),
  };
}

function headlineFor(req: RunRequest, source: RunSource): RunHeadline {
  if (req.kind === "fixture") {
    const { meta } = loadFixture(req.fixtureId);
    return { title: meta.title, subtitle: source === "replay" ? "Replay" : "Fixture" };
  }
  if (req.kind === "pr") {
    const parsed = parsePrUrl(req.prUrl);
    if ("error" in parsed) return { title: req.prUrl, subtitle: "Live", githubUrl: req.prUrl };
    return {
      title: req.prUrl,
      subtitle: `${parsed.owner}/${parsed.repo} · #${parsed.number}`,
      githubUrl: req.prUrl,
    };
  }
  return { title: "Pasted diff", subtitle: "Paste" };
}

function localMap(graph: RepoGraph, mermaid: string, stats: DiffStats, diff: string): OrientationMap {
  return attachGraphFields(
    {
      size: {
        linesAdded: stats.linesAdded,
        linesRemoved: stats.linesRemoved,
        fileCount: stats.fileCount,
        languages: stats.languages,
        concernCount: 0,
      },
      startHere: usableStartHere([], stats.changedPaths),
      concerns: [],
      functions: [],
      mermaid,
      mermaidCaption: GRAPH_CAPTION,
      blastRadius: blastFromGraph(graph, stats.changedPaths),
      multipleJobs: false,
    },
    graph,
    diff,
  );
}

function finishReplay(args: {
  id: string;
  fixtureId: FixtureId;
  graph: RepoGraph;
  mermaid: string;
  stats: DiffStats;
  secrets: Finding[];
  coverage: Coverage;
  diff: string;
}): void {
  const prebaked = store.loadPrebaked(args.fixtureId);
  const coverage: Coverage = {
    ...prebaked.coverage,
    ...args.coverage,
    source: "replay",
    snapshot: "full",
    parser: args.graph.parser,
    graphFilesKept: args.graph.filesKept.length,
    hops: args.graph.hops,
  };
  if (args.coverage.tavily === "skipped") coverage.tavily = prebaked.coverage.tavily;
  if (args.coverage.vision === "skipped") coverage.vision = prebaked.coverage.vision;
  const map: OrientationMap = attachGraphFields(
    {
      ...(prebaked.map ?? localMap(args.graph, args.mermaid, args.stats, args.diff)),
      mermaid: args.mermaid,
      mermaidCaption: GRAPH_CAPTION,
    },
    args.graph,
    args.diff,
  );
  emitStep(args.id, "Triage", "skipped");
  emitStep(args.id, "Tavily", "skipped");
  emitStep(args.id, "Vision", "skipped");
  emitStep(args.id, "Gate", "local");
  const verdict = gate({
    rawFindings: [...args.secrets, ...(prebaked.verdict?.findings ?? [])],
    coverage,
    ledger: prebaked.ledger ?? [],
    residualNotes: prebaked.verdict?.residualNotes,
  });
  emitTerminal(args.id, map, coverage, verdict);
  patchRun(args.id, {
    status: "done",
    source: "replay",
    coverage,
    map,
    verdict,
    ledger: verdict.ledger,
  });
}

function skippedLine(model: string, reason: string): TokenLine {
  return {
    model,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    usdEstimate: 0,
    skipped: true,
    reason,
  };
}

function fileToDataUrl(path: string): string {
  const buf = readFileSync(path);
  const lower = path.toLowerCase();
  const mime =
    lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

interface ContinueArgs {
  id: string;
  source: RunSource;
  issue: string;
  diff: string;
  files: Record<string, string>;
  changedPaths: string[];
  snapshot: Coverage["snapshot"];
  deps: RunDeps;
  fixtureId?: FixtureId;
  imageUrls?: string[];
}

async function continueFromFiles(args: ContinueArgs): Promise<void> {
  const { id, source, issue, diff, files, deps } = args;
  const parsedStats = diffStats(diff);
  const changedPaths = args.changedPaths.length > 0 ? args.changedPaths : parsedStats.changedPaths;
  const languages: Record<string, number> = {};
  for (const p of changedPaths) {
    const lang = languageOf(p);
    languages[lang] = (languages[lang] ?? 0) + 1;
  }
  const stats: DiffStats = {
    linesAdded: parsedStats.linesAdded,
    linesRemoved: parsedStats.linesRemoved,
    fileCount: changedPaths.length,
    languages,
    changedPaths,
  };

  emitStep(id, "Graph", "local");
  const graph = personalize(await buildGraph({ files, changedPaths }), changedPaths);
  const mermaid = mermaidFromGraph(graph);
  const coverage: Coverage = {
    ...baseCoverage(source),
    parser: graph.parser,
    graphFilesKept: graph.filesKept.length,
    hops: graph.hops,
    snapshot: args.snapshot,
  };
  const map0 = localMap(graph, mermaid, stats, diff);
  patchRun(id, { coverage, map: map0, source });
  emit(id, "map", map0);
  emit(id, "coverage", coverage);

  emitStep(id, "Pack", "local");
  const repoMap = formatRepoMap(graph);
  const neighbors = formatNeighbors(graph, files, changedPaths);
  const packed0 = packContext({ issue, patch: diff, repoMap, neighbors, tavily: "" });
  let pack = packed0.pack;
  coverage.packTruncated = packed0.packTruncated;
  const secrets = secretFindings(diff);

  const hasTfKey = Boolean(process.env.NEBIUS_API_KEY);
  const chat = deps.chat ?? (hasTfKey ? (createTokenFactoryClient() as unknown as ChatClient) : undefined);

  if (!hasTfKey || !chat) {
    if (args.fixtureId) {
      finishReplay({ id, fixtureId: args.fixtureId, graph, mermaid, stats, secrets, coverage, diff });
      return;
    }
    emitStep(id, "Triage", "skipped");
    emitStep(id, "Tavily", "skipped");
    emitStep(id, "Vision", "skipped");
    emitStep(id, "Gate", "local");
    const verdict = gate({ rawFindings: secrets, coverage, ledger: [] });
    emitTerminal(id, map0, coverage, verdict);
    patchRun(id, { status: "done", source, coverage, map: map0, verdict, ledger: verdict.ledger });
    return;
  }

  try {
    const startedAt = store.get(id)?.createdAt ?? 0;
    const elapsedMs = () => (deps.now ?? Date.now)() - startedAt;
    const liveList = deps.chat ? [] : await loadLiveModels();

    emitStep(id, "Triage", MODELS.lightning);
    const triage = await runTriage({ pack, client: chat, liveList });
    const ledger: TokenLine[] = [...triage.ledger];
    const lightningClaims: TavilyClaim[] = triage.ok
      ? triage.claims.map((c) => ({
          type: c.type,
          query: c.query,
          packageName: c.packageName,
        }))
      : [];
    const inventedNames = inventedNamesFor(files, changedPaths, diff);
    const claims = unionClaims(lightningClaims, inventedNames);
    const skipPackages = new Set(inventedNames);

    const fetchImpl = deps.tavilyFetch ?? (process.env.TAVILY_API_KEY ? fetch : undefined);
    let tavilyEvidence: WebEvidence[] = [];
    if (!fetchImpl) {
      emitStep(id, "Tavily", "skipped");
      coverage.tavily = "skipped";
    } else {
      emitStep(id, "Tavily", "tavily");
      const tv = await searchClaims(claims, fetchImpl);
      coverage.tavily = tv.status;
      tavilyEvidence = tv.evidence;
      const packed1 = packContext({
        issue,
        patch: diff,
        repoMap,
        neighbors,
        tavily: tavilyEvidence.map((e) => e.quote).join("\n"),
      });
      pack = packed1.pack;
      coverage.packTruncated = packed0.packTruncated || packed1.packTruncated;
    }
    const seeded = seededInventedFindings(inventedNames, tavilyEvidence);

    const superResult = await runSuper({ pack, client: chat });
    ledger.push(...superResult.ledger);

    let rawFindings: GateInput["rawFindings"] = [...secrets, ...seeded];
    let residualNotes: string[] | undefined;
    let map = map0;
    let modelParseFailed = false;
    let proposedStamp: string | undefined;

    if (superResult.ok) {
      const value = superResult.value;
      proposedStamp = value.proposedStamp;
      rawFindings = [
        ...secrets,
        ...seeded,
        ...modelFindings(value.findings, tavilyEvidence, MODELS.super, skipPackages),
      ];
      residualNotes = value.residualNotes;
      map = attachGraphFields(
        {
          size: {
            linesAdded: stats.linesAdded,
            linesRemoved: stats.linesRemoved,
            fileCount: stats.fileCount,
            languages: stats.languages,
            concernCount: value.concerns.length,
          },
          startHere: usableStartHere(value.startHere, stats.changedPaths),
          concerns: value.concerns,
          functions: value.functions,
          mermaid,
          mermaidCaption: GRAPH_CAPTION,
          blastRadius: blastFromGraph(graph, stats.changedPaths),
          multipleJobs: value.concerns.length >= 3 && stats.linesAdded >= 800,
        },
        graph,
        diff,
      );
    } else {
      modelParseFailed = true;
    }

    const images = args.imageUrls ?? [];
    if (elapsedMs() > 240_000) {
      coverage.timedOut = true;
      emitStep(id, "Vision", "skipped");
      coverage.vision = "skipped";
    } else if (images.length >= 1 && images.length <= 3) {
      emitStep(id, "Vision", MODELS.superVl);
      const vl = await runSuperVl({ issue, imageUrls: images, client: chat });
      ledger.push(...vl.ledger);
      if (vl.ok) {
        coverage.vision = "ok";
        const vis = findingFromSuperVl(vl.value, images[0]);
        if (vis) rawFindings = [...rawFindings, vis];
      } else {
        coverage.vision = "failed";
      }
    } else {
      emitStep(id, "Vision", "skipped");
      coverage.vision = "skipped";
    }

    if (elapsedMs() > 240_000) {
      coverage.timedOut = true;
      ledger.push(skippedLine(MODELS.ultra, "timed_out"));
    } else {
      const usdSoFar = ledger.reduce((sum, line) => sum + line.usdEstimate, 0);
      const decision = shouldCallUltra({
        findings: rawFindings
          .filter((f): f is typeof f & { confidence: number } => typeof f.confidence === "number")
          .map((f) => ({ confidence: f.confidence, kind: f.kind })),
        proposedStamp,
        usdSoFar,
        modelParseFailed,
      });
      if (!decision.call) {
        if (decision.reason === "budget_capped") coverage.budgetCapped = true;
        ledger.push(skippedLine(MODELS.ultra, decision.reason ?? "skipped"));
      } else {
        const ultra = await runUltra({ pack, client: chat });
        ledger.push(...ultra.ledger);
        if (ultra.ok) {
          const visual = rawFindings.filter((f) => f.kind === "visual_contradiction");
          rawFindings = [
            ...secrets,
            ...seeded,
            ...visual,
            ...modelFindings(ultra.value.findings, tavilyEvidence, MODELS.ultra, skipPackages),
          ];
          residualNotes = ultra.value.residualNotes;
          proposedStamp = ultra.value.proposedStamp;
          map = attachGraphFields(
            {
              size: {
                linesAdded: stats.linesAdded,
                linesRemoved: stats.linesRemoved,
                fileCount: stats.fileCount,
                languages: stats.languages,
                concernCount: ultra.value.concerns.length,
              },
              startHere: usableStartHere(ultra.value.startHere, stats.changedPaths),
              concerns: ultra.value.concerns,
              functions: ultra.value.functions,
              mermaid,
              mermaidCaption: GRAPH_CAPTION,
              blastRadius: blastFromGraph(graph, stats.changedPaths),
              multipleJobs: ultra.value.concerns.length >= 3 && stats.linesAdded >= 800,
            },
            graph,
            diff,
          );
        }
      }
    }

    emitStep(id, "Gate", "local");
    const notes = [...(residualNotes ?? [])];
    if (coverage.packTruncated && !notes.includes(PACK_TRUNCATED_NOTE)) notes.push(PACK_TRUNCATED_NOTE);
    const verdict = gate({ rawFindings, coverage, ledger, residualNotes: notes });
    if (verdict.ledger.some((line) => !line.skipped)) recordLiveSpend(verdict.usdEstimateTotal);
    emitTerminal(id, map, coverage, verdict, modelParseFailed);
    patchRun(id, {
      status: "done",
      source,
      coverage,
      map,
      verdict,
      ledger: verdict.ledger,
      modelParseFailed,
    });
  } catch (err) {
    if (args.fixtureId) {
      finishReplay({ id, fixtureId: args.fixtureId, graph, mermaid, stats, secrets, coverage, diff });
      return;
    }
    failRun(id, err);
  }
}

async function executeFixture(id: string, fixtureId: FixtureId, deps: RunDeps): Promise<void> {
  const hasTfKey = Boolean(process.env.NEBIUS_API_KEY);
  const source: RunSource = hasTfKey ? "fixture" : "replay";
  patchRun(id, { status: "running", source, coverage: baseCoverage(source) });

  emitStep(id, "Fetch", "local");
  const fixture = loadFixture(fixtureId);

  emitStep(id, "Snapshot", "skipped");

  await continueFromFiles({
    id,
    source,
    issue: fixture.issue,
    diff: fixture.diff,
    files: collectFiles(fixture.repoRoot),
    changedPaths: diffStats(fixture.diff).changedPaths,
    snapshot: "full",
    deps,
    fixtureId,
    imageUrls: fixture.screenshotPath ? [fileToDataUrl(fixture.screenshotPath)] : [],
  });
}

async function executePr(id: string, prUrl: string, deps: RunDeps): Promise<void> {
  const source: RunSource = "live";
  patchRun(id, { status: "running", source, coverage: baseCoverage(source) });

  emitStep(id, "Fetch", "github");
  const parsed = parsePrUrl(prUrl);
  if ("error" in parsed) {
    failCoded(id, "pr_not_found", "PR URL invalid or missing");
    return;
  }

  const ghFetch = deps.githubFetch ?? fetch;
  const bundle = await fetchPullRequest(parsed, ghFetch);
  if ("error" in bundle) {
    failCoded(
      id,
      bundle.error,
      bundle.error === "repo_private" ? "Public repos only" : "PR URL invalid or missing",
    );
    return;
  }

  const current = store.get(id);
  patchRun(id, {
    headline: {
      title: bundle.title,
      subtitle: current?.headline?.subtitle ?? `${parsed.owner}/${parsed.repo} · #${parsed.number}`,
      githubUrl: prUrl,
    },
  });

  let snap: SnapshotResult;
  try {
    if (deps.snapshot) {
      snap = await deps.snapshot({ buffer: Buffer.alloc(0), runId: id });
    } else {
      const tar = await fetchTarball(parsed, bundle.headSha, ghFetch);
      if (!tar.ok) snap = { ok: false, code: tar.code };
      else snap = await extractTarball({ buffer: tar.buffer, runId: id });
    }
  } catch {
    snap = { ok: false, code: "snapshot_failed" };
  }

  emitStep(id, "Snapshot", snap.ok ? "codeload" : "skipped");
  const snapshot: Coverage["snapshot"] = snap.ok ? "full" : "patch-only";
  const files = snap.ok ? snap.files : filesFromPatch(bundle.diff);

  await continueFromFiles({
    id,
    source,
    issue: [bundle.title, bundle.issueBody || bundle.body].filter(Boolean).join("\n\n"),
    diff: bundle.diff,
    files,
    changedPaths: bundle.changedPaths,
    snapshot,
    deps,
    imageUrls: bundle.imageUrls,
  });
}

async function executePaste(
  id: string,
  req: { issue: string; diff: string; imageUrls?: string[] },
  deps: RunDeps,
): Promise<void> {
  const source: RunSource = "live";
  patchRun(id, { status: "running", source, coverage: baseCoverage(source) });
  emitStep(id, "Fetch", "local");
  emitStep(id, "Snapshot", "skipped");
  await continueFromFiles({
    id,
    source,
    issue: req.issue,
    diff: req.diff,
    files: filesFromPatch(req.diff),
    changedPaths: diffStats(req.diff).changedPaths,
    snapshot: "patch-only",
    deps,
    imageUrls: req.imageUrls,
  });
}

async function execute(id: string, req: RunRequest, deps: RunDeps): Promise<void> {
  try {
    if (req.kind === "fixture") await executeFixture(id, req.fixtureId, deps);
    else if (req.kind === "pr") await executePr(id, req.prUrl, deps);
    else await executePaste(id, req, deps);
  } catch (err) {
    failRun(id, err);
  }
}

export async function startRun(req: RunRequest, deps: RunDeps = {}): Promise<{ id: string; done: Promise<void> }> {
  const id = nanoid();
  const source: RunSource =
    req.kind === "fixture" ? (process.env.NEBIUS_API_KEY ? "fixture" : "replay") : "live";
  store.put({
    id,
    status: "queued",
    source,
    coverage: baseCoverage(source),
    ledger: [],
    headline: headlineFor(req, source),
    createdAt: (deps.now ?? Date.now)(),
  });
  const done = execute(id, req, deps);
  inflight.set(id, done);
  return { id, done };
}

export async function waitRun(id: string, ms: number): Promise<Run> {
  const deadline = Date.now() + ms;
  const pending = inflight.get(id);
  if (pending) {
    const remain = deadline - Date.now();
    if (remain > 0) await Promise.race([pending, sleep(remain)]);
  }
  while (Date.now() < deadline) {
    const run = store.get(id);
    if (run && (run.status === "done" || run.status === "error")) return run;
    await sleep(20);
  }
  const run = store.get(id);
  if (!run) throw new Error(`run ${id} not found`);
  if (run.status === "done" || run.status === "error") return run;
  return patchRun(id, { coverage: { ...run.coverage, timedOut: true } });
}
