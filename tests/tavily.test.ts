import { describe, expect, it } from "vitest";
import { tavilyHitsLabel } from "@/server/shared";
import { searchClaims } from "@/server/llm";

describe("searchClaims", () => {
  it("caps at 5 searches and forces search_depth basic", async () => {
    const calls: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    const claims = Array.from({ length: 9 }, (_, i) => ({ type: "package" as const, query: `pkg${i}`, packageName: `pkg${i}` }));
    await searchClaims(claims, fetchImpl);
    expect(calls).toHaveLength(5);
    expect(calls.every((c: { search_depth: string }) => c.search_depth === "basic")).toBe(true);
  });

  it("records 0-hit evidence", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ results: [] }), { status: 200 });
    const { evidence, status } = await searchClaims([{ type: "package", query: "foo_payments_sdk", packageName: "foo_payments_sdk" }], fetchImpl);
    expect(status).toBe("ok");
    expect(evidence[0].tavilyHits).toBe(0);
    expect(evidence[0].quote).toBe(tavilyHitsLabel(0));
  });

  it("marks failed on HTTP error", async () => {
    const fetchImpl = async () => new Response("nope", { status: 500 });
    const { status, evidence } = await searchClaims([{ type: "package", query: "x" }], fetchImpl);
    expect(status).toBe("failed");
    expect(evidence).toEqual([]);
  });

  it("marks failed when fetch throws", async () => {
    const fetchImpl = async () => {
      throw new Error("network");
    };
    const { status, evidence } = await searchClaims([{ type: "package", query: "x" }], fetchImpl);
    expect(status).toBe("failed");
    expect(evidence).toEqual([]);
  });

  it("sends query and max_results 3 without file bodies", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };
    await searchClaims([{ type: "package", query: "foo_payments_sdk", packageName: "foo_payments_sdk" }], fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      query: "foo_payments_sdk",
      search_depth: "basic",
      max_results: 3,
    });
    expect(Object.keys(calls[0]).sort()).toEqual(["max_results", "query", "search_depth"]);
    expect(JSON.stringify(calls[0])).not.toMatch(/diff --git|function |class |packageName/);
  });

  it("posts search with Bearer auth", async () => {
    const prev = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-test-key";
    try {
      const seen: { url: string; auth: string | null; method: string | undefined }[] = [];
      const fetchImpl = async (url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push({
          url,
          auth: headers.get("Authorization"),
          method: init?.method,
        });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      };
      await searchClaims([{ type: "package", query: "x" }], fetchImpl);
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe("https://api.tavily.com/search");
      expect(seen[0].method).toBe("POST");
      expect(seen[0].auth).toBe("Bearer tvly-test-key");
    } finally {
      if (prev === undefined) delete process.env.TAVILY_API_KEY;
      else process.env.TAVILY_API_KEY = prev;
    }
  });

  it("issues one extract when hits exist and needsExtract is true", async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes("/extract")) {
        return new Response(
          JSON.stringify({
            results: [{ url: "https://example.com/foo", raw_content: "extracted page" }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          results: [{ url: "https://example.com/foo", content: "snippet" }],
        }),
        { status: 200 },
      );
    };
    const { evidence, status } = await searchClaims(
      [
        { type: "package", query: "foo", packageName: "foo", needsExtract: true },
        { type: "package", query: "bar", packageName: "bar", needsExtract: true },
      ],
      fetchImpl,
    );
    expect(status).toBe("ok");
    expect(urls.filter((u) => u.includes("/search"))).toHaveLength(2);
    expect(urls.filter((u) => u.includes("/extract"))).toHaveLength(1);
    expect(urls).toContain("https://api.tavily.com/extract");
    expect(evidence[0].tavilyHits).toBe(1);
    expect(evidence[0].url).toBe("https://example.com/foo");
    expect(evidence[0].quote).toBe(tavilyHitsLabel(1));
  });
});
