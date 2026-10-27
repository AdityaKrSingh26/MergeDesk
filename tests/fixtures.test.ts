import { describe, expect, it } from "vitest";
import { loadFixture, findSecrets } from "@/server/ingest";

describe("fixtures", () => {
  it("BLOCK patch contains a regex secret", () => {
    const f = loadFixture("fixture-block");
    expect(findSecrets(f.diff).length).toBeGreaterThan(0);
    expect(f.meta.intendedStamp).toBe("BLOCK");
  });
  it("BLOCK diff imports foo_payments_sdk", () => {
    const f = loadFixture("fixture-block");
    expect(f.diff).toContain("foo_payments_sdk");
  });
  it("FIX patch has no secret hits", () => {
    const f = loadFixture("fixture-fix");
    expect(findSecrets(f.diff)).toEqual([]);
    expect(f.meta.intendedStamp).toBe("FIX");
  });
  it("SHIP patch has no secret hits and a test file", () => {
    const f = loadFixture("fixture-ship");
    expect(findSecrets(f.diff)).toEqual([]);
    expect(f.diff).toMatch(/test/i);
  });
});
