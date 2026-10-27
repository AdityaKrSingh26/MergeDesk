import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/runs/route";
import { MODELS, type ChatClient } from "@/server/llm";
import { startRun, waitRun, recordLiveSpend, resetLiveSpend, wouldExceedDaily } from "@/server/runs";

const origNebius = process.env.NEBIUS_API_KEY;
const origTavily = process.env.TAVILY_API_KEY;
const origDaily = process.env.MERGEDESK_DAILY_SPEND_CAP_USD;

afterEach(() => {
  resetLiveSpend();
  if (origNebius === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = origNebius;
  if (origTavily === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = origTavily;
  if (origDaily === undefined) delete process.env.MERGEDESK_DAILY_SPEND_CAP_USD;
  else process.env.MERGEDESK_DAILY_SPEND_CAP_USD = origDaily;
});

function keyedFixtureChat(): ChatClient {
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
              prompt_tokens: 1_000_000,
              completion_tokens: 0,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          };
        },
      },
    },
  };
}

describe("spend", () => {
  it("429 live posts after daily cap; fixtures still allowed", async () => {
    resetLiveSpend();
    recordLiveSpend(8.01);
    expect(wouldExceedDaily(0.01, 8)).toBe(true);

    const live = await POST(
      new Request("http://x/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
        body: JSON.stringify({ prUrl: "https://github.com/acme/w/pull/9" }),
      }),
    );
    expect(live.status).toBe(429);
    expect(await live.json()).toEqual({ code: "spend_capped" });

    const fixture = await POST(
      new Request("http://x/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
        body: JSON.stringify({ fixtureId: "fixture-ship" }),
      }),
    );
    expect(fixture.status).toBe(202);
  });

  it("records keyed fixture Token Factory spend so a later live PR is capped", async () => {
    resetLiveSpend();
    process.env.NEBIUS_API_KEY = "test";
    delete process.env.TAVILY_API_KEY;
    process.env.MERGEDESK_DAILY_SPEND_CAP_USD = "0.0001";
    const { id } = await startRun(
      { kind: "fixture", fixtureId: "fixture-ship" },
      { chat: keyedFixtureChat() },
    );
    const run = await waitRun(id, 5_000);
    expect(run.source).toBe("fixture");
    expect(run.ledger.some((line) => !line.skipped)).toBe(true);
    expect(run.verdict?.usdEstimateTotal).toBeGreaterThan(0.0001);
    expect(wouldExceedDaily(0)).toBe(true);
  });
});
