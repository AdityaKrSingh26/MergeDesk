import { describe, expect, it } from "vitest";
import {
  approxTokens,
  createTokenFactoryClient,
  MODELS,
  parseModelJson,
  runSuper,
  runSuperVl,
  runTriage,
  runUltra,
  SYSTEM_PROMPT,
  wrapUntrusted,
} from "@/server/llm";
import { UNTRUSTED_PREAMBLE, type ContextPack } from "@/server/shared";

function emptyPack(): ContextPack {
  return {
    issue: "i",
    patch: "diff --git a/a.ts b/a.ts\n+x\n",
    repoMap: "",
    neighbors: "",
    tavily: "",
    truncated: false,
    approxTokens: { issue: 1, patch: 8, repoMap: 0, neighbors: 0, tavily: 0 },
  };
}

const VALID_SUPER = JSON.stringify({
  startHere: [],
  concerns: [],
  functions: [],
  mermaid: "graph TD; a;",
  findings: [],
  residualNotes: [],
  proposedStamp: "SHIP",
});

function fakeUsage() {
  return { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } };
}

describe("router", () => {
  it("retries Super once on invalid JSON then returns ok:false", async () => {
    let n = 0;
    const client = {
      chat: { completions: { create: async () => {
        n += 1;
        return { choices: [{ message: { content: "not-json" } }], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } } };
      } } },
    };
    const result = await runSuper({ pack: emptyPack(), client: client as never });
    expect(n).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("parseModelJson accepts proposedStamp but gate will ignore it", () => {
    const p = parseModelJson(JSON.stringify({
      startHere: [], concerns: [], functions: [], mermaid: "graph TD; a;",
      findings: [], residualNotes: [], proposedStamp: "BLOCK",
    }));
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.value.proposedStamp).toBe("BLOCK");
  });

  it("records a TokenLine per Super call with skipped:false", async () => {
    const client = {
      chat: { completions: { create: async () => ({
        choices: [{ message: { content: "not-json" } }],
        usage: fakeUsage(),
      }) } },
    };
    const result = await runSuper({ pack: emptyPack(), client: client as never });
    expect(result.ok).toBe(false);
    expect(result.ledger).toHaveLength(2);
    expect(result.ledger.every((line) => line.skipped === false)).toBe(true);
    expect(result.ledger.every((line) => line.model === MODELS.super)).toBe(true);
    expect(result.ledger[0].promptTokens).toBe(10);
    expect(result.ledger[0].completionTokens).toBe(2);
    expect(result.ledger[0].usdEstimate).toBeGreaterThan(0);
  });

  it("retries Super with thinking off and a 4096 completion cap", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let n = 0;
    const client = {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            bodies.push(body);
            n += 1;
            const content = n === 1 ? "not-json" : VALID_SUPER;
            return { choices: [{ message: { content } }], usage: fakeUsage() };
          },
        },
      },
    };
    const result = await runSuper({ pack: emptyPack(), client: client as never });
    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(bodies[0].max_tokens).toBeUndefined();
    expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[1].reasoning_budget).toBeUndefined();
    expect(bodies[1].extra_body).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(bodies[1].max_tokens).toBe(4096);
  });

  it("retries Ultra with thinking off after invalid JSON", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let n = 0;
    const client = {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            bodies.push(body);
            n += 1;
            const content = n === 1 ? "not-json" : VALID_SUPER;
            return { choices: [{ message: { content } }], usage: fakeUsage() };
          },
        },
      },
    };
    const result = await runUltra({ pack: emptyPack(), client: client as never });
    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].model).toBe(MODELS.ultra);
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[1].max_tokens).toBe(4096);
  });

  it("calls Super with thinking on, reasoning_budget 1024, and json_object", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = {
      chat: { completions: { create: async (body: Record<string, unknown>) => {
        bodies.push(body);
        return { choices: [{ message: { content: VALID_SUPER } }], usage: fakeUsage() };
      } } },
    };
    const result = await runSuper({ pack: emptyPack(), client: client as never });
    expect(result.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe(MODELS.super);
    expect(bodies[0].enable_thinking).toBeUndefined();
    expect(bodies[0].extra_body).toEqual({
      reasoning_budget: 1024,
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(bodies[0].reasoning_budget).toBe(1024);
    expect(bodies[0].response_format).toEqual({ type: "json_object" });
    const messages = bodies[0].messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(messages[1].content).toContain("The following is repository content");
  });

  it("clips Super prompt to 16_000 tokens", async () => {
    const pack = emptyPack();
    pack.neighbors = "n".repeat(100_000);
    pack.approxTokens.neighbors = approxTokens(pack.neighbors);
    let promptTokens = 0;
    const client = {
      chat: { completions: { create: async (body: { messages: Array<{ content: string }> }) => {
        promptTokens = approxTokens(body.messages.map((m) => m.content).join(""));
        return { choices: [{ message: { content: VALID_SUPER } }], usage: fakeUsage() };
      } } },
    };
    await runSuper({ pack, client: client as never });
    expect(promptTokens).toBeLessThanOrEqual(16_000);
  });

  it("runTriage uses Lightning with thinking off and clips to 4_000", async () => {
    const pack = emptyPack();
    pack.patch = `diff --git a/a.ts b/a.ts\n+${"x".repeat(40_000)}\n`;
    pack.approxTokens.patch = approxTokens(pack.patch);
    let promptTokens = 0;
    const bodies: Array<Record<string, unknown>> = [];
    const client = {
      chat: { completions: { create: async (body: { messages: Array<{ content: string }> } & Record<string, unknown>) => {
        bodies.push(body);
        promptTokens = approxTokens(body.messages.map((m) => m.content).join(""));
        return { choices: [{ message: { content: JSON.stringify({ claims: [] }) } }], usage: fakeUsage() };
      } } },
    };
    const result = await runTriage({ pack, client: client as never });
    expect(result.ok).toBe(true);
    expect(bodies[0].model).toBe(MODELS.lightning);
    expect(bodies[0].enable_thinking).toBeUndefined();
    expect(bodies[0].extra_body).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[0].reasoning_budget).toBeUndefined();
    expect(promptTokens).toBeLessThanOrEqual(4_000);
    expect(result.ledger).toHaveLength(1);
    expect(result.ledger[0].skipped).toBe(false);
    expect(result.ledger[0].model).toBe(MODELS.lightning);
  });

  it("retries a Lightning 404 once with Nano", async () => {
    const models: string[] = [];
    const client = {
      chat: {
        completions: {
          create: async (body: { model: string }) => {
            models.push(body.model);
            if (body.model === MODELS.lightning) throw { status: 404 };
            return {
              choices: [{ message: { content: JSON.stringify({ claims: [{ type: "package", query: "left-pad" }] }) } }],
              usage: fakeUsage(),
            };
          },
        },
      },
    };
    const result = await runTriage({ pack: emptyPack(), client: client as never });
    expect(models).toEqual([MODELS.lightning, MODELS.nano]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims[0]?.query).toBe("left-pad");
    expect(result.ledger[0]?.model).toBe(MODELS.nano);
  });

  it("does not retry when resolve already selected Nano", async () => {
    let calls = 0;
    const client = {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            throw { status: 404 };
          },
        },
      },
    };
    await expect(
      runTriage({
        pack: emptyPack(),
        client: client as never,
        liveList: [{ id: MODELS.nano }],
      }),
    ).rejects.toEqual({ status: 404 });
    expect(calls).toBe(1);
  });

  it("puts Super VL JSON hint outside wrapUntrusted and the issue inside it", async () => {
    let userContent: unknown;
    const client = {
      chat: {
        completions: {
          create: async (body: { messages: Array<{ content: unknown }> }) => {
            userContent = body.messages[1]?.content;
            return {
              choices: [{ message: { content: JSON.stringify({ contradicts: false, quote: "", confidence: 0 }) } }],
              usage: fakeUsage(),
            };
          },
        },
      },
    };
    const issue = "CI is red on invoices";
    await runSuperVl({
      issue,
      imageUrls: ["https://example.com/ci-fail.png"],
      client: client as never,
    });
    expect(Array.isArray(userContent)).toBe(true);
    const parts = userContent as Array<{ type: string; text?: string }>;
    const text = parts.find((p) => p.type === "text")?.text ?? "";
    const hintAt = text.indexOf('"contradicts"');
    const wrapAt = text.indexOf(UNTRUSTED_PREAMBLE);
    expect(hintAt).toBeGreaterThanOrEqual(0);
    expect(wrapAt).toBeGreaterThan(hintAt);
    expect(text.slice(0, wrapAt)).toContain('"quote"');
    expect(text.slice(0, wrapAt)).toContain('"confidence"');
    expect(text.slice(0, wrapAt)).not.toContain(issue);
    expect(text.slice(wrapAt)).toBe(wrapUntrusted("issue", issue));
  });

  it("createTokenFactoryClient uses NEBIUS_BASE_URL or the Token Factory default", () => {
    const prevBase = process.env.NEBIUS_BASE_URL;
    const prevKey = process.env.NEBIUS_API_KEY;
    delete process.env.NEBIUS_BASE_URL;
    process.env.NEBIUS_API_KEY = "test";
    const client = createTokenFactoryClient();
    expect(client.baseURL).toBe("https://api.tokenfactory.nebius.com/v1/");
    process.env.NEBIUS_BASE_URL = "https://example.test/v1/";
    const custom = createTokenFactoryClient();
    expect(custom.baseURL).toBe("https://example.test/v1/");
    if (prevBase === undefined) delete process.env.NEBIUS_BASE_URL;
    else process.env.NEBIUS_BASE_URL = prevBase;
    if (prevKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = prevKey;
  });
});
