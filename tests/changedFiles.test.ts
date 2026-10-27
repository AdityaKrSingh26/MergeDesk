import { describe, expect, it } from "vitest";
import { changedFilesFromDiff } from "@/server/graph";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  "-old",
  "+new",
  "+more",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1,2 @@",
  " keep",
  "+added",
].join("\n");

describe("changedFilesFromDiff", () => {
  it("counts plus and minus per file and sums to the patch totals", () => {
    const rows = changedFilesFromDiff(patch);
    expect(rows).toEqual([
      { path: "src/a.ts", linesAdded: 2, linesRemoved: 1 },
      { path: "src/b.ts", linesAdded: 1, linesRemoved: 0 },
    ]);
    expect(rows.reduce((s, r) => s + r.linesAdded, 0)).toBe(3);
    expect(rows.reduce((s, r) => s + r.linesRemoved, 0)).toBe(1);
  });

  it("skips /dev/null new-file markers on the minus side only", () => {
    const created = [
      "diff --git a/src/new.ts b/src/new.ts",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+alpha",
      "+beta",
    ].join("\n");
    expect(changedFilesFromDiff(created)).toEqual([
      { path: "src/new.ts", linesAdded: 2, linesRemoved: 0 },
    ]);
  });
});
