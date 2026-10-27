/**
 * Manual smoke: POST fixture-block against a running MergeDesk with real env.
 * Not for CI. Start `pnpm dev` or `pnpm start` first.
 *
 * Badge rules match the orchestrator: Replay if the key is missing or chat throws.
 * Chat/ledger usage is Token Factory HTTP — not GET /v1/models (probe is non-fatal).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_APP = "http://localhost:3000";
const WAIT_MS = 300_000;

type LedgerLine = {
  skipped?: boolean;
  promptTokens?: number;
  completionTokens?: number;
};

type SmokeRun = {
  source?: string;
  status?: string;
  verdict?: { displayStamp?: string; ledger?: LedgerLine[] };
  ledger?: LedgerLine[];
  error?: { message?: string };
};

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function tfChatHappened(run: SmokeRun): boolean {
  const lines = [...(run.ledger ?? []), ...(run.verdict?.ledger ?? [])];
  return lines.some(
    (line) =>
      line.skipped !== true &&
      ((line.promptTokens ?? 0) > 0 || (line.completionTokens ?? 0) > 0),
  );
}

async function postFixtureBlock(origin: string): Promise<SmokeRun> {
  const url = `${origin.replace(/\/$/, "")}/api/runs`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixtureId: "fixture-block", wait: true }),
      signal: AbortSignal.timeout(WAIT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`POST ${url} failed: ${message}. Start the app (pnpm dev or pnpm start).`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    fail(`POST ${url} returned ${res.status} with no JSON`);
  }
  if (!body || typeof body !== "object") fail("Run response was not an object");
  return body as SmokeRun;
}

const origin = process.env.MERGEDESK_URL || DEFAULT_APP;
const run = await postFixtureBlock(origin);

const source = run.source ?? "";
const displayStamp = run.verdict?.displayStamp ?? "";
const chat = tfChatHappened(run);
console.log(`source: ${source}`);
console.log(`verdict.displayStamp: ${displayStamp}`);
console.log(`status: ${run.status ?? ""}`);
console.log(`tokenFactoryChat: ${chat ? "yes" : "no"}`);

if (run.status !== "done") {
  fail(`run status must be done, got ${JSON.stringify(run.status)}`);
}
if (source === "live" && !chat) {
  fail('source === "live" claimed when no Token Factory call happened');
}
if (!chat && source !== "replay") {
  fail(
    `Token Factory chat/ledger has no HTTP usage; source must be replay, got ${JSON.stringify(source)}`,
  );
}
if (!displayStamp) {
  fail("verdict.displayStamp missing");
}
