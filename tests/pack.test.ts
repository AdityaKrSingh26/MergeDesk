import { describe, expect, it } from "vitest";
import { approxTokens, packContext } from "@/server/llm";

describe("approxTokens", () => {
  it("is ceil(chars/4)", () => {
    expect(approxTokens("abcd")).toBe(1);
    expect(approxTokens("abcde")).toBe(2);
  });
});

describe("packContext", () => {
  it("sets packTruncated when a section exceeds budget", () => {
    const issue = "x".repeat(10_000);
    const { pack, packTruncated } = packContext({
      issue,
      patch: "diff --git a/a.ts b/a.ts\n+ok\n",
      repoMap: "map",
      neighbors: "n",
      tavily: "",
    });
    expect(packTruncated).toBe(true);
    expect(pack.truncated).toBe(true);
    expect(approxTokens(pack.issue)).toBeLessThanOrEqual(2000);
  });

  it("keeps diff --git headers when truncating a large patch", () => {
    const files = Array.from({ length: 30 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n+++ b/f${i}.ts\n+${"y".repeat(2000)}\n`).join("");
    const { pack } = packContext({ issue: "i", patch: files, repoMap: "", neighbors: "", tavily: "" });
    expect(pack.patch).toContain("diff --git a/f0.ts");
  });
});
