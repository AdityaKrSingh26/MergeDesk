// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RunView } from "@/app/r/[id]/RunView";
import { makeCoverage } from "../helpers/coverage";
import { tavilyHitsLabel, type Run } from "@/server/shared";

vi.mock("@xyflow/react/dist/style.css", () => ({}));
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes, edges, onNodeClick, onPaneClick, nodeTypes }: {
    nodes: Array<{
      id: string;
      type?: string;
      data: { filename: string; path: string };
      selected?: boolean;
    }>;
    edges: Array<{ id: string; source: string; target: string }>;
    nodeTypes?: Record<string, React.ComponentType<{
      id: string;
      data: { filename: string; path: string };
      selected?: boolean;
    }>>;
    onNodeClick?: (e: unknown, n: { data: { path: string } }) => void;
    onPaneClick?: () => void;
  }) => (
    <div>
      {nodes.map((n) => {
        const Comp = n.type ? nodeTypes?.[n.type] : undefined;
        if (Comp) {
          return <Comp key={n.id} id={n.id} data={n.data} selected={n.selected === true} />;
        }
        return (
          <button
            key={n.id}
            type="button"
            aria-pressed={n.selected === true}
            onClick={() => onNodeClick?.(null, n)}
          >
            {n.data.filename}
          </button>
        );
      })}
      {edges.map((e) => (
        <span key={e.id}>{`${e.source}->${e.target}`}</span>
      ))}
      <button type="button" onClick={() => onPaneClick?.()}>Clear canvas</button>
    </div>
  ),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  Background: () => null,
  useReactFlow: () => ({
    zoomIn: () => undefined,
    zoomOut: () => undefined,
    fitView: () => undefined,
  }),
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

afterEach(cleanup);

class FakeEventSource {
  static latest: FakeEventSource | undefined;
  url: string;
  closed = false;
  listeners = new Map<string, Array<(ev: { data: string }) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.latest = this;
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
}

const blockRun: Run = {
  id: "fixture-block",
  status: "done",
  source: "replay",
  coverage: makeCoverage({ source: "replay", tavily: "ok", parser: "regex" }),
  map: {
    size: { linesAdded: 2000, linesRemoved: 10, fileCount: 12, languages: { ts: 12 }, concernCount: 3 },
    startHere: [{ path: "src/invoices.ts", symbol: "exportCsv", why: "entry" }],
    concerns: [{ name: "csv", paths: ["src/invoices.ts"] }],
    functions: [{ name: "exportCsv", path: "src/invoices.ts", job: "write csv" }],
    mermaid: "graph TD; a-->b;",
    mermaidCaption: "Import / reference neighborhood, not a proven execution trace.",
    blastRadius: { neighborsNotInDiff: [], testsAdded: [], testsMissing: [], envKeys: [] },
    multipleJobs: true,
  },
  verdict: {
    stamp: "BLOCK",
    displayStamp: "High-certainty exception",
    findings: [{
      id: "f0", kind: "secret", severity: "high", confidence: 0.9,
      title: "AWS key", body: "regex",
      evidence: [{ kind: "file", path: "src/auth.ts", startLine: 2, quote: "AKIAIOSFODNN7EXAMPLE" }],
      model: "regex", cited: true,
    }],
    residualNotes: [],
    coverage: makeCoverage({ source: "replay" }),
    ledger: [],
    usdEstimateTotal: 0,
  },
  ledger: [],
  createdAt: 0,
};

describe("RunView", () => {
  it("run view shows Replay badge, coverage chips, graph caption, and display stamp", () => {
    render(<RunView run={blockRun} />);
    expect(screen.getByText("Replay")).toBeInTheDocument();
    expect(screen.getByText("High-certainty exception")).toBeInTheDocument();
    expect(screen.getByText(/import \/ reference neighborhood/i)).toBeInTheDocument();
    expect(screen.getByText(/heuristic parser/i)).toBeInTheDocument();
    expect(screen.getByText(/this PR looks like multiple jobs/i)).toBeInTheDocument();
    expect(screen.queryByText("BLOCK")).not.toBeInTheDocument();
  });

  it("renders an edgeless neighborhood as a zoomable canvas grid", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        mermaid: [
          "graph TD",
          '  internal_regex_go["regex.go"]',
          '  internal_filter_go["filter.go"]',
          "  style internal_regex_go fill:#fde68a",
          "  style internal_filter_go fill:#e0e7ff",
        ].join("\n"),
      },
    }} />);
    const canvas = screen.getByRole("region", { name: "PR import neighborhood" });
    expect(canvas).toHaveTextContent("regex.go");
    expect(canvas).toHaveTextContent("filter.go");
    expect(screen.getByText("No import edges in this neighborhood.")).toBeInTheDocument();
    expect(document.querySelector("pre.mermaid")).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fit neighborhood" })).toBeInTheDocument();
  });

  it("renders an edged neighborhood as canvas edges, not mermaid", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        neighborhood: {
          nodes: [
            { id: "a", path: "src/auth.ts", label: "src/auth.ts", changed: true },
            { id: "b", path: "src/invoices.ts", label: "src/invoices.ts", changed: true },
          ],
          edges: [{ from: "a", to: "b", kind: "import" }],
        },
        mermaid: "graph TD\n  a[\"auth.ts\"]\n  b[\"invoices.ts\"]\n  a --> b",
      },
    }} />);
    expect(screen.getByRole("region", { name: "PR import neighborhood" })).toHaveTextContent("auth.ts");
    expect(screen.getByText("a->b")).toBeInTheDocument();
    expect(screen.queryByText("No import edges in this neighborhood.")).not.toBeInTheDocument();
    expect(document.querySelector("pre.mermaid")).toBeNull();
  });

  it("canvas file nodes are buttons; click and Enter select with aria-pressed", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        neighborhood: {
          nodes: [
            { id: "a", path: "src/auth.ts", label: "src/auth.ts", changed: true },
            { id: "b", path: "src/invoices.ts", label: "src/invoices.ts", changed: true },
          ],
          edges: [{ from: "a", to: "b", kind: "import" }],
        },
      },
    }} />);
    const auth = screen.getByRole("button", { name: "auth.ts" });
    const invoices = screen.getByRole("button", { name: "invoices.ts" });
    expect(auth.tagName).toBe("BUTTON");
    expect(auth).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(auth);
    expect(auth).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(invoices, { key: "Enter" });
    expect(invoices).toHaveAttribute("aria-pressed", "true");
    expect(auth).toHaveAttribute("aria-pressed", "false");
    fireEvent.keyDown(auth, { key: " " });
    expect(auth).toHaveAttribute("aria-pressed", "true");
  });

  it("keys the neighborhood canvas to the run id so a new run refits", () => {
    const { rerender } = render(<RunView run={blockRun} />);
    expect(screen.getByRole("region", { name: "PR import neighborhood" })).toHaveAttribute(
      "data-run-id",
      "fixture-block",
    );
    rerender(<RunView run={{ ...blockRun, id: "other-run" }} />);
    expect(screen.getByRole("region", { name: "PR import neighborhood" })).toHaveAttribute(
      "data-run-id",
      "other-run",
    );
  });

  it("file citations show path, line, and quote as separate scan lines", () => {
    render(<RunView run={blockRun} />);
    expect(screen.getByText("Secret")).toBeInTheDocument();
    expect(screen.getByText("auth.ts")).toBeInTheDocument();
    expect(screen.getByText("L2")).toBeInTheDocument();
    expect(screen.getByText("AKIAIOSFODNN7EXAMPLE")).toBeInTheDocument();
    expect(screen.queryByText("src/auth.ts:2 — AKIAIOSFODNN7EXAMPLE")).not.toBeInTheDocument();
  });

  it("patch citations keep one removed line and the added line, not the first two minuses", () => {
    const mashed =
      "-const droppedEditTodo = bundledDevTodo( -test('imported css', async () => { +export function tests() { + const droppedEditTodo = bundledDevTodo(";
    const run: Run = {
      ...blockRun,
      verdict: {
        ...blockRun.verdict!,
        stamp: "FIX",
        displayStamp: "Cited exceptions",
        findings: [{
          id: "scope",
          kind: "scope_drift",
          severity: "high",
          confidence: 0.8,
          title: "PR refactors entire test registration architecture, not just isolate: false",
          body: "The issue requests only isolate: false.",
          evidence: [{
            kind: "file",
            path: "playground/css/__tests__/tests.ts",
            startLine: 17,
            quote: mashed,
          }],
          model: "ultra",
          cited: true,
        }],
      },
    };
    render(<RunView run={run} />);
    expect(screen.getByText("Scope drift")).toBeInTheDocument();
    expect(screen.getByText("tests.ts")).toBeInTheDocument();
    expect(screen.getByText("L17")).toBeInTheDocument();
    expect(screen.getByText("+export function tests() {")).toBeInTheDocument();
    expect(screen.getByText("-const droppedEditTodo = bundledDevTodo(")).toBeInTheDocument();
    expect(screen.queryByText("-test('imported css', async () => {")).not.toBeInTheDocument();
    expect(screen.queryByText("css/__tests__")).not.toBeInTheDocument();
  });

  it("shows model_parse_failed when Super JSON did not parse", () => {
    render(<RunView run={{ ...blockRun, modelParseFailed: true }} />);
    expect(screen.getByText("model_parse_failed")).toBeInTheDocument();
    expect(screen.getByText("Super JSON did not parse.")).toBeInTheDocument();
  });

  it("hides the parse-failed chip when Super JSON parsed", () => {
    render(<RunView run={blockRun} />);
    expect(screen.queryByText("model_parse_failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Super JSON did not parse.")).not.toBeInTheDocument();
  });

  it("prints the Tavily hits label once when finding body repeats the evidence line", () => {
    const label = tavilyHitsLabel(3);
    const fixRun: Run = {
      id: "dup-tavily",
      status: "done",
      source: "live",
      coverage: makeCoverage({ source: "live", tavily: "ok" }),
      map: {
        size: { linesAdded: 10, linesRemoved: 1, fileCount: 1, languages: { ts: 1 }, concernCount: 0 },
        startHere: [],
        concerns: [],
        functions: [],
        mermaid: "graph TD; a;",
        mermaidCaption: "Import / reference neighborhood, not a proven execution trace.",
        blastRadius: { neighborsNotInDiff: [], testsAdded: [], testsMissing: [], envKeys: [] },
        multipleJobs: false,
      },
      verdict: {
        stamp: "FIX",
        displayStamp: "Cited exceptions",
        findings: [{
          id: "invented-convert-source-map",
          kind: "invented_surface",
          severity: "high",
          confidence: 1,
          title: "Unknown package convert-source-map",
          body: label,
          evidence: [{ kind: "tavily", quote: label, tavilyHits: 3, url: "https://www.npmjs.com/package/convert-source-map" }],
          model: "tavily",
          cited: true,
        }],
        residualNotes: [],
        coverage: makeCoverage({ source: "live", tavily: "ok" }),
        ledger: [],
        usdEstimateTotal: 0,
      },
      ledger: [],
      createdAt: 0,
    };
    render(<RunView run={fixRun} />);
    expect(screen.getByText("Invented surface")).toBeInTheDocument();
    expect(screen.getAllByText(label)).toHaveLength(1);
    expect(screen.getByText("npmjs.com")).toBeInTheDocument();
  });

  it("tavily evidence shows search hits are not proof of absence", () => {
    const fixRun: Run = {
      id: "fixture-fix",
      status: "done",
      source: "fixture",
      coverage: makeCoverage({ source: "replay", tavily: "ok" }),
      map: {
        size: { linesAdded: 10, linesRemoved: 1, fileCount: 1, languages: { ts: 1 }, concernCount: 1 },
        startHere: [{ path: "src/http.ts", symbol: "fetchWithRetry", why: "retry" }],
        concerns: [],
        functions: [],
        mermaid: "graph TD; a;",
        mermaidCaption: "Import / reference neighborhood, not a proven execution trace.",
        blastRadius: { neighborsNotInDiff: [], testsAdded: [], testsMissing: [], envKeys: [] },
        multipleJobs: false,
      },
      verdict: {
        stamp: "FIX",
        displayStamp: "Cited exceptions",
        findings: [{
          id: "f-tavily",
          kind: "invented_surface",
          severity: "medium",
          confidence: 0.7,
          title: "Unknown package",
          body: "search found nothing",
          evidence: [{ kind: "tavily", quote: "no docs", tavilyHits: 0 }],
          model: "lightning",
          cited: true,
        }],
        residualNotes: [],
        coverage: makeCoverage({ source: "replay", tavily: "ok" }),
        ledger: [],
        usdEstimateTotal: 0,
      },
      ledger: [],
      createdAt: 0,
    };
    render(<RunView run={fixRun} />);
    expect(screen.getByText("search: 0 results (not proof of absence)")).toBeInTheDocument();
    expect(screen.getByText("Fixture")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByText("FIX")).not.toBeInTheDocument();
  });

  it("applies coverage from the verdict event so chips do not stay on the queued defaults", async () => {
    class FakeEventSource {
      static latest: FakeEventSource | undefined;
      url: string;
      closed = false;
      listeners = new Map<string, Array<(ev: { data: string }) => void>>();
      constructor(url: string) {
        this.url = url;
        FakeEventSource.latest = this;
      }
      addEventListener(type: string, fn: (ev: { data: string }) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      close() {
        this.closed = true;
      }
      emit(type: string, data: unknown) {
        for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const queued: Run = {
        ...blockRun,
        id: "queued-coverage",
        status: "queued",
        source: "live",
        coverage: makeCoverage({
          source: "live",
          snapshot: "full",
          parser: "none",
          tavily: "skipped",
          vision: "skipped",
        }),
        verdict: undefined,
        map: undefined,
      };
      queued.coverage.graphFilesKept = 0;
      render(<RunView run={queued} />);
      FakeEventSource.latest?.emit("verdict", {
        stamp: "SHIP",
        displayStamp: "No cited exceptions",
        findings: [],
        residualNotes: [],
        coverage: makeCoverage({ source: "live", parser: "tree-sitter", tavily: "failed" }),
        ledger: [],
        usdEstimateTotal: 0,
      });
      FakeEventSource.latest?.emit("done", {});
      await waitFor(() => {
        expect(screen.getByText("parser: tree-sitter")).toBeInTheDocument();
        expect(screen.getByText("tavily: failed")).toBeInTheDocument();
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hydrates the map from GET when done arrives without a map event", async () => {
    class FakeEventSource {
      static latest: FakeEventSource | undefined;
      url: string;
      closed = false;
      listeners = new Map<string, Array<(ev: { data: string }) => void>>();
      constructor(url: string) {
        this.url = url;
        FakeEventSource.latest = this;
      }
      addEventListener(type: string, fn: (ev: { data: string }) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      close() {
        this.closed = true;
      }
      emit(type: string, data: unknown) {
        for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe("/api/runs/queued-map");
      return new Response(JSON.stringify({
        ...blockRun,
        id: "queued-map",
        status: "done",
      }), { headers: { "content-type": "application/json" } });
    });
    try {
      const queued: Run = {
        ...blockRun,
        id: "queued-map",
        status: "queued",
        source: "live",
        verdict: undefined,
        map: undefined,
      };
      render(<RunView run={queued} />);
      FakeEventSource.latest?.emit("verdict", {
        stamp: "SHIP",
        displayStamp: "No cited exceptions",
        findings: [],
        residualNotes: [],
        coverage: queued.coverage,
        ledger: [],
        usdEstimateTotal: 0,
      });
      FakeEventSource.latest?.emit("done", {});
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: /recommended reading order/i })).toBeInTheDocument();
        expect(screen.getAllByText("exportCsv").length).toBeGreaterThan(0);
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("follows step events for a queued run and does not open EventSource when already done", async () => {
    class FakeEventSource {
      static latest: FakeEventSource | undefined;
      url: string;
      closed = false;
      listeners = new Map<string, Array<(ev: { data: string }) => void>>();
      constructor(url: string) {
        this.url = url;
        FakeEventSource.latest = this;
      }
      addEventListener(type: string, fn: (ev: { data: string }) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      }
      close() {
        this.closed = true;
      }
      emit(type: string, data: unknown) {
        for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const queued: Run = {
        ...blockRun,
        id: "queued-1",
        status: "queued",
        source: "live",
        verdict: undefined,
        map: undefined,
      };
      const { unmount } = render(<RunView run={queued} />);
      const es = FakeEventSource.latest;
      expect(es?.url).toBe("/api/runs/queued-1/events");
      es?.emit("step", { name: "Graph", detail: "local" });
      await waitFor(() => {
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent("Graph");
        expect(status).toHaveTextContent("local");
        expect(status).toHaveTextContent("3 of 8");
      });
      es?.emit("verdict", {
        stamp: "FIX",
        displayStamp: "Cited exceptions",
        findings: [],
        residualNotes: [],
        coverage: queued.coverage,
        ledger: [],
        usdEstimateTotal: 0,
      });
      es?.emit("done", {});
      await waitFor(() => {
        expect(screen.getByText("Cited exceptions")).toBeInTheDocument();
      });
      expect(es?.closed).toBe(true);
      unmount();

      FakeEventSource.latest = undefined;
      render(<RunView run={blockRun} />);
      expect(FakeEventSource.latest).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the graph overlay while queued without a map", () => {
    class FakeEventSource {
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      render(<RunView run={{ ...blockRun, status: "queued", map: undefined, verdict: undefined }} />);
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Fetch");
      expect(status).toHaveTextContent("1 of 8");
      expect(screen.queryByRole("region", { name: "PR import neighborhood" })).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the overlay when the run is already done with a map", () => {
    render(<RunView run={blockRun} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Layout A uses the headline, horizontal steps, and a findings rail", () => {
    render(<RunView run={{
      ...blockRun,
      headline: {
        title: "Add regex filters",
        subtitle: "jaegertracing/jaeger · #9923",
        githubUrl: "https://github.com/jaegertracing/jaeger/pull/9923",
      },
    }} />);
    expect(screen.getByRole("heading", { name: "Add regex filters" })).toBeInTheDocument();
    expect(screen.getByText("jaegertracing/jaeger · #9923")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/jaegertracing/jaeger/pull/9923",
    );
    const steps = screen.getByRole("list", { name: "Desk steps" });
    expect(steps).toHaveTextContent("Fetch");
    expect(steps).toHaveTextContent("Gate");
    expect(screen.getByRole("region", { name: "Stamp" })).toBeInTheDocument();
  });

  it("keeps the overlay and shows the wax alert when the run errors without a map", () => {
    render(<RunView run={{
      ...blockRun,
      status: "error",
      map: undefined,
      verdict: undefined,
      error: { code: "pr_not_found", message: "PR URL invalid or missing" },
    }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("PR URL invalid or missing");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("clicking a canvas file pins matching findings and dims the rest", async () => {
    const run: Run = {
      ...blockRun,
      map: {
        ...blockRun.map!,
        neighborhood: {
          nodes: [
            { id: "auth", path: "src/auth.ts", label: "src/auth.ts", changed: true },
            { id: "inv", path: "src/invoices.ts", label: "src/invoices.ts", changed: true },
          ],
          edges: [{ from: "auth", to: "inv", kind: "import" }],
        },
      },
      verdict: {
        ...blockRun.verdict!,
        stamp: "FIX",
        displayStamp: "Cited exceptions",
        findings: [
          blockRun.verdict!.findings[0],
          {
            id: "f1",
            kind: "scope_drift",
            severity: "medium",
            confidence: 0.4,
            title: "CSV export extra columns",
            body: "scope",
            evidence: [{ kind: "file", path: "src/invoices.ts", startLine: 10, quote: "exportCsv" }],
            model: "nvidia/nemotron-3-super-120b-a12b",
            cited: true,
          },
        ],
      },
    };
    render(<RunView run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "auth.ts" }));
    expect(screen.getByText(/Findings · pinned to auth\.ts/i)).toBeInTheDocument();
    const secret = screen.getByText("AWS key").closest("li");
    const drift = screen.getByText("CSV export extra columns").closest("li");
    expect(secret?.className).toMatch(/outline|ring|forest/i);
    expect(drift?.className).toMatch(/opacity/);
  });

  it("pending stamp uses the Gate copy", () => {
    render(<RunView run={{ ...blockRun, verdict: undefined }} />);
    expect(screen.getByText("Stamp pending. Findings arrive after Gate.")).toBeInTheDocument();
  });

  it("lists recommended reading order and per-file plus minus", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        startHere: [{ path: "src/invoices.ts", symbol: "exportCsv", why: "entry" }],
        changedFiles: [
          { path: "src/invoices.ts", linesAdded: 40, linesRemoved: 2 },
          { path: "src/auth.ts", linesAdded: 3, linesRemoved: 0 },
        ],
        neighborhood: {
          nodes: [
            { id: "inv", path: "src/invoices.ts", label: "src/invoices.ts", changed: true },
            { id: "auth", path: "src/auth.ts", label: "src/auth.ts", changed: true },
          ],
          edges: [],
        },
      },
    }} />);
    expect(screen.getByRole("heading", { name: /recommended reading order/i })).toBeInTheDocument();
    const order = screen.getByRole("list", { name: "Recommended reading order" });
    expect(order).toHaveTextContent("invoices.ts");
    expect(order).toHaveTextContent("+40");
    const files = screen.getByRole("list", { name: "Changed files" });
    expect(files).toHaveTextContent("auth.ts");
    expect(files).toHaveTextContent("+3");
  });

  it("outlines reading-order and changed-file rows for the selected path", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        startHere: [{ path: "src/invoices.ts", symbol: "exportCsv", why: "entry" }],
        changedFiles: [
          { path: "src/invoices.ts", linesAdded: 40, linesRemoved: 2 },
          { path: "src/auth.ts", linesAdded: 3, linesRemoved: 0 },
        ],
        neighborhood: {
          nodes: [
            { id: "inv", path: "src/invoices.ts", label: "src/invoices.ts", changed: true },
            { id: "auth", path: "src/auth.ts", label: "src/auth.ts", changed: true },
          ],
          edges: [],
        },
      },
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "invoices.ts" }));
    const order = screen.getByRole("list", { name: "Recommended reading order" });
    const files = screen.getByRole("list", { name: "Changed files" });
    const orderRow = [...order.querySelectorAll("li")].find((li) => li.textContent?.includes("invoices.ts"));
    const invoicesFile = [...files.querySelectorAll("li")].find((li) => li.textContent?.includes("invoices.ts"));
    const authFile = [...files.querySelectorAll("li")].find((li) => li.textContent?.includes("auth.ts"));
    expect(orderRow?.className).toMatch(/outline|ring|forest/i);
    expect(invoicesFile?.className).toMatch(/outline|ring|forest/i);
    expect(authFile?.className).not.toMatch(/outline|ring|forest/i);
  });

  it("map event dismisses overlay and shows the brass bar while running", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      render(<RunView run={{
        ...blockRun,
        id: "live-map",
        status: "queued",
        verdict: undefined,
        map: undefined,
      }} />);
      expect(screen.getByRole("status")).toBeInTheDocument();
      FakeEventSource.latest?.emit("map", blockRun.map);
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.getByRole("region", { name: "PR import neighborhood" })).toBeInTheDocument();
      }, { timeout: 1500 });
      const bar = document.querySelector("main div.h-\\[3px\\].bg-\\[var\\(--desk-brass\\)\\]");
      expect(bar).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("updates the surface headline after map without a full reload", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/runs/live-title");
      return new Response(JSON.stringify({
        ...blockRun,
        id: "live-title",
        status: "running",
        headline: {
          title: "Add regex filters",
          subtitle: "jaegertracing/jaeger · #9923",
          githubUrl: "https://github.com/jaegertracing/jaeger/pull/9923",
        },
      }), { headers: { "content-type": "application/json" } });
    });
    try {
      render(<RunView run={{
        ...blockRun,
        id: "live-title",
        status: "queued",
        verdict: undefined,
        map: undefined,
        headline: {
          title: "https://github.com/jaegertracing/jaeger/pull/9923",
          subtitle: "jaegertracing/jaeger · #9923",
          githubUrl: "https://github.com/jaegertracing/jaeger/pull/9923",
        },
      }} />);
      FakeEventSource.latest?.emit("map", blockRun.map);
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Add regex filters" })).toBeInTheDocument();
      }, { timeout: 1500 });
      expect(screen.getByRole("link", { name: "View on GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/jaegertracing/jaeger/pull/9923",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("selected canvas node uses a forest border without a forest fill", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        neighborhood: {
          nodes: [
            { id: "a", path: "src/auth.ts", label: "src/auth.ts", changed: true },
            { id: "b", path: "src/invoices.ts", label: "src/invoices.ts", changed: true },
          ],
          edges: [{ from: "a", to: "b", kind: "import" }],
        },
      },
    }} />);
    const auth = screen.getByRole("button", { name: "auth.ts" });
    fireEvent.click(auth);
    expect(auth.style.border).toContain("var(--desk-forest)");
    expect(auth.style.background).not.toBe("var(--desk-forest)");
  });

  it("pins mermaid-only nodes by path suffix or node id", () => {
    render(<RunView run={{
      ...blockRun,
      map: {
        ...blockRun.map!,
        neighborhood: undefined,
        mermaid: [
          "graph TD",
          '  src_auth_ts["auth.ts"]',
          '  src_invoices_ts["invoices.ts"]',
          "  src_auth_ts --> src_invoices_ts",
        ].join("\n"),
      },
      verdict: {
        ...blockRun.verdict!,
        stamp: "FIX",
        displayStamp: "Cited exceptions",
        findings: [
          {
            id: "f0",
            kind: "secret",
            severity: "high",
            confidence: 0.9,
            title: "AWS key",
            body: "regex",
            evidence: [{ kind: "file", path: "src/auth.ts", startLine: 2, quote: "AKIAIOSFODNN7EXAMPLE" }],
            model: "regex",
            cited: true,
          },
          {
            id: "f1",
            kind: "scope_drift",
            severity: "medium",
            confidence: 0.4,
            title: "CSV export extra columns",
            body: "scope",
            evidence: [{ kind: "file", path: "src/invoices.ts", startLine: 10, quote: "exportCsv" }],
            model: "nvidia/nemotron-3-super-120b-a12b",
            cited: true,
          },
          {
            id: "f2",
            kind: "looks_right_logic",
            severity: "medium",
            confidence: 0.4,
            title: "Node id pin",
            body: "graph",
            evidence: [{ kind: "graph", nodeId: "src_auth_ts", quote: "auth neighborhood" }],
            model: "lightning",
            cited: true,
          },
        ],
      },
    }} />);
    const auth = screen.getByRole("button", { name: "auth.ts" });
    const pin = [...auth.querySelectorAll("span")].find((span) => span.style.width === "7px");
    expect(pin).toBeTruthy();
    fireEvent.click(auth);
    expect(screen.getByText(/Findings · pinned to auth\.ts/i)).toBeInTheDocument();
    const secret = screen.getByText("AWS key").closest("li");
    const nodeIdPin = screen.getByText("Node id pin").closest("li");
    const drift = screen.getByText("CSV export extra columns").closest("li");
    expect(secret?.className).toMatch(/outline|ring|forest/i);
    expect(nodeIdPin?.className).toMatch(/outline|ring|forest/i);
    expect(drift?.className).toMatch(/opacity/);
  });

  it("waxes the failing step after map and hides the brass bar", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      render(<RunView run={{
        ...blockRun,
        id: "err-after-map",
        status: "queued",
        verdict: undefined,
        map: undefined,
      }} />);
      FakeEventSource.latest?.emit("map", blockRun.map);
      FakeEventSource.latest?.emit("step", { name: "Tavily", detail: "failed" });
      FakeEventSource.latest?.emit("error", { code: "run_failed", message: "tavily exploded" });
      await waitFor(() => {
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent("tavily exploded");
      }, { timeout: 1500 });
      const items = [...screen.getByRole("list", { name: "Desk steps" }).querySelectorAll("li")];
      expect(items[0]?.querySelector(".bg-\\[var\\(--desk-forest\\)\\]")).not.toBeNull();
      expect(items[3]?.querySelector(".bg-\\[var\\(--desk-forest\\)\\]")).not.toBeNull();
      expect(items[5]?.textContent).toContain("Tavily");
      expect(items[5]?.querySelector(".bg-\\[var\\(--desk-wax\\)\\]")).not.toBeNull();
      expect(items[0]?.querySelector(".bg-\\[var\\(--desk-wax\\)\\]")).toBeNull();
      expect(document.querySelector("main div.h-\\[3px\\].bg-\\[var\\(--desk-brass\\)\\]")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
