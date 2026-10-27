import { afterEach, describe, expect, it } from "vitest";
import {
  findingFromSuperVl,
  loadLiveModels,
  MODELS,
  resetLiveModelsCache,
  resolveModelId,
  shouldCallUltra,
  ultraWorstCaseUsd,
  type ChatClient,
} from "@/server/llm";
import { startRun, waitRun } from "@/server/runs";
import { IMAGE_NOT_HEAD } from "@/server/shared";
import { POST } from "@/app/api/runs/route";

const origNebius = process.env.NEBIUS_API_KEY;
const origTavily = process.env.TAVILY_API_KEY;
const origCap = process.env.MERGEDESK_SPEND_CAP_USD;

afterEach(() => {
  if (origNebius === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = origNebius;
  if (origTavily === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = origTavily;
  if (origCap === undefined) delete process.env.MERGEDESK_SPEND_CAP_USD;
  else process.env.MERGEDESK_SPEND_CAP_USD = origCap;
});

function fakeUsage(promptTokens = 10, completionTokens = 2) {
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, prompt_tokens_details: { cached_tokens: 0 } };
}

function lowConfidenceSuper() {
  return {
    startHere: [],
    concerns: [],
    functions: [],
    mermaid: "graph TD; a;",
    findings: [
      {
        kind: "looks_right_logic",
        severity: "high",
        confidence: 0.4,
        title: "retry",
        body: "loop",
        evidence: [{ kind: "file", path: "src/http.ts", startLine: 1, quote: "retry" }],
      },
    ],
    residualNotes: [],
    proposedStamp: "FIX",
  };
}

function trackingChat(models: string[], usage = fakeUsage()): ChatClient {
  return {
    chat: {
      completions: {
        create: async (body) => {
          models.push(body.model);
          const content =
            body.model === MODELS.lightning
              ? JSON.stringify({ claims: [] })
              : body.model === MODELS.superVl
                ? JSON.stringify({ contradicts: true, quote: "expected 200 got 500", confidence: 0.7 })
                : JSON.stringify(lowConfidenceSuper());
          return { choices: [{ message: { content } }], usage };
        },
      },
    },
  };
}

describe("ultraSkip", () => {
  it("skips Ultra when spend plus worst case exceeds 0.12", () => {
    const cap = 0.12;
    const usdSoFar = cap - ultraWorstCaseUsd() + 0.001;
    const r = shouldCallUltra({
      findings: [{ confidence: 0.1, kind: "looks_right_logic" }],
      proposedStamp: "FIX",
      usdSoFar,
      capUsd: cap,
    });
    expect(r.call).toBe(false);
  });

  it("calls Ultra when confidence is below 0.55 and budget remains", () => {
    const r = shouldCallUltra({
      findings: [{ confidence: 0.4, kind: "looks_right_logic" }],
      proposedStamp: "FIX",
      usdSoFar: 0,
      capUsd: 0.12,
    });
    expect(r.call).toBe(true);
  });

  it("calls Ultra when Super JSON failed to parse even if remaining findings are high-confidence", () => {
    const r = shouldCallUltra({
      findings: [{ confidence: 1, kind: "invented_surface" }],
      usdSoFar: 0,
      capUsd: 0.12,
      modelParseFailed: true,
    });
    expect(r.call).toBe(true);
  });

  it("still skips Ultra on budget when Super JSON failed to parse", () => {
    const cap = 0.12;
    const r = shouldCallUltra({
      findings: [],
      usdSoFar: cap - ultraWorstCaseUsd() + 0.001,
      capUsd: cap,
      modelParseFailed: true,
    });
    expect(r.call).toBe(false);
    expect(r.reason).toBe("budget_capped");
  });

  it("turns a Super VL payload into a finding whose quote starts with the HEAD caveat", () => {
    const finding = findingFromSuperVl({
      contradicts: true,
      quote: "expected 200 got 500",
      confidence: 0.7,
    });
    expect(finding?.kind).toBe("visual_contradiction");
    expect(finding?.evidence[0]?.quote.startsWith("image not proven to be this commit.")).toBe(true);
    expect(finding?.evidence[0]?.quote.startsWith(IMAGE_NOT_HEAD)).toBe(true);
  });

  it("skips Ultra and sets coverage.timedOut when elapsed exceeds 240s", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const models: string[] = [];
    const now = (() => {
      let t = 0;
      return () => {
        t += 241_000;
        return t;
      };
    })();
    const { id } = await startRun(
      { kind: "fixture", fixtureId: "fixture-fix" },
      { chat: trackingChat(models), now },
    );
    const run = await waitRun(id, 5_000);
    expect(models).not.toContain(MODELS.ultra);
    expect(run.coverage.timedOut).toBe(true);
  });

  it("does not cache a failed catalog probe", async () => {
    resetLiveModelsCache();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return new Response("no", { status: 503 });
      return new Response(JSON.stringify({ data: [{ id: MODELS.lightning }] }), { status: 200 });
    };
    const first = await loadLiveModels(fetchImpl);
    const second = await loadLiveModels(fetchImpl);
    expect(first).toEqual([]);
    expect(second).toEqual([{ id: MODELS.lightning }]);
    expect(calls).toBe(2);
    resetLiveModelsCache();
  });

  it("falls back to Nano when Lightning is missing from the live list", () => {
    expect(resolveModelId(MODELS.lightning, [{ id: MODELS.nano }])).toBe(MODELS.nano);
    expect(resolveModelId(MODELS.lightning, [{ id: MODELS.lightning }, { id: MODELS.nano }])).toBe(
      MODELS.lightning,
    );
  });

  it("calls Ultra and keeps modelParseFailed when Super JSON is invalid twice", async () => {
    process.env.NEBIUS_API_KEY = "test";
    delete process.env.TAVILY_API_KEY;
    const models: string[] = [];
    const chat: ChatClient = {
      chat: {
        completions: {
          create: async (body) => {
            models.push(body.model);
            const content =
              body.model === MODELS.lightning
                ? JSON.stringify({ claims: [] })
                : body.model === MODELS.ultra
                  ? JSON.stringify(lowConfidenceSuper())
                  : "not-json";
            return { choices: [{ message: { content } }], usage: fakeUsage() };
          },
        },
      },
    };
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-ship" }, { chat });
    const run = await waitRun(id, 5_000);
    expect(models.filter((m) => m === MODELS.super).length).toBe(2);
    expect(models).toContain(MODELS.ultra);
    expect(run.modelParseFailed).toBe(true);
    expect(run.verdict?.findings.some((f) => f.kind === "looks_right_logic")).toBe(true);
    expect(run.verdict?.stamp).toBe("FIX");
  });

  it("calls Ultra when Super confidence is low and time remains", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const models: string[] = [];
    const { id } = await startRun(
      { kind: "fixture", fixtureId: "fixture-fix" },
      { chat: trackingChat(models) },
    );
    const run = await waitRun(id, 5_000);
    expect(models).toContain(MODELS.ultra);
    expect(run.coverage.timedOut).toBe(false);
  });

  it("sets budgetCapped and skips Ultra when Super spend plus worst case exceeds the cap", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const models: string[] = [];
    const { id } = await startRun(
      { kind: "fixture", fixtureId: "fixture-fix" },
      { chat: trackingChat(models, fakeUsage(400_000, 100_000)) },
    );
    const run = await waitRun(id, 5_000);
    expect(models).not.toContain(MODELS.ultra);
    expect(run.coverage.budgetCapped).toBe(true);
  });

  it("emits visual_contradiction from Super VL when the PR has 1–3 images", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const models: string[] = [];
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    const { id } = await startRun(
      { kind: "pr", prUrl: "https://github.com/acme/w/pull/9" },
      {
        githubFetch: async (url) => {
          const u = String(url);
          if (u.endsWith("/pulls/9")) {
            return json({
              title: "t",
              body: "see ![ci](https://example.com/ci-fail.png)",
              head: { sha: "abc123" },
              base: { repo: { private: false } },
            });
          }
          if (u.includes("/pulls/9/files")) {
            return json([
              {
                filename: "src/a.ts",
                patch: "@@ -0,0 +1 @@\n+export const a = 1;\n",
                status: "added",
              },
            ]);
          }
          return json({}, 404);
        },
        snapshot: async () => ({ ok: false, code: "tarball_too_large" as const }),
        chat: trackingChat(models),
      },
    );
    const run = await waitRun(id, 5_000);
    expect(models).toContain(MODELS.superVl);
    const vis = run.verdict?.findings.find((f) => f.kind === "visual_contradiction");
    expect(vis?.evidence[0]?.quote.startsWith("image not proven to be this commit.")).toBe(true);
    expect(run.verdict?.stamp).toBe("FIX");
  });

  it("waitRun marks timedOut when the wait budget expires on a still-running run", async () => {
    process.env.NEBIUS_API_KEY = "test";
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chat: ChatClient = {
      chat: {
        completions: {
          create: async () => {
            await held;
            return {
              choices: [{ message: { content: JSON.stringify({ claims: [] }) } }],
              usage: fakeUsage(),
            };
          },
        },
      },
    };
    const { id } = await startRun({ kind: "fixture", fixtureId: "fixture-ship" }, { chat });
    const run = await waitRun(id, 0);
    expect(run.coverage.timedOut).toBe(true);
    expect(run.status).not.toBe("done");
    release();
    await waitRun(id, 5_000);
  });
});
