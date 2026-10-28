import { describe, expect, it } from "vitest";
import { DESK_STEPS } from "@/server/shared";
import { allowedReviewPaths, gateWalkthrough } from "@/server/verdict";
import type { OrientationMap } from "@/server/shared";

const allowed = new Set(["src/clamp.ts", "src/math.ts", "src/clamp.test.ts"]);

function raw(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: ["Adds clamp(n, min, max)."],
    userFlow: {
      nodes: [
        { id: "caller", label: "Caller", kind: "actor" },
        { id: "clamp", label: "clamp()", kind: "action" },
      ],
      edges: [{ from: "caller", to: "clamp", label: "n, min, max" }],
    },
    fileLayers: [{ name: "Logic", paths: ["src/clamp.ts"], why: "new helper" }],
    comments: [],
    suggestions: [],
    ...partial,
  };
}

describe("DESK_STEPS", () => {
  it("has nine steps ending in Review", () => {
    expect(DESK_STEPS).toHaveLength(9);
    expect(DESK_STEPS[8]).toBe("Review");
  });
});

describe("gateWalkthrough", () => {
  it("rejects an empty summary", () => {
    expect(gateWalkthrough(raw({ summary: ["  ", ""] }), allowed).ok).toBe(false);
  });

  it("keeps at most six summary bullets", () => {
    const gated = gateWalkthrough(
      raw({ summary: ["a", "b", "c", "d", "e", "f", "g"] }),
      allowed,
    );
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.summary).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("drops comments on unknown paths and caps nits at two", () => {
    const gated = gateWalkthrough(
      raw({
        comments: [
          { path: "src/missing.ts", startLine: 1, title: "x", body: "y", severity: "issue", quote: "q" },
          { path: "src/clamp.ts", startLine: 4, title: "nit1", body: "a", severity: "nit", quote: "q" },
          { path: "src/clamp.ts", startLine: 5, title: "nit2", body: "b", severity: "nit", quote: "q" },
          { path: "src/clamp.ts", startLine: 6, title: "nit3", body: "c", severity: "nit", quote: "q" },
          { path: "src/clamp.ts", startLine: 7, title: "issue", body: "d", severity: "issue", quote: "q" },
        ],
      }),
      allowed,
    );
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.comments.map((c) => c.title)).toEqual(["nit1", "nit2", "issue"]);
    expect(gated.value.comments[0]?.id).toBe("comment-0");
  });

  it("caps comments at eight", () => {
    const comments = Array.from({ length: 10 }, (_, i) => ({
      path: "src/clamp.ts",
      startLine: i + 1,
      title: `c${i}`,
      body: "body",
      severity: "issue" as const,
      quote: "q",
    }));
    const gated = gateWalkthrough(raw({ comments }), allowed);
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.comments).toHaveLength(8);
  });

  it("drops suggestions without a unified diff hunk", () => {
    const gated = gateWalkthrough(
      raw({
        suggestions: [
          { path: "src/clamp.ts", title: "no hunk", unifiedDiff: "just words" },
          {
            path: "src/clamp.ts",
            title: "ok",
            unifiedDiff: "--- a/src/clamp.ts\n+++ b/src/clamp.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n",
          },
        ],
      }),
      allowed,
    );
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.suggestions).toHaveLength(1);
    expect(gated.value.suggestions[0]?.id).toBe("suggest-0");
  });

  it("drops user-flow edges whose endpoints are missing", () => {
    const gated = gateWalkthrough(
      raw({
        userFlow: {
          nodes: [{ id: "host", label: "Host", kind: "actor" }],
          edges: [{ from: "host", to: "ghost" }],
        },
      }),
      allowed,
    );
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect(gated.value.userFlow.edges).toEqual([]);
  });

  it("does not return a stamp field", () => {
    const gated = gateWalkthrough(raw({ proposedStamp: "BLOCK" }), allowed);
    expect(gated.ok).toBe(true);
    if (!gated.ok) return;
    expect("stamp" in gated.value).toBe(false);
    expect("proposedStamp" in gated.value).toBe(false);
  });
});

describe("allowedReviewPaths", () => {
  it("unions changed, start-here, functions, neighborhood, and blast radius", () => {
    const map: OrientationMap = {
      size: { linesAdded: 1, linesRemoved: 0, fileCount: 1, languages: { ts: 1 }, concernCount: 0 },
      startHere: [{ path: "src/clamp.ts", symbol: "clamp", why: "entry" }],
      concerns: [],
      functions: [{ name: "abs", path: "src/math.ts", job: "abs" }],
      mermaid: "graph TD; a;",
      mermaidCaption: "c",
      neighborhood: {
        nodes: [{ id: "t", path: "src/clamp.test.ts", label: "clamp.test.ts", changed: true }],
        edges: [],
      },
      changedFiles: [{ path: "src/clamp.ts", linesAdded: 1, linesRemoved: 0 }],
      blastRadius: {
        neighborsNotInDiff: ["src/math.ts"],
        testsAdded: ["src/clamp.test.ts"],
        testsMissing: [],
        envKeys: [],
      },
      multipleJobs: false,
    };
    const paths = allowedReviewPaths(map);
    expect(paths.has("src/clamp.ts")).toBe(true);
    expect(paths.has("src/math.ts")).toBe(true);
    expect(paths.has("src/clamp.test.ts")).toBe(true);
  });
});
