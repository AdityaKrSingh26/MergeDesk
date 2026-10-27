import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/runs/route";
import { GET } from "@/app/api/runs/[id]/route";
import { waitRun } from "@/server/runs";

const origNebius = process.env.NEBIUS_API_KEY;
const origTavily = process.env.TAVILY_API_KEY;

afterEach(() => {
  if (origNebius === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = origNebius;
  if (origTavily === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = origTavily;
});

describe("api.runs", () => {
  it("GET fixture-block returns 200 with Replay source and BLOCK stamp", async () => {
    const res = await GET(new Request("http://x/api/runs/fixture-block"), { params: Promise.resolve({ id: "fixture-block" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("replay");
    expect(body.verdict.displayStamp).toBe("High-certainty exception");
  });

  it("POST fixtureId returns 202 with an id", async () => {
    delete process.env.NEBIUS_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const res = await POST(new Request("http://x/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId: "fixture-ship" }),
    }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("queued");
  });

  it("wait true fixture returns 200 when the run finishes", async () => {
    delete process.env.NEBIUS_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const res = await POST(
      new Request("http://x/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.99" },
        body: JSON.stringify({ fixtureId: "fixture-ship", wait: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
    expect(body.coverage.timedOut).toBe(false);
  });

  it("POST paste returns 202 with a stored id and a patch-only verdict", async () => {
    delete process.env.NEBIUS_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+export const a = 1;\n";
    const res = await POST(
      new Request("http://x/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({ issue: "add a", diff }),
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("queued");
    const run = await waitRun(body.id, 5_000);
    expect(run.source).toBe("live");
    expect(run.coverage.snapshot).toBe("patch-only");
    expect(run.verdict).toBeTruthy();
  });

  it("POST paste with an AKIA line blocks via regex", async () => {
    delete process.env.NEBIUS_API_KEY;
    delete process.env.TAVILY_API_KEY;
    const diff =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+export const key = \"AKIAIOSFODNN7EXAMPLE\";\n";
    const res = await POST(
      new Request("http://x/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.78" },
        body: JSON.stringify({ issue: "rotate", diff, wait: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coverage.snapshot).toBe("patch-only");
    expect(body.source).toBe("live");
    expect(body.verdict.stamp).toBe("BLOCK");
    expect(body.verdict.findings.some((f: { kind: string; model: string }) => f.kind === "secret" && f.model === "regex")).toBe(true);
  });
});
