import { after } from "next/server";
import { parsePrUrl } from "@/server/ingest";
import { allowPost, startRun, waitRun, wouldExceedDaily } from "@/server/runs";
import type { FixtureId, Run } from "@/server/shared";

function keepRun(done: Promise<void>): void {
  try {
    after(() => done);
  } catch {
    void done;
  }
}

function liveSpendCapped(): boolean {
  return wouldExceedDaily(Number(process.env.MERGEDESK_SPEND_CAP_USD ?? 0.12));
}

export const maxDuration = 300;

function isFixtureId(id: string): id is FixtureId {
  return id === "fixture-ship" || id === "fixture-fix" || id === "fixture-block";
}

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return "127.0.0.1";
  const first = xff.split(",")[0]?.trim();
  return first || "127.0.0.1";
}

async function waitOrPartial(id: string): Promise<Response> {
  const run: Run = await waitRun(id, 180_000);
  if (run.status !== "done" && run.status !== "error") {
    return Response.json(run, { status: 504 });
  }
  return Response.json(run);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "pr_not_found" }, { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return Response.json({ code: "pr_not_found" }, { status: 400 });
  }

  if (!allowPost(clientIp(request), Date.now())) {
    return Response.json({ code: "rate_limited" }, { status: 429 });
  }

  const { fixtureId, prUrl, issue, diff, wait } = body as {
    fixtureId?: unknown;
    prUrl?: unknown;
    issue?: unknown;
    diff?: unknown;
    wait?: unknown;
  };

  if (typeof fixtureId === "string") {
    if (!isFixtureId(fixtureId)) {
      return Response.json(
        { code: "pr_not_found", message: "Unknown fixture" },
        { status: 400 },
      );
    }
    const { id, done } = await startRun({ kind: "fixture", fixtureId });
    keepRun(done);
    if (wait === true) return waitOrPartial(id);
    return Response.json({ id, status: "queued" }, { status: 202 });
  }

  if (typeof prUrl === "string") {
    const parsed = parsePrUrl(prUrl);
    if ("error" in parsed) {
      return Response.json({ code: "pr_not_found" }, { status: 400 });
    }
    if (liveSpendCapped()) {
      return Response.json({ code: "spend_capped" }, { status: 429 });
    }
    const { id, done } = await startRun({ kind: "pr", prUrl });
    keepRun(done);
    if (wait === true) return waitOrPartial(id);
    return Response.json({ id, status: "queued" }, { status: 202 });
  }

  if (typeof issue === "string" && typeof diff === "string") {
    if (liveSpendCapped()) {
      return Response.json({ code: "spend_capped" }, { status: 429 });
    }
    const imageUrlsRaw = (body as { imageUrls?: unknown }).imageUrls;
    const imageUrls = Array.isArray(imageUrlsRaw)
      ? imageUrlsRaw.filter((item): item is string => typeof item === "string")
      : undefined;
    const { id, done } = await startRun({
      kind: "paste",
      issue,
      diff,
      ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
    });
    keepRun(done);
    if (wait === true) return waitOrPartial(id);
    return Response.json({ id, status: "queued" }, { status: 202 });
  }

  return Response.json({ code: "pr_not_found" }, { status: 400 });
}
