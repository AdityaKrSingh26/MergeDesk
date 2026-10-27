import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("README", () => {
  it("README names Token Factory, advisory stamps, and Tavily", () => {
    const r = readFileSync("README.md", "utf8");
    expect(r).toMatch(/Token Factory/);
    expect(r).toMatch(/advisory/i);
    expect(r).toMatch(/Tavily/);
    expect(r).toMatch(/Nemotron/);
    expect(r).toMatch(/coverage/i);
  });
});
