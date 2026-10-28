import { describe, expect, it } from "vitest";
import { buildGraph, mermaidFromGraph, mermaidFromUserFlow, personalize } from "@/server/graph";

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

  it("emits flowchart LR from a user-flow graph", () => {
    const m = mermaidFromUserFlow({
      nodes: [
        { id: "host", label: "Host", kind: "actor" },
        { id: "guest", label: "Guest", kind: "actor" },
      ],
      edges: [{ from: "host", to: "guest", label: "sync model" }],
    });
    expect(m.startsWith("flowchart LR")).toBe(true);
    expect(m).toContain("host");
    expect(m).toContain("guest");
    expect(m).toContain("sync model");
  });
});
