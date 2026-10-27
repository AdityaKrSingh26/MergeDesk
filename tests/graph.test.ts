import { describe, expect, it } from "vitest";
import { buildGraph, inventedImportNames, personalize } from "@/server/graph";

const files = {
  "src/a.ts": `import { b } from "./b";\nexport const a = 1;\n`,
  "src/b.ts": `import { c } from "./c";\nexport const b = 1;\n`,
  "src/c.ts": `export const c = 1;\n`,
  "src/unrelated.ts": `export const u = 1;\n`,
};

describe("personalize", () => {
  it("keeps seed plus neighbors and skips unrelated files", async () => {
    const g = personalize(await buildGraph({ files, changedPaths: ["src/a.ts"], forceParser: "regex" }), ["src/a.ts"]);
    expect(g.filesKept).toContain("src/a.ts");
    expect(g.filesKept).toContain("src/b.ts");
    expect(g.filesKept).not.toContain("src/unrelated.ts");
    expect(g.parser).toBe("regex");
  });

  it("adds hop 2 when hop-1 file count is under 12", async () => {
    const g = personalize(await buildGraph({ files, changedPaths: ["src/a.ts"] }), ["src/a.ts"]);
    expect(g.filesKept).toContain("src/c.ts");
    expect(g.hops).toBe(2);
  });

  it("caps at 40 files and keeps the seed", async () => {
    const many: Record<string, string> = {};
    const imports: string[] = [];
    for (let i = 0; i < 60; i++) {
      many[`src/n${i}.ts`] = `export const n${i} = ${i};\n`;
      imports.push(`import { n${i} } from "./n${i}";`);
    }
    many["src/seed.ts"] = imports.join("\n") + "\nexport const seed = 1;\n";
    const g = personalize(await buildGraph({ files: many, changedPaths: ["src/seed.ts"] }), ["src/seed.ts"]);
    expect(g.filesKept.length).toBeLessThanOrEqual(40);
    expect(g.filesKept).toContain("src/seed.ts");
    expect(g.hops).toBe(1);
  });

  it("keeps changed Go files and reports parser regex", async () => {
    const g = personalize(
      await buildGraph({
        files: { "internal/regex.go": "package regex\nfunc Lower() {}\n" },
        changedPaths: ["internal/regex.go"],
      }),
      ["internal/regex.go"],
    );
    expect(g.filesKept).toContain("internal/regex.go");
    expect(g.parser).toBe("regex");
  });

  it("links same-package Go files as reference neighbors", async () => {
    const g = personalize(
      await buildGraph({
        files: {
          "internal/a.go": "package internal\nfunc A() {}\n",
          "internal/b.go": "package internal\nfunc B() {}\n",
        },
        changedPaths: ["internal/a.go"],
        forceParser: "regex",
      }),
      ["internal/a.go"],
    );
    expect(g.filesKept).toContain("internal/b.go");
    expect(g.parser).toBe("regex");
  });

  it("follows quoted C includes", async () => {
    const g = personalize(
      await buildGraph({
        files: {
          "src/main.c": '#include "util.h"\nint main() { return 0; }\n',
          "src/util.h": "int util(void);\n",
        },
        changedPaths: ["src/main.c"],
        forceParser: "regex",
      }),
      ["src/main.c"],
    );
    expect(g.filesKept).toContain("src/util.h");
    expect(g.parser).toBe("regex");
  });
});

describe("inventedImportNames", () => {
  it("inventedImportNames returns foo_payments_sdk from a changed file", () => {
    const names = inventedImportNames({
      "src/invoices.ts": `import { FooPayments } from "foo_payments_sdk";\n`,
    }, ["src/invoices.ts"]);
    expect(names).toContain("foo_payments_sdk");
  });
});

