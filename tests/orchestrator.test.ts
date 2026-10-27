import { afterEach, describe, expect, it } from "vitest";
import { tavilyHitsLabel } from "@/server/shared";
import { startRun, store, waitRun } from "@/server/runs";
import { MODELS, type ChatClient } from "@/server/llm";

const origNebius = process.env.NEBIUS_API_KEY;
const origTavily = process.env.TAVILY_API_KEY;

afterEach(() => {
  if (origNebius === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = origNebius;
  if (origTavily === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = origTavily;
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function fakeSuperEmpty(): ChatClient {
  return {
    chat: {
      completions: {
        create: async (body) => {
          const content =
            body.model === MODELS.lightning
              ? JSON.stringify({ claims: [] })
              : JSON.stringify({
                  startHere: [],
                  concerns: [],
                  functions: [],
                  mermaid: "graph TD; a;",
                  findings: [],
                  residualNotes: [],
                  proposedStamp: "SHIP",
                });
          return {
            choices: [{ message: { content } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          };
        },
      },
    },
  };
}

function fakeSuperThatReturnsInventedSurface(): ChatClient {
  return {
    chat: {
      completions: {
        create: async (body) => {
          const content =
            body.model === MODELS.lightning
              ? JSON.stringify({
                  claims: [
                    { type: "package", query: "foo_payments_sdk", packageName: "foo_payments_sdk" },
                  ],
                })
              : JSON.stringify({
                  startHere: [
                    { path: "src/invoices.ts", symbol: "exportInvoicesCsv", why: "CSV export" },
                  ],
                  concerns: [{ name: "invented package", paths: ["src/invoices.ts"] }],
                  functions: [
                    { name: "exportInvoicesCsv", path: "src/invoices.ts", job: "write invoice CSV" },
                  ],
                  mermaid: "graph TD; a;",
                  findings: [
                    {
                      kind: "invented_surface",
                      severity: "high",
                      confidence: 0.8,
                      title: "Unknown package foo_payments_sdk",
                      body: "import of foo_payments_sdk",
                      evidence: [
                        {
                          kind: "file",
                          path: "src/invoices.ts",
                          startLine: 1,
                          quote: 'import { FooPayments } from "foo_payments_sdk";',
                        },
                      ],
                    },
                  ],
                  residualNotes: [],
                  proposedStamp: "FIX",
                });
          return {
            choices: [{ message: { content } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          };
        },
      },
    },
  };
}

describe("orchestrator", () => {
  it("BLOCK fixture with mocked Tavily 0-hit and no TF key uses Replay and still gates a secret to BLOCK", async () => {
    delete process.env.NEBIUS_API_KEY;
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-block" });
    const run = await waitRun(id, 5_000);
    expect(run.source).toBe("replay");
    expect(run.verdict?.stamp).toBe("BLOCK");
  });

  it("with fake chat + tavily, fixture-block source is fixture and invented_surface is FIX-class in findings alongside secret", async () => {
    process.env.NEBIUS_API_KEY = "test";
    process.env.TAVILY_API_KEY = "test";
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-block" }, {
      chat: fakeSuperThatReturnsInventedSurface(),
      tavilyFetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    const run = await waitRun(id, 5_000);
    expect(run.source).toBe("fixture");
    expect(run.verdict?.stamp).toBe("BLOCK");
    expect(run.verdict?.findings.some((f) => f.kind === "invented_surface")).toBe(true);
    expect(run.verdict?.findings.find((f) => f.kind === "invented_surface")?.evidence[0].kind).toBe("tavily");
  });

  it("sets snapshot patch-only when tarball extract fails and still gates secrets on the patch", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const { id } = await startRun({ kind: "pr", prUrl: "https://github.com/acme/w/pull/9" }, {
      githubFetch: async (url) => {
        const u = String(url);
        if (u.endsWith("/pulls/9")) {
          return json({
            title: "t",
            body: "see ![ci](https://example.com/ci-fail.png) and ![x](https://example.com/a.jpg)",
            head: { sha: "abc123" },
          });
        }
        if (u.includes("/pulls/9/files")) {
          return json([{
            filename: "src/a.ts",
            patch: "@@ -0,0 +1 @@\n+export const key = \"AKIAIOSFODNN7EXAMPLE\";\n",
            status: "added",
          }]);
        }
        return json({}, 404);
      },
      snapshot: async () => ({ ok: false, code: "tarball_too_large" as const }),
      chat: fakeSuperEmpty(),
      tavilyFetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    const run = await waitRun(id, 5_000);
    expect(run.coverage.snapshot).toBe("patch-only");
    expect(run.verdict?.stamp).toBe("BLOCK");
  });

  it("sets snapshot patch-only when tarball fetch throws and still gates secrets", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const { id } = await startRun({ kind: "pr", prUrl: "https://github.com/acme/w/pull/9" }, {
      githubFetch: async (url) => {
        const u = String(url);
        if (u.endsWith("/pulls/9")) {
          return json({
            title: "t",
            body: "",
            head: { sha: "abc123" },
            base: { repo: { private: false } },
          });
        }
        if (u.includes("/pulls/9/files")) {
          return json([{
            filename: "src/a.ts",
            patch: "@@ -0,0 +1 @@\n+export const key = \"AKIAIOSFODNN7EXAMPLE\";\n",
            status: "added",
          }]);
        }
        throw new Error("network down");
      },
      chat: fakeSuperEmpty(),
      tavilyFetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    const run = await waitRun(id, 5_000);
    expect(run.status).toBe("done");
    expect(run.coverage.snapshot).toBe("patch-only");
    expect(run.verdict?.stamp).toBe("BLOCK");
  });

  it("drops a Super secret so fixture-ship does not BLOCK", async () => {
    process.env.NEBIUS_API_KEY = "test";
    delete process.env.TAVILY_API_KEY;
    const chat: ChatClient = {
      chat: {
        completions: {
          create: async (body) => ({
            choices: [{
              message: {
                content:
                  body.model === MODELS.lightning
                    ? JSON.stringify({ claims: [] })
                    : JSON.stringify({
                        startHere: [],
                        concerns: [],
                        functions: [],
                        mermaid: "graph TD; a;",
                        findings: [{
                          kind: "secret",
                          severity: "high",
                          confidence: 0.99,
                          title: "model secret",
                          body: "claimed key",
                          evidence: [{ kind: "file", path: "src/math.ts", startLine: 1, quote: "AKIAIOSFODNN7EXAMPLE" }],
                        }],
                        residualNotes: [],
                        proposedStamp: "BLOCK",
                      }),
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } },
          }),
        },
      },
    };
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-ship" }, { chat });
    const run = await waitRun(id, 5_000);
    expect(run.verdict?.stamp).not.toBe("BLOCK");
    expect(run.verdict?.findings.some((f) => f.kind === "secret")).toBe(false);
  });

  it("seeds invented_surface from import names when Super is empty and Tavily is 0-hit", async () => {
    process.env.NEBIUS_API_KEY = "test";
    process.env.TAVILY_API_KEY = "test";
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-block" }, {
      chat: fakeSuperEmpty(),
      tavilyFetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    const run = await waitRun(id, 5_000);
    const invented = run.verdict?.findings.find((f) => f.kind === "invented_surface");
    expect(invented).toBeTruthy();
    expect(invented?.evidence.some((e) => e.kind === "tavily")).toBe(true);
    expect(invented?.evidence.find((e) => e.kind === "tavily")?.quote).toBe(tavilyHitsLabel(0));
    expect(run.verdict?.findings.some((f) => f.kind === "secret" && f.model === "regex")).toBe(true);
    expect(run.verdict?.stamp).toBe("BLOCK");
  });

  it("does not seed or keep invented_surface when Tavily returns hits", async () => {
    process.env.NEBIUS_API_KEY = "test";
    process.env.TAVILY_API_KEY = "test";
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-block" }, {
      chat: fakeSuperThatReturnsInventedSurface(),
      tavilyFetch: async () => new Response(JSON.stringify({
        results: [
          { url: "https://www.npmjs.com/package/foo_payments_sdk", content: "pkg" },
          { url: "https://example.com/2", content: "b" },
          { url: "https://example.com/3", content: "c" },
        ],
      }), { status: 200 }),
    });
    const run = await waitRun(id, 5_000);
    expect(run.coverage.tavily).toBe("ok");
    expect(run.verdict?.findings.some((f) => f.kind === "invented_surface")).toBe(false);
    expect(run.verdict?.stamp).toBe("BLOCK");
  });

  it("replay keeps a recorded tavily ok so the prebaked invented_surface survives", async () => {
    delete process.env.NEBIUS_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-block" });
    const run = await waitRun(id, 5_000);
    expect(run.source).toBe("replay");
    expect(run.coverage.tavily).toBe("ok");
    expect(run.verdict?.findings.some((f) => f.kind === "invented_surface")).toBe(true);
    expect(run.verdict?.stamp).toBe("BLOCK");
  });

  it("fills startHere from changed Go files when Super returns a blank seed", async () => {
    process.env.NEBIUS_API_KEY = "test";
    delete process.env.TAVILY_API_KEY;
    const chat: ChatClient = {
      chat: {
        completions: {
          create: async (body) => ({
            choices: [{
              message: {
                content:
                  body.model === MODELS.lightning
                    ? JSON.stringify({ claims: [] })
                    : JSON.stringify({
                        startHere: [{ path: "", symbol: "", why: "Started review at the root of the repository." }],
                        concerns: [],
                        functions: [],
                        mermaid: "graph TD; a;",
                        findings: [],
                        residualNotes: [],
                        proposedStamp: "SHIP",
                      }),
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } },
          }),
        },
      },
    };
    const { id } = await startRun({
      kind: "paste",
      issue: "Honor regex anchors",
      diff: [
        "diff --git a/internal/regex.go b/internal/regex.go",
        "--- a/internal/regex.go",
        "+++ b/internal/regex.go",
        "@@ -0,0 +1,2 @@",
        "+package regex",
        "+func Lower() {}",
      ].join("\n"),
    }, { chat });
    const run = await waitRun(id, 5_000);
    expect(run.status).toBe("done");
    expect(run.map?.size.languages.go).toBe(1);
    expect(run.map?.startHere.some((item) => item.path === "internal/regex.go")).toBe(true);
    expect(run.map?.startHere.some((item) => item.path === "")).toBe(false);
  });

  it("paste is a live patch-only run and still blocks on AKIA", async () => {
    delete process.env.NEBIUS_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const { id } = await startRun({
      kind: "paste",
      issue: "rotate the key",
      diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+export const key = \"AKIAIOSFODNN7EXAMPLE\";\n",
    });
    const run = await waitRun(id, 5_000);
    expect(run.source).toBe("live");
    expect(run.coverage.snapshot).toBe("patch-only");
    expect(run.verdict?.stamp).toBe("BLOCK");
    expect(run.verdict?.findings.some((f) => f.kind === "secret" && f.model === "regex")).toBe(true);
  });

  it("fixture replay map includes neighborhood, changedFiles, and headline", async () => {
    delete process.env.NEBIUS_API_KEY;
    const { id, done } = await startRun({ kind: "fixture", fixtureId: "fixture-ship" });
    await done;
    const run = store.get(id);
    expect(run?.headline?.title).toBe("Add clamp() helper and unit test");
    expect(run?.headline?.subtitle).toMatch(/Fixture|Replay/);
    expect(run?.map?.neighborhood?.nodes.some((n) => n.path === "src/clamp.ts")).toBe(true);
    expect(run?.map?.changedFiles?.some((f) => f.path === "src/clamp.ts" && f.linesAdded > 0)).toBe(true);
  });
});
