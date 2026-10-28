import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStore } from "@/server/runs";

describe("store", () => {
  it("returns prebaked fixture-block as Replay", () => {
    const s = createStore();
    const run = s.get("fixture-block");
    expect(run?.source).toBe("replay");
    expect(run?.verdict?.stamp).toBe("BLOCK");
    expect(run?.verdict?.displayStamp).toBe("High-certainty exception");
    expect(run?.coverage).toBeDefined();
  });
  it("evicts the oldest run after 200 live puts", () => {
    const s = createStore();
    for (let i = 0; i < 201; i++) {
      s.put({
        id: `r${i}`,
        status: "done",
        source: "live",
        coverage: {
          source: "live", snapshot: "patch-only", parser: "none",
          graphFilesKept: 0, graphFileCap: 40, hops: 1,
          tavily: "skipped", vision: "skipped", review: "skipped",
          budgetCapped: false, timedOut: false, packTruncated: false,
        },
        ledger: [],
        createdAt: i,
      });
    }
    expect(s.get("r0")).toBeUndefined();
    expect(s.get("r200")).toBeDefined();
  });

  it("reloads a put run from disk in a new store", () => {
    const dir = mkdtempSync(join(tmpdir(), "mergedesk-store-"));
    try {
      const a = createStore({ persistDir: dir });
      a.put({
        id: "keep-me",
        status: "done",
        source: "live",
        coverage: {
          source: "live", snapshot: "patch-only", parser: "none",
          graphFilesKept: 0, graphFileCap: 40, hops: 1,
          tavily: "skipped", vision: "skipped", review: "skipped",
          budgetCapped: false, timedOut: false, packTruncated: false,
        },
        ledger: [],
        createdAt: 1,
      });
      const b = createStore({ persistDir: dir });
      expect(b.get("keep-me")?.id).toBe("keep-me");
      expect(b.get("keep-me")?.status).toBe("done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
