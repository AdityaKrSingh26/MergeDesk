import { describe, expect, it } from "vitest";
import { buildGraph } from "@/server/graph";

describe("parser selection", () => {
  it("forceParser regex labels parser regex", async () => {
    const g = await buildGraph({
      files: { "src/a.ts": `import { b } from "./b";`, "src/b.ts": `export const b = 1;` },
      changedPaths: ["src/a.ts"],
      forceParser: "regex",
    });
    expect(g.parser).toBe("regex");
  });

  it.skipIf(!process.env.MERGEDESK_WASM)("tree-sitter parser label when wasm works", async () => {
    const g = await buildGraph({
      files: { "src/a.ts": `import { b } from "./b";`, "src/b.ts": `export const b = 1;` },
      changedPaths: ["src/a.ts"],
      forceParser: "tree-sitter",
    });
    expect(g.parser).toBe("tree-sitter");
  });
});
