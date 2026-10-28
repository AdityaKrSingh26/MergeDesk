import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GRAPH_CAPTION, REGEX_PARSER_CAPTION, displayStamp } from "../src/server/shared";
import { loadFixture } from "../src/server/ingest";
import { buildGraph, mermaidFromGraph, personalize } from "../src/server/graph";
import type {
  Coverage,
  Finding,
  FixtureId,
  OrientationMap,
  Run,
  VerdictStamp,
  Walkthrough,
} from "../src/server/shared";

const OUT_DIR = join(process.cwd(), "fixtures", "prebaked");
const IDS: FixtureId[] = ["fixture-ship", "fixture-fix", "fixture-block"];

function collectFiles(repoRoot: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string, rel: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, relPath);
        continue;
      }
      if (!/\.(ts|tsx|js|py)$/.test(ent.name)) continue;
      files[relPath.replaceAll("\\", "/")] = readFileSync(abs, "utf8");
    }
  };
  walk(repoRoot, "");
  return files;
}

function diffStats(diff: string): {
  linesAdded: number;
  linesRemoved: number;
  fileCount: number;
  languages: Record<string, number>;
  changedPaths: string[];
} {
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
    const lang = p.endsWith(".ts") || p.endsWith(".tsx") ? "ts" : p.endsWith(".js") ? "js" : p.endsWith(".py") ? "py" : "other";
    languages[lang] = (languages[lang] ?? 0) + 1;
  }
  return { linesAdded, linesRemoved, fileCount: files.size, languages, changedPaths: [...files] };
}

function authoredMap(id: FixtureId): Pick<
  OrientationMap,
  "startHere" | "concerns" | "functions" | "blastRadius" | "multipleJobs"
> {
  if (id === "fixture-ship") {
    return {
      startHere: [{ path: "src/clamp.ts", symbol: "clamp", why: "issue asks for clamp(n, min, max)" }],
      concerns: [],
      functions: [
        { name: "clamp", path: "src/clamp.ts", job: "clamp n to [min, max]" },
        { name: "abs", path: "src/math.ts", job: "absolute value used by clamp helpers" },
      ],
      blastRadius: {
        neighborsNotInDiff: ["src/math.ts"],
        testsAdded: ["src/clamp.test.ts"],
        testsMissing: [],
        envKeys: [],
      },
      multipleJobs: false,
    };
  }
  if (id === "fixture-fix") {
    return {
      startHere: [{ path: "src/http.ts", symbol: "fetchWithRetry", why: "retry helper named in the issue" }],
      concerns: [{ name: "timeout", paths: ["src/http.ts"] }],
      functions: [
        { name: "fetchWithRetry", path: "src/http.ts", job: "retry HTTP fetches" },
        { name: "fetchJson", path: "src/http.ts", job: "JSON wrapper around fetchWithRetry" },
      ],
      blastRadius: {
        neighborsNotInDiff: [],
        testsAdded: [],
        testsMissing: ["src/http.test.ts"],
        envKeys: [],
      },
      multipleJobs: false,
    };
  }
  return {
    startHere: [{ path: "src/invoices.ts", symbol: "exportInvoicesCsv", why: "CSV export requested by the issue" }],
    concerns: [
      { name: "secret", paths: ["src/auth.ts"] },
      { name: "invented package", paths: ["src/invoices.ts"] },
      { name: "dashboard scope", paths: ["src/dashboard.ts"] },
    ],
    functions: [
      { name: "exportInvoicesCsv", path: "src/invoices.ts", job: "write invoice CSV" },
      { name: "formatInvoiceRow", path: "src/invoiceCsv.ts", job: "format one CSV row" },
    ],
    blastRadius: {
      neighborsNotInDiff: [],
      testsAdded: [],
      testsMissing: ["src/invoices.test.ts"],
      envKeys: [],
    },
    multipleJobs: true,
  };
}

function authoredFindings(id: FixtureId): Finding[] {
  if (id === "fixture-ship") return [];
  if (id === "fixture-fix") {
    return [
      {
        id: "f-timeout",
        kind: "looks_right_logic",
        severity: "medium",
        confidence: 0.8,
        title: "Retry timeout is 0ms, not 2000ms",
        body: "Issue asked for a 2000ms default timeout; DEFAULT_TIMEOUT_MS is 0.",
        evidence: [
          {
            kind: "file",
            path: "src/http.ts",
            startLine: 3,
            quote: "export const DEFAULT_TIMEOUT_MS = 0;",
          },
        ],
        model: "replay",
        cited: true,
      },
    ];
  }
  return [
    {
      id: "f-secret",
      kind: "secret",
      severity: "high",
      confidence: 1,
      title: "AWS access key in patch",
      body: "Added line contains an AKIA access key id.",
      evidence: [
        {
          kind: "file",
          path: "src/auth.ts",
          startLine: 11,
          quote: 'export const awsKey = "AKIAIOSFODNN7EXAMPLE";',
        },
      ],
      model: "regex",
      cited: true,
    },
  ];
}

function authoredWalkthrough(id: FixtureId): Walkthrough {
  if (id === "fixture-ship") {
    return {
      summary: [
        "Adds clamp(n, min, max) in src/clamp.ts.",
        "Reuses abs() from src/math.ts.",
        "Adds unit tests in src/clamp.test.ts.",
      ],
      userFlow: {
        nodes: [
          { id: "caller", label: "Caller", kind: "actor" },
          { id: "clamp", label: "clamp()", kind: "action" },
          { id: "abs", label: "abs()", kind: "action" },
        ],
        edges: [
          { from: "caller", to: "clamp", label: "n, min, max" },
          { from: "clamp", to: "abs", label: "magnitude" },
        ],
      },
      fileLayers: [
        { name: "Logic", paths: ["src/clamp.ts"], why: "new helper named in the issue" },
        { name: "Neighbor", paths: ["src/math.ts"], why: "abs used by clamp" },
        { name: "Tests", paths: ["src/clamp.test.ts"], why: "covers clamp" },
      ],
      comments: [],
      suggestions: [],
    };
  }
  if (id === "fixture-fix") {
    return {
      summary: [
        "Adds fetchWithRetry around fetchJson in src/http.ts.",
        "Default timeout is 0ms while the issue asked for 2000ms.",
      ],
      userFlow: {
        nodes: [
          { id: "app", label: "App", kind: "actor" },
          { id: "retry", label: "fetchWithRetry", kind: "action" },
          { id: "net", label: "network", kind: "action" },
        ],
        edges: [
          { from: "app", to: "retry", label: "GET" },
          { from: "retry", to: "net", label: "attempt" },
        ],
      },
      fileLayers: [{ name: "Logic", paths: ["src/http.ts"], why: "retry helper" }],
      comments: [
        {
          id: "comment-0",
          path: "src/http.ts",
          startLine: 3,
          title: "Timeout is 0ms",
          body: "Issue asked for a 2000ms default timeout.",
          severity: "issue",
          quote: "export const DEFAULT_TIMEOUT_MS = 0;",
        },
      ],
      suggestions: [
        {
          id: "suggest-0",
          path: "src/http.ts",
          title: "Set DEFAULT_TIMEOUT_MS to 2000",
          unifiedDiff:
            "--- a/src/http.ts\n+++ b/src/http.ts\n@@ -1,3 +1,3 @@\n-export const DEFAULT_TIMEOUT_MS = 0;\n+export const DEFAULT_TIMEOUT_MS = 2000;\n",
        },
      ],
    };
  }
  return {
    summary: [
      "CSV export writes invoice rows.",
      "Patch adds an AWS access key in src/auth.ts.",
      "Shared paint and model sync are out of this fixture.",
    ],
    userFlow: {
      nodes: [
        { id: "operator", label: "Operator", kind: "actor" },
        { id: "export", label: "exportInvoicesCsv", kind: "action" },
      ],
      edges: [{ from: "operator", to: "export", label: "export" }],
    },
    fileLayers: [
      { name: "Secret", paths: ["src/auth.ts"], why: "credential in the diff" },
      { name: "Export", paths: ["src/invoices.ts"], why: "CSV path named in the issue" },
    ],
    comments: [
      {
        id: "comment-0",
        path: "src/auth.ts",
        startLine: 11,
        title: "AWS key in the patch",
        body: "This line matches the high-certainty secret regex.",
        severity: "issue",
        quote: "AKIAIOSFODNN7EXAMPLE",
      },
    ],
    suggestions: [
      {
        id: "suggest-0",
        path: "src/auth.ts",
        title: "Remove the hardcoded key",
        unifiedDiff:
          "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -11,1 +11,0 @@\n-export const awsKey = \"AKIAIOSFODNN7EXAMPLE\";\n",
      },
    ],
  };
}

function stampFor(id: FixtureId): VerdictStamp {
  if (id === "fixture-ship") return "SHIP";
  if (id === "fixture-fix") return "FIX";
  return "BLOCK";
}

async function buildRun(id: FixtureId): Promise<Run> {
  const fixture = loadFixture(id);
  const files = collectFiles(fixture.repoRoot);
  const stats = diffStats(fixture.diff);
  const graph = personalize(
    await buildGraph({ files, changedPaths: stats.changedPaths }),
    stats.changedPaths,
  );
  const mermaid = mermaidFromGraph(graph);
  const authored = authoredMap(id);
  const stamp = stampFor(id);
  const coverage: Coverage = {
    source: "replay",
    snapshot: "full",
    parser: graph.parser,
    graphFilesKept: graph.filesKept.length,
    graphFileCap: 40,
    hops: graph.hops,
    tavily: id === "fixture-block" ? "ok" : "skipped",
    vision: "skipped",
    review: "skipped",
    budgetCapped: false,
    timedOut: false,
    packTruncated: id === "fixture-block",
  };
  const residualNotes =
    stamp === "SHIP"
      ? [
          ...(coverage.parser === "regex" ? [REGEX_PARSER_CAPTION] : []),
        ]
      : [];
  const map: OrientationMap = {
    size: {
      linesAdded: stats.linesAdded,
      linesRemoved: stats.linesRemoved,
      fileCount: stats.fileCount,
      languages: stats.languages,
      concernCount: authored.concerns.length,
    },
    startHere: authored.startHere,
    concerns: authored.concerns,
    functions: authored.functions,
    mermaid,
    mermaidCaption: GRAPH_CAPTION,
    blastRadius: authored.blastRadius,
    multipleJobs: authored.multipleJobs,
  };
  const findings = authoredFindings(id);
  return {
    id,
    status: "done",
    source: "replay",
    coverage,
    map,
    walkthrough: authoredWalkthrough(id),
    verdict: {
      stamp,
      displayStamp: displayStamp(stamp),
      findings,
      residualNotes,
      coverage,
      ledger: [],
      usdEstimateTotal: 0,
    },
    ledger: [],
    createdAt: 0,
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const id of IDS) {
    const run = await buildRun(id);
    const out = join(OUT_DIR, `${id}.json`);
    writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`, "utf8");
    process.stdout.write(`${id} mermaid:\n${run.map?.mermaid ?? ""}\n\n`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
