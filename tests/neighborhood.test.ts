import { describe, expect, it } from "vitest";
import { buildGraph, mermaidFromGraph, neighborhoodFromGraph, personalize } from "@/server/graph";
import { evidencePinsNode, neighborhoodFromMermaid, resolveNeighborhood } from "@/server/shared";

describe("neighborhoodFromGraph", () => {
  it("uses the same node ids as mermaidFromGraph", async () => {
    const g = personalize(
      await buildGraph({
        files: {
          "src/clamp.ts": `import { abs } from "./math"; export const clamp = 1;`,
          "src/math.ts": `export const abs = (n: number) => n;`,
        },
        changedPaths: ["src/clamp.ts"],
      }),
      ["src/clamp.ts"],
    );
    const mermaid = mermaidFromGraph(g);
    const nb = neighborhoodFromGraph(g);
    for (const n of g.nodes) {
      expect(mermaid).toContain(n.id);
      expect(nb.nodes.some((node) => node.id === n.id && node.path === n.path)).toBe(true);
    }
    expect(nb.edges.length).toBe(g.edges.length);
    const clamp = nb.nodes.find((n) => n.path === "src/clamp.ts");
    expect(clamp?.changed).toBe(true);
    expect(clamp?.label).toBe("src/clamp.ts");
  });
});

describe("neighborhoodFromMermaid", () => {
  it("parses quoted nodes, changed styles, and arrows", () => {
    const src = [
      "graph TD",
      '  a["auth.ts"]',
      '  b["invoices.ts"]',
      "  a --> b",
      "  style a fill:#fde68a",
      "  style b fill:#e0e7ff",
    ].join("\n");
    const nb = neighborhoodFromMermaid(src);
    expect(nb.nodes.map((n) => n.label)).toEqual(["auth.ts", "invoices.ts"]);
    expect(nb.nodes[0]?.changed).toBe(true);
    expect(nb.nodes[1]?.changed).toBe(false);
    expect(nb.edges).toEqual([{ from: "a", to: "b", kind: "import" }]);
  });

  it("resolveNeighborhood prefers structured payload over mermaid", () => {
    const mermaid = 'graph TD\n  a["auth.ts"]';
    const structured = {
      nodes: [{ id: "x", path: "src/x.ts", label: "src/x.ts", changed: true }],
      edges: [],
    };
    expect(resolveNeighborhood({ mermaid, neighborhood: structured }).nodes[0]?.id).toBe("x");
    expect(resolveNeighborhood({ mermaid }).nodes[0]?.label).toBe("auth.ts");
  });
});

describe("evidencePinsNode", () => {
  it("matches exact path, suffix, or node id, not sibling filenames", () => {
    const node = { id: "src_auth_ts", path: "auth.ts" };
    expect(evidencePinsNode({ path: "auth.ts" }, node)).toBe(true);
    expect(evidencePinsNode({ path: "src/auth.ts" }, node)).toBe(true);
    expect(evidencePinsNode({ path: "src/oauth.ts" }, node)).toBe(false);
    expect(evidencePinsNode({ nodeId: "src_auth_ts" }, node)).toBe(true);
    expect(evidencePinsNode({ nodeId: "other" }, node)).toBe(false);
    expect(evidencePinsNode({ path: "src/auth.ts" }, { id: "a", path: "src/auth.ts" })).toBe(true);
  });
});
