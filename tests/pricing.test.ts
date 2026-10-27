import { describe, expect, it } from "vitest";
import { HACKATHON_DISPLAY_RATES, MODELS, ultraWorstCaseUsd, usdEstimate } from "@/server/llm";

describe("usdEstimate", () => {
  it("prices 1M Lightning input tokens at $0.06", () => {
    expect(usdEstimate({ model: MODELS.lightning, promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 0 })).toBeCloseTo(0.06, 8);
  });
  it("prices Ultra cached input at $0.12 per 1M", () => {
    expect(usdEstimate({ model: MODELS.ultra, promptTokens: 0, completionTokens: 0, cachedTokens: 1_000_000 })).toBeCloseTo(0.12, 8);
  });
  it("prices Super output at $0.90 per 1M", () => {
    expect(usdEstimate({ model: MODELS.super, promptTokens: 0, completionTokens: 1_000_000, cachedTokens: 0 })).toBeCloseTo(0.90, 8);
  });
  it("exposes HACKATHON_DISPLAY_RATES comment-backed table", () => {
    expect(HACKATHON_DISPLAY_RATES[MODELS.ultra].cachedIn).toBe(0.12);
  });
  it("ultraWorstCaseUsd is finite and greater than zero", () => {
    expect(ultraWorstCaseUsd()).toBeGreaterThan(0);
  });
});
