import { describe, expect, it } from "vitest";
import { findSecrets } from "@/server/ingest";

const patch = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,2 +1,3 @@
 export const url = "https://api.example.com";
+export const key = "AKIAIOSFODNN7EXAMPLE";
`;

describe("findSecrets", () => {
  it("hits AKIA in a unified diff added line", () => {
    const hits = findSecrets(patch);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].quote).toContain("AKIA");
    expect(hits[0].path).toBe("src/auth.ts");
  });
  it("returns empty on a clean patch", () => {
    expect(findSecrets("diff --git a/a.ts b/a.ts\n+export const x = 1;\n")).toEqual([]);
  });
  it("hits ghp_ tokens", () => {
    expect(findSecrets("+const t = \"ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\";\n").length).toBe(1);
  });
});
