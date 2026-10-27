import { describe, expect, it } from "vitest";
import { gate } from "@/server/verdict";
import { makeCoverage } from "./helpers/coverage";
import { tavilyHitsLabel } from "@/server/shared";

const fileEv = { kind: "file" as const, path: "a.ts", startLine: 1, quote: "const x = 1" };
const tavilyEv = { kind: "tavily" as const, quote: "foo_payments_sdk: 0 results", tavilyHits: 0, url: "https://tavily.example" };

describe("gate", () => {
  it("stamps BLOCK when a cited secret survives", () => {
    const v = gate({
      rawFindings: [{ kind: "secret", severity: "high", confidence: 0.9, title: "Key", body: "", evidence: [fileEv], model: "regex", cited: true }],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(v.stamp).toBe("BLOCK");
    expect(v.displayStamp).toBe("High-certainty exception");
    expect(v.coverage).toBeDefined();
  });

  it("stamps FIX for a Tavily 0-hit invented_surface", () => {
    const v = gate({
      rawFindings: [{
        kind: "invented_surface",
        severity: "high",
        confidence: 0.8,
        title: "Unknown package",
        body: tavilyHitsLabel(0),
        evidence: [tavilyEv],
        model: "super",
        cited: true,
      }],
      coverage: makeCoverage({ tavily: "ok" }),
      ledger: [],
    });
    expect(v.stamp).toBe("FIX");
    expect(v.displayStamp).toBe("Cited exceptions");
  });

  it("stamps SHIP when no findings survive", () => {
    const v = gate({ rawFindings: [], coverage: makeCoverage(), ledger: [], residualNotes: ["unreviewed files outside the 40-file cap"] });
    expect(v.stamp).toBe("SHIP");
    expect(v.displayStamp).toBe("No cited exceptions");
    expect(v.residualNotes).toContain("unreviewed files outside the 40-file cap");
  });

  it("drops invented_surface when Tavily returned hits", () => {
    const v = gate({
      rawFindings: [{
        kind: "invented_surface",
        severity: "high",
        confidence: 1,
        title: "Unknown package convert-source-map",
        body: tavilyHitsLabel(3),
        evidence: [{ kind: "tavily" as const, quote: tavilyHitsLabel(3), tavilyHits: 3, url: "https://www.npmjs.com/package/convert-source-map" }],
        model: "tavily",
        cited: true,
      }],
      coverage: makeCoverage({ tavily: "ok" }),
      ledger: [],
    });
    expect(v.findings).toEqual([]);
    expect(v.stamp).toBe("SHIP");
  });

  it("drops invented_surface without tavily evidence", () => {
    const v = gate({
      rawFindings: [{ kind: "invented_surface", severity: "high", confidence: 0.9, title: "x", body: "", evidence: [fileEv], model: "super", cited: true }],
      coverage: makeCoverage({ tavily: "ok" }),
      ledger: [],
    });
    expect(v.stamp).toBe("SHIP");
    expect(v.findings).toEqual([]);
  });

  it("drops invented_surface when tavily failed", () => {
    const v = gate({
      rawFindings: [{ kind: "invented_surface", severity: "high", confidence: 0.9, title: "x", body: "", evidence: [tavilyEv], model: "super", cited: true }],
      coverage: makeCoverage({ tavily: "failed" }),
      ledger: [],
    });
    expect(v.findings).toEqual([]);
    expect(v.stamp).toBe("SHIP");
  });

  it("drops unknown kinds and uncited findings", () => {
    const v = gate({
      rawFindings: [
        { kind: "style", severity: "medium", confidence: 0.9, title: "nit", body: "", evidence: [fileEv], model: "super", cited: true },
        { kind: "scope_drift", severity: "medium", confidence: 0.7, title: "extra", body: "", evidence: [], model: "super", cited: true },
      ],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(v.stamp).toBe("SHIP");
  });

  it("does not let a model-proposed BLOCK through without a secret finding", () => {
    const v = gate({
      rawFindings: [{ kind: "looks_right_logic", severity: "high", confidence: 0.99, title: "retry", body: "", evidence: [fileEv], model: "super", cited: true }],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(v.stamp).toBe("FIX");
  });

  it("BLOCK only when a surviving secret is from the regex scanner", () => {
    const modelSecret = gate({
      rawFindings: [{
        kind: "secret",
        severity: "high",
        confidence: 0.9,
        title: "Key",
        body: "",
        evidence: [fileEv],
        model: "nvidia/nemotron-3-super-120b-a12b",
        cited: true,
      }],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(modelSecret.stamp).not.toBe("BLOCK");
    expect(modelSecret.stamp === "FIX" || modelSecret.findings.length === 0).toBe(true);

    const regexSecret = gate({
      rawFindings: [
        {
          kind: "secret",
          severity: "high",
          confidence: 0.9,
          title: "Model key",
          body: "",
          evidence: [fileEv],
          model: "nvidia/nemotron-3-super-120b-a12b",
          cited: true,
        },
        {
          kind: "secret",
          severity: "high",
          confidence: 1,
          title: "Key",
          body: "",
          evidence: [fileEv],
          model: "regex",
          cited: true,
        },
      ],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(regexSecret.stamp).toBe("BLOCK");
  });

  it("drops scope_drift that only cites test files", () => {
    const v = gate({
      rawFindings: [{
        kind: "scope_drift",
        severity: "medium",
        confidence: 0.9,
        title: "extra tests",
        body: "",
        evidence: [{ kind: "file" as const, path: "src/clamp.test.ts", startLine: 1, quote: "assertEqual" }],
        model: "super",
        cited: true,
      }],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(v.findings).toEqual([]);
    expect(v.stamp).toBe("SHIP");
  });

  it("drops a duplicate regex secret with the same path, line, and quote", () => {
    const v = gate({
      rawFindings: [
        { kind: "secret", severity: "high", confidence: 1, title: "Secret in patch", body: "", evidence: [fileEv], model: "regex", cited: true },
        { kind: "secret", severity: "high", confidence: 1, title: "Secret in patch", body: "", evidence: [fileEv], model: "regex", cited: true },
      ],
      coverage: makeCoverage(),
      ledger: [],
    });
    expect(v.findings.filter((f) => f.kind === "secret")).toHaveLength(1);
    expect(v.stamp).toBe("BLOCK");
  });

  it("omits residualNotes on FIX", () => {
    const v = gate({
      rawFindings: [{ kind: "looks_right_logic", severity: "medium", confidence: 0.6, title: "retry", body: "", evidence: [fileEv], model: "super", cited: true }],
      coverage: makeCoverage(),
      ledger: [],
      residualNotes: ["should not appear"],
    });
    expect(v.residualNotes).toEqual([]);
  });
});
