import { describe, expect, it } from "vitest";
import { ADVISORY_CHECK_NAME, tavilyHitsLabel } from "@/server/shared";
import { advisoryCheck, advisoryComment } from "@/server/runs";
import { makeCoverage } from "./helpers/coverage";
import type { Run, Verdict } from "@/server/shared";

function verdict(partial: Pick<Verdict, "stamp" | "displayStamp"> & Partial<Verdict>): Verdict {
  return {
    findings: [],
    residualNotes: [],
    coverage: makeCoverage(),
    ledger: [],
    usdEstimateTotal: 0,
    ...partial,
  };
}

function blockRun(): Run {
  return {
    id: "run-block",
    status: "done",
    source: "fixture",
    coverage: makeCoverage(),
    map: {
      size: { linesAdded: 2000, linesRemoved: 10, fileCount: 12, languages: { ts: 12 }, concernCount: 3 },
      startHere: [{ path: "src/invoices.ts", symbol: "exportCsv", why: "entry" }],
      concerns: [{ name: "csv", paths: ["src/invoices.ts"] }],
      functions: [{ name: "exportCsv", path: "src/invoices.ts", job: "write csv" }],
      mermaid: "graph TD; a-->b;",
      mermaidCaption: "Import / reference neighborhood, not a proven execution trace.",
      blastRadius: { neighborsNotInDiff: [], testsAdded: [], testsMissing: [], envKeys: [] },
      multipleJobs: true,
    },
    verdict: verdict({
      stamp: "BLOCK",
      displayStamp: "High-certainty exception",
      findings: [{
        id: "f0",
        kind: "secret",
        severity: "high",
        confidence: 0.9,
        title: "AWS key",
        body: "regex",
        evidence: [{ kind: "file", path: "src/auth.ts", startLine: 2, quote: "AKIAIOSFODNN7EXAMPLE" }],
        model: "regex",
        cited: true,
      }],
    }),
    ledger: [],
    createdAt: 0,
  };
}

function shipRun(): Run {
  return {
    id: "run-ship",
    status: "done",
    source: "fixture",
    coverage: makeCoverage(),
    verdict: verdict({
      stamp: "SHIP",
      displayStamp: "No cited exceptions",
      residualNotes: ["unreviewed files outside the 40-file cap"],
    }),
    ledger: [],
    createdAt: 0,
  };
}

function fixRun(): Run {
  return {
    id: "run-fix",
    status: "done",
    source: "fixture",
    coverage: makeCoverage({ tavily: "ok" }),
    verdict: verdict({
      stamp: "FIX",
      displayStamp: "Cited exceptions",
      coverage: makeCoverage({ tavily: "ok" }),
    }),
    ledger: [],
    createdAt: 0,
  };
}

describe("advisoryComment", () => {
  it("comment uses display stamp and says not a merge gate", () => {
    const text = advisoryComment(blockRun(), "https://mergedesk.example");
    expect(text).toContain("MergeDesk (advisory) · High-certainty exception");
    expect(text).toContain("This is not a merge gate");
    expect(text).toContain("https://mergedesk.example/r/");
  });

  it("tavily evidence in the comment uses the not-proof label", () => {
    const run = fixRun();
    run.verdict = {
      ...run.verdict!,
      findings: [{
        id: "f-t",
        kind: "invented_surface",
        severity: "medium",
        confidence: 0.7,
        title: "Unknown package",
        body: "no docs",
        evidence: [{ kind: "tavily", quote: "no docs", tavilyHits: 0 }],
        model: "tavily",
        cited: true,
      }],
    };
    const text = advisoryComment(run, "https://mergedesk.example");
    expect(text).toContain(tavilyHitsLabel(0));
    expect(text).toContain("not proof of absence");
  });

  it("SHIP comment uses the display stamp, not the enum", () => {
    const text = advisoryComment(shipRun(), "https://mergedesk.example/");
    expect(text).toContain("MergeDesk (advisory) · No cited exceptions");
    expect(text).not.toContain(" · SHIP");
    expect(text).toContain("https://mergedesk.example/r/run-ship");
  });
});

describe("advisoryCheck", () => {
  it("check conclusion is neutral for BLOCK", () => {
    expect(advisoryCheck(blockRun()).conclusion).toBe("neutral");
    expect(advisoryCheck(shipRun()).conclusion).toBe("neutral");
  });

  it("check name is MergeDesk (advisory) and FIX is also neutral", () => {
    const check = advisoryCheck(fixRun());
    expect(check.name).toBe(ADVISORY_CHECK_NAME);
    expect(check.conclusion).toBe("neutral");
    expect(check.output.title).toContain("Cited exceptions");
    expect(check.output.summary).toContain("This is not a merge gate");
  });
});
