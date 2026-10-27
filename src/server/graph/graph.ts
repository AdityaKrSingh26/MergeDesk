import type { RepoGraph } from "@/server/shared";
import { extractSpecifiersTreeSitter, loadTreeSitter } from "./treeSitter";

const FILE_EXTS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py",
  ".go", ".rs", ".java", ".kt", ".kts", ".cs", ".rb", ".php",
  ".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".swift",
] as const;
const TREE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|py)$/i;
const REGEX_EXT = /\.(?:go|rs|java|kt|kts|cs|rb|php|c|h|cc|cpp|cxx|hpp|swift)$/i;
const SIBLING_EXT = new Set([".go", ".java", ".kt", ".kts", ".cs"]);

const JS_FROM = /\bimport\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g;
const JS_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_FROM = /(?:^|[\n;])\s*from\s+(\S+)\s+import\b/g;
const PY_IMPORT = /(?:^|[\n;])\s*import\s+([^\s#;]+)/g;

function nodeId(path: string): string {
  return path.replace(/[^A-Za-z0-9_]/g, "_");
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i === -1 ? "" : filePath.slice(0, i);
}

function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

function isRelative(spec: string): boolean {
  return spec.startsWith(".");
}

function toPathSpec(spec: string): string {
  if (spec.startsWith("./") || spec.startsWith("../")) return spec;
  if (!spec.startsWith(".")) return spec;
  const m = spec.match(/^(\.+)(.*)$/);
  if (!m) return spec;
  const level = m[1].length;
  const rest = m[2].replace(/^\./, "").replace(/\./g, "/");
  const prefix = level === 1 ? "./" : "../".repeat(level - 1);
  return rest ? prefix + rest : prefix;
}

function resolveRelative(fromFile: string, spec: string, files: Record<string, string>): string | undefined {
  const base = normalize(`${dirOf(fromFile)}/${toPathSpec(spec)}`);
  const candidates = [base, ...FILE_EXTS.map((ext) => base + ext), `${base}/index.ts`];
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate;
  }
  return undefined;
}

function stripQuotes(spec: string): string {
  return spec.replace(/^['"]|['"]$/g, "");
}

function extOf(filePath: string): string {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

function jsPyImports(source: string): string[] {
  const specs: string[] = [];
  JS_FROM.lastIndex = 0;
  for (const m of source.matchAll(JS_FROM)) specs.push(m[1]);
  JS_REQUIRE.lastIndex = 0;
  for (const m of source.matchAll(JS_REQUIRE)) specs.push(m[1]);
  PY_FROM.lastIndex = 0;
  for (const m of source.matchAll(PY_FROM)) {
    const spec = stripQuotes(m[1]);
    if (spec) specs.push(spec);
  }
  PY_IMPORT.lastIndex = 0;
  for (const m of source.matchAll(PY_IMPORT)) {
    const names = m[1];
    if (names.startsWith("{") || names.startsWith("*") || names.startsWith('"') || names.startsWith("'")) {
      continue;
    }
    const stmt = source.slice(m.index ?? 0, (m.index ?? 0) + m[0].length + 32);
    if (/\bfrom\s+['"]/.test(stmt)) continue;
    for (const part of names.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) specs.push(name);
    }
  }
  return specs;
}

function goImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/import\s*\(([^)]*)\)/g)) {
    for (const line of m[1].split("\n")) {
      const q = line.match(/"([^"]+)"/);
      if (q) specs.push(q[1]);
    }
  }
  for (const m of source.matchAll(/import\s+(?:[\w.]+\s+)?"([^"]+)"/g)) specs.push(m[1]);
  return specs;
}

function rustImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/^\s*mod\s+([A-Za-z_][\w]*)/gm)) specs.push(`./${m[1]}`);
  for (const m of source.matchAll(/^\s*use\s+super::([A-Za-z_][\w]*)/gm)) specs.push(`../${m[1]}`);
  return specs;
}

function cIncludes(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/^\s*#include\s+"([^"]+)"/gm)) specs.push(m[1].includes("/") || m[1].startsWith(".") ? m[1] : `./${m[1]}`);
  return specs;
}

function rubyImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/require_relative\s+['"]([^'"]+)['"]/g)) specs.push(m[1].startsWith(".") ? m[1] : `./${m[1]}`);
  for (const m of source.matchAll(/require\s+['"](\.[^'"]+)['"]/g)) specs.push(m[1]);
  return specs;
}

function phpImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*['"](\.[^'"]+)['"]/g)) specs.push(m[1]);
  return specs;
}

function extractSpecifiers(filePath: string, source: string): string[] {
  switch (extOf(filePath)) {
    case ".go":
      return goImports(source);
    case ".rs":
      return rustImports(source);
    case ".c":
    case ".h":
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".hpp":
      return cIncludes(source);
    case ".rb":
      return rubyImports(source);
    case ".php":
      return phpImports(source);
    default:
      return jsPyImports(source);
  }
}

function isInventedBare(spec: string): boolean {
  if (isRelative(spec)) return false;
  if (spec.startsWith("node:")) return false;
  if (spec.startsWith("https:")) return false;
  return true;
}

export function inventedImportNames(files: Record<string, string>, changedPaths: string[]): string[] {
  const names = new Set<string>();
  for (const path of changedPaths) {
    const source = files[path];
    if (source === undefined) continue;
    for (const spec of extractSpecifiers(path, source)) {
      if (extOf(path) === ".go" && !spec.includes(".")) continue;
      if (isInventedBare(spec)) names.add(spec);
    }
  }
  return [...names].sort();
}

function fileNode(path: string, changedPaths: ReadonlySet<string>): RepoGraph["nodes"][number] {
  const slash = path.lastIndexOf("/");
  const label = slash === -1 ? path : path.slice(slash + 1);
  return {
    id: nodeId(path),
    path,
    kind: "file",
    label,
    changed: changedPaths.has(path),
  };
}

function assembleGraph(
  files: Record<string, string>,
  changedPaths: string[],
  specsFor: (filePath: string, source: string) => string[],
  parser: "regex" | "tree-sitter",
): RepoGraph {
  const changed = new Set(changedPaths);
  const paths = Object.keys(files).sort();
  const nodes = paths.map((p) => fileNode(p, changed));
  const idSet = new Set(nodes.map((n) => n.id));
  const edgeKeys = new Set<string>();
  const edges: RepoGraph["edges"] = [];

  for (const fromPath of paths) {
    const source = files[fromPath];
    const from = nodeId(fromPath);
    for (const spec of specsFor(fromPath, source)) {
      if (!isRelative(spec)) continue;
      const toPath = resolveRelative(fromPath, spec, files);
      if (!toPath) continue;
      const to = nodeId(toPath);
      if (!idSet.has(to) || from === to) continue;
      const key = `${from}->${to}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from, to, kind: "import" });
    }
  }

  for (const fromPath of paths) {
    const ext = extOf(fromPath);
    if (!SIBLING_EXT.has(ext)) continue;
    const from = nodeId(fromPath);
    const dir = dirOf(fromPath);
    for (const toPath of paths) {
      if (toPath === fromPath || extOf(toPath) !== ext || dirOf(toPath) !== dir) continue;
      const to = nodeId(toPath);
      const key = `${from}->${to}`;
      if (edgeKeys.has(key) || from === to) continue;
      edgeKeys.add(key);
      edges.push({ from, to, kind: "reference" });
    }
  }

  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const hasTree = paths.some((p) => TREE_EXT.test(p));
  const hasRegexLang = paths.some((p) => TREE_EXT.test(p) || REGEX_EXT.test(p));
  const label: RepoGraph["parser"] =
    parser === "tree-sitter" && hasTree ? "tree-sitter" : hasRegexLang ? "regex" : "none";

  return {
    nodes,
    edges,
    parser: label,
    hops: 1,
    filesKept: paths,
  };
}

function buildGraphRegex(files: Record<string, string>, changedPaths: string[]): RepoGraph {
  return assembleGraph(files, changedPaths, (filePath, source) => extractSpecifiers(filePath, source), "regex");
}

async function buildGraphTreeSitter(files: Record<string, string>, changedPaths: string[]): Promise<RepoGraph> {
  const session = await loadTreeSitter();
  return assembleGraph(
    files,
    changedPaths,
    (filePath, source) =>
      TREE_EXT.test(filePath)
        ? extractSpecifiersTreeSitter(session, filePath, source)
        : extractSpecifiers(filePath, source),
    "tree-sitter",
  );
}

export async function buildGraph(args: {
  files: Record<string, string>;
  changedPaths: string[];
  forceParser?: "regex" | "tree-sitter";
}): Promise<RepoGraph> {
  if (args.forceParser === "regex") return buildGraphRegex(args.files, args.changedPaths);
  try {
    return await buildGraphTreeSitter(args.files, args.changedPaths);
  } catch {
    return buildGraphRegex(args.files, args.changedPaths);
  }
}

export function personalize(graph: RepoGraph, changedPaths: string[]): RepoGraph {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const fileNodes = graph.nodes.filter((n) => n.kind === "file");
  const pathSet = new Set(fileNodes.map((n) => n.path));
  const seeds = changedPaths.filter((p) => pathSet.has(p));

  const adj = new Map<string, Set<string>>();
  const addAdj = (a: string, b: string) => {
    let set = adj.get(a);
    if (!set) {
      set = new Set();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const e of graph.edges) {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    if (!from || !to || from.kind !== "file" || to.kind !== "file") continue;
    addAdj(from.path, to.path);
    addAdj(to.path, from.path);
  }

  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const seed of seeds) {
    dist.set(seed, 0);
    queue.push(seed);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    if (d >= 2) continue;
    for (const nb of adj.get(cur) ?? []) {
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      queue.push(nb);
    }
  }

  const hop1Count = [...dist.values()].filter((d) => d === 1).length;
  const maxHop = hop1Count < 12 ? 2 : 1;
  const ranked = [...dist.entries()]
    .filter(([, d]) => d <= maxHop)
    .sort(([aPath, aD], [bPath, bD]) => aD - bD || aPath.localeCompare(bPath));
  const kept = ranked.slice(0, 40);
  const keptPaths = new Set(kept.map(([p]) => p));
  const hops: 1 | 2 = kept.some(([, d]) => d === 2) ? 2 : 1;
  const changed = new Set(changedPaths);

  const nodes = fileNodes
    .filter((n) => keptPaths.has(n.path))
    .map((n) => ({ ...n, changed: changed.has(n.path) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return {
    nodes,
    edges,
    parser: graph.parser,
    hops,
    filesKept: nodes.map((n) => n.path),
  };
}
