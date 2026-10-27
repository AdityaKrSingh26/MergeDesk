import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureId, Run } from "@/server/shared";

const LRU_CAP = 200;

const FIXTURE_IDS: ReadonlySet<string> = new Set<FixtureId>([
  "fixture-ship",
  "fixture-fix",
  "fixture-block",
]);

export function createStore(): {
  put(run: Run): void;
  get(id: string): Run | undefined;
  loadPrebaked(id: FixtureId): Run;
} {
  const runs = new Map<string, Run>();

  function loadPrebaked(id: FixtureId): Run {
    const path = join(process.cwd(), "fixtures", "prebaked", `${id}.json`);
    const run = JSON.parse(readFileSync(path, "utf8")) as Run;
    run.source = "replay";
    return run;
  }

  function put(run: Run): void {
    runs.set(run.id, run);
    if (runs.size > LRU_CAP) {
      const oldest = runs.keys().next().value;
      if (oldest !== undefined) runs.delete(oldest);
    }
  }

  function get(id: string): Run | undefined {
    const hit = runs.get(id);
    if (hit) return hit;
    if (FIXTURE_IDS.has(id)) return loadPrebaked(id as FixtureId);
    return undefined;
  }

  return { put, get, loadPrebaked };
}

const globalStore = globalThis as typeof globalThis & {
  __mergedeskStore?: ReturnType<typeof createStore>;
};

// App Router pages and route handlers can bundle this module twice in one process.
export const store = globalStore.__mergedeskStore ?? (globalStore.__mergedeskStore = createStore());
