import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/runs/route";
import { allowPost, resetRateLimit } from "@/server/runs";

afterEach(() => {
  resetRateLimit();
});

describe("rateLimit", () => {
  it("allows 20 posts per IP per hour then denies", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 20; i++) expect(allowPost(ip, 0)).toBe(true);
    expect(allowPost(ip, 0)).toBe(false);
    expect(allowPost(ip, 3_600_001)).toBe(true);
  });

  it("429 posts over 20 per hour per IP", async () => {
    const ip = "203.0.113.10";
    const now = Date.now();
    for (let i = 0; i < 20; i++) expect(allowPost(ip, now)).toBe(true);
    const res = await POST(
      new Request("http://x/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ fixtureId: "fixture-ship" }),
      }),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: "rate_limited" });
  });
});
