import { describe, expect, it } from "vitest";
import { parsePrUrl } from "@/server/ingest";

describe("parsePrUrl", () => {
  it("extracts owner, repo, number from a github.com PR URL", () => {
    expect(parsePrUrl("https://github.com/acme/widget/pull/42")).toEqual({
      owner: "acme",
      repo: "widget",
      number: 42,
    });
  });
  it("accepts a trailing slash", () => {
    expect(parsePrUrl("https://github.com/acme/widget/pull/42/")).toEqual({
      owner: "acme",
      repo: "widget",
      number: 42,
    });
  });
  it("returns pr_not_found for a non-PR URL", () => {
    expect(parsePrUrl("https://github.com/acme/widget")).toEqual({
      error: "pr_not_found",
    });
  });
  it("returns pr_not_found for empty input", () => {
    expect(parsePrUrl("")).toEqual({ error: "pr_not_found" });
  });
});
