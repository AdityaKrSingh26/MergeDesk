import { describe, expect, it } from "vitest";
import { buildGraph, mermaidFromGraph, personalize } from "@/server/graph";

describe("mermaidFromGraph", () => {
  it("emits graph TD with node ids that exist in the graph", async () => {
    const g = personalize(await buildGraph({
      files: { "src/a.ts": `import { b } from "./b";`, "src/b.ts": `export const b = 1;` },
      changedPaths: ["src/a.ts"],
    }), ["src/a.ts"]);
    const m = mermaidFromGraph(g);
    expect(m.startsWith("graph TD")).toBe(true);
    for (const n of g.nodes) {
      expect(m).toContain(n.id);
    }
  });
});
