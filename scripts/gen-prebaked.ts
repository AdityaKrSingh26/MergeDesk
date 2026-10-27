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
    tavily: "skipped",
    vision: "skipped",
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
