import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureId, Run } from "@/server/shared";

const LRU_CAP = 200;

const FIXTURE_IDS: ReadonlySet<string> = new Set<FixtureId>([
  "fixture-ship",
  "fixture-fix",
  "fixture-block",
]);

function defaultPersistDir(): string | undefined {
  if (process.env.VITEST) return undefined;
  if (process.env.MERGEDESK_DATA_DIR) return process.env.MERGEDESK_DATA_DIR;
  if (process.env.VERCEL) return "/tmp/mergedesk-runs";
  return join(process.cwd(), "data", "runs");
}

function safeFileId(id: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
  return id;
}

export function createStore(opts?: { persistDir?: string }): {
  put(run: Run): void;
  get(id: string): Run | undefined;
  loadPrebaked(id: FixtureId): Run;
} {
  const runs = new Map<string, Run>();
  const persistDir = opts?.persistDir ?? defaultPersistDir();

  function filePath(id: string): string | undefined {
    if (!persistDir) return undefined;
    const safe = safeFileId(id);
    if (!safe) return undefined;
    return join(persistDir, `${safe}.json`);
  }

  function writeDisk(run: Run): void {
    const path = filePath(run.id);
    if (!path || !persistDir) return;
    try {
      mkdirSync(persistDir, { recursive: true });
      writeFileSync(path, JSON.stringify(run));
    } catch {
      /* disk is best-effort */
    }
  }

  function readDisk(id: string): Run | undefined {
    const path = filePath(id);
    if (!path || !existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Run;
    } catch {
      return undefined;
    }
  }

  function deleteDisk(id: string): void {
    const path = filePath(id);
    if (!path || !existsSync(path)) return;
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }

  function loadPrebaked(id: FixtureId): Run {
    const path = join(process.cwd(), "fixtures", "prebaked", `${id}.json`);
    const run = JSON.parse(readFileSync(path, "utf8")) as Run;
    run.source = "replay";
    return run;
  }

  function put(run: Run): void {
    runs.set(run.id, run);
    writeDisk(run);
    if (runs.size > LRU_CAP) {
      const oldest = runs.keys().next().value;
      if (oldest !== undefined) {
        runs.delete(oldest);
        deleteDisk(oldest);
      }
    }
  }

  function get(id: string): Run | undefined {
    const hit = runs.get(id);
    if (hit) return hit;
    const disk = readDisk(id);
    if (disk) {
      runs.set(id, disk);
      return disk;
    }
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
