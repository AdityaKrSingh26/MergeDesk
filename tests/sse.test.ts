import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/runs/[id]/events/route";
import { startRun, waitRun, store } from "@/server/runs";
import { MODELS, type ChatClient } from "@/server/llm";
import { makeCoverage } from "./helpers/coverage";
import { displayStamp } from "@/server/shared";
import type { Coverage, Run, Verdict } from "@/server/shared";

const origNebius = process.env.NEBIUS_API_KEY;
const origTavily = process.env.TAVILY_API_KEY;

afterEach(() => {
  if (origNebius === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = origNebius;
  if (origTavily === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = origTavily;
});

function fakeHeldChat(held: Promise<void>): ChatClient {
  return {
    chat: {
      completions: {
        create: async (body) => {
          await held;
          const content =
            body.model === MODELS.lightning
              ? JSON.stringify({
                  claims: [{ type: "package", query: "foo_payments_sdk", packageName: "foo_payments_sdk" }],
                })
              : JSON.stringify({
                  startHere: [],
                  concerns: [],
                  functions: [],
                  mermaid: "graph TD; a;",
                  findings: [
                    {
                      kind: "invented_surface",
                      severity: "high",
                      confidence: 0.8,
                      title: "Unknown package",
                      body: "foo_payments_sdk",
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
                });
          return {
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } },
          };
        },
      },
    },
  };
}

function parseSse(text: string): Array<{ event: string; data: string }> {
  const out: Array<{ event: string; data: string }> = [];
  for (const block of text.split("\n\n")) {
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (event) out.push({ event, data });
  }
  return out;
}

describe("sse", () => {
  it("sends verdict and done when the run is already done", async () => {
    delete process.env.NEBIUS_API_KEY;
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-block" });
    await waitRun(id, 5_000);
    const res = await GET(new Request(`http://x/api/runs/${id}/events`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    const names = events.map((e) => e.event);
    expect(names).toContain("map");
    expect(names).toContain("verdict");
    expect(names.at(-1)).toBe("done");
    const map = JSON.parse(events[0].data) as { mermaid?: string };
    expect(map.mermaid).toMatch(/graph/i);
    const coverage = JSON.parse(events[1].data) as Coverage;
    expect(coverage.parser).not.toBe("none");
    const verdict = JSON.parse(events[2].data) as Verdict;
    expect(verdict.stamp).toBe("BLOCK");
  });

  it("polls a running run and emits new steps then verdict and done", async () => {
    const id = "sse-running-1";
    const coverage = makeCoverage({ source: "fixture" });
    const running: Run = {
      id,
      status: "running",
      source: "fixture",
      coverage,
      ledger: [],
      createdAt: 0,
    };
    store.put(running);
    const res = await GET(new Request(`http://x/api/runs/${id}/events`), {
      params: Promise.resolve({ id }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const verdict: Verdict = {
      stamp: "BLOCK",
      displayStamp: displayStamp("BLOCK"),
      findings: [],
      residualNotes: [],
      coverage,
      ledger: [],
      usdEstimateTotal: 0,
    };
    setTimeout(() => {
      store.put({ ...running, status: "done", verdict });
    }, 50);
    const events = parseSse(await res.text());
    expect(events.map((e) => e.event)).toContain("verdict");
    expect(events.map((e) => e.event)).toContain("done");
  });

  it("in-flight SSE receives terminal coverage after tavily, then verdict and done", async () => {
    process.env.NEBIUS_API_KEY = "test";
    process.env.TAVILY_API_KEY = "test";
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { id } = await startRun(
      { kind: "fixture", fixtureId: "fixture-block" },
      {
        chat: fakeHeldChat(held),
        tavilyFetch: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
      },
    );
    const res = await GET(new Request(`http://x/api/runs/${id}/events`), {
      params: Promise.resolve({ id }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    release();
    const events = parseSse(await res.text());
    const names = events.map((e) => e.event);
    expect(names).toContain("verdict");
    expect(names.at(-1)).toBe("done");
    const coverages = events
      .filter((e) => e.event === "coverage")
      .map((e) => JSON.parse(e.data) as Coverage);
    expect(coverages.at(-1)?.tavily).toBe("ok");
  });
});
