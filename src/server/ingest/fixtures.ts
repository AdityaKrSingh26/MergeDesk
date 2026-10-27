import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureId } from "@/server/shared";

export interface FixtureMeta {
  id: FixtureId;
  intendedStamp: "SHIP" | "FIX" | "BLOCK";
  title: string;
}

export function loadFixture(id: FixtureId): {
  issue: string;
  diff: string;
  repoRoot: string;
  meta: FixtureMeta;
  screenshotPath?: string;
} {
  const root = join(process.cwd(), "fixtures", id);
  const issue = readFileSync(join(root, "issue.md"), "utf8");
  const diff = readFileSync(join(root, "diff.patch"), "utf8");
  const meta = JSON.parse(readFileSync(join(root, "meta.json"), "utf8")) as FixtureMeta;
  const repoRoot = join(root, "repo");
  const screenshot = join(root, "ci-fail.png");
  const screenshotPath = existsSync(screenshot) ? screenshot : undefined;
  return { issue, diff, repoRoot, meta, screenshotPath };
}
