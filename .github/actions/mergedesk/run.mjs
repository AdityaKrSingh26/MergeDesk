// Client only: POST wait:true, one advisory comment, always-neutral check. Always exit 0.
import { readFile } from "node:fs/promises";

const ADVISORY_CHECK_NAME = "MergeDesk (advisory)";
const WAIT_MS = 180_000;
const COMMENT_PREFIX = "MergeDesk (advisory)";
const DISPLAY_STAMP = {
  SHIP: "No cited exceptions",
  FIX: "Cited exceptions",
  BLOCK: "High-certainty exception",
};

function originFromEnv() {
  return String(process.env.MERGEDESK_URL ?? "").replace(/\/$/, "");
}

function stampLabel(run) {
  const display = run?.verdict?.displayStamp;
  if (typeof display === "string" && display.length > 0) return display;
  const stamp = run?.verdict?.stamp;
  if (stamp && DISPLAY_STAMP[stamp]) return DISPLAY_STAMP[stamp];
  return "pending";
}

function coverageChips(coverage) {
  if (!coverage || typeof coverage !== "object") return "unknown";
  const chips = [
    `snapshot: ${coverage.snapshot}`,
    `parser: ${coverage.parser}`,
    `${coverage.graphFilesKept}/${coverage.graphFileCap}`,
    `hops: ${coverage.hops}`,
    `tavily: ${coverage.tavily}`,
    `vision: ${coverage.vision}`,
  ];
  if (coverage.budgetCapped) chips.push("budget_capped");
  if (coverage.timedOut) chips.push("timed_out");
  return chips.join(" · ");
}

function shortNeighborhood(map) {
  const mermaid = typeof map?.mermaid === "string" ? map.mermaid : "";
  const nodes = [];
  for (const match of mermaid.matchAll(/([^\s["]+)\s*-->\s*([^\s[]+)/g)) {
    for (const id of [match[1], match[2]]) {
      if (id && !nodes.includes(id)) nodes.push(id);
    }
    if (nodes.length >= 3) break;
  }
  if (nodes.length >= 2) return nodes.slice(0, 3).join(" → ");
  const startHere = Array.isArray(map?.startHere) ? map.startHere : [];
  const files = startHere.map((item) => {
    const path = typeof item?.path === "string" ? item.path : "";
    return path.split("/").pop() || path;
  }).filter(Boolean);
  return files.slice(0, 3).join(" → ") || "none";
}

function topFindingLine(finding) {
  const title = typeof finding?.title === "string" ? finding.title : "";
  const ev = Array.isArray(finding?.evidence) ? finding.evidence[0] : undefined;
  if (!ev) return title;
  const loc = [ev.path, ev.startLine].filter((part) => part !== undefined && part !== "").join(":");
  const bit = loc || ev.quote;
  return bit ? `${title} (${bit})` : title;
}

function advisoryComment(run, origin) {
  const lines = [
    `${ADVISORY_CHECK_NAME} · ${stampLabel(run)}`,
    `This is not a merge gate. Coverage: ${coverageChips(run?.coverage)}`,
    "",
  ];
  const map = run?.map;
  if (map && typeof map === "object") {
    const size = map.size ?? {};
    const added = Number(size.linesAdded) || 0;
    const removed = Number(size.linesRemoved) || 0;
    const files = Number(size.fileCount) || 0;
    const concerns = Number(size.concernCount) || 0;
    lines.push(`Size: ${added + removed} lines · ${files} files · ${concerns} concerns`);
    lines.push(`Import neighborhood: ${shortNeighborhood(map)}`);
    lines.push("");
    const startHere = Array.isArray(map.startHere) ? map.startHere : [];
    if (startHere.length > 0) {
      lines.push("Start here");
      startHere.forEach((item, index) => {
        lines.push(`${index + 1}. ${item?.path ?? ""}  ${item?.symbol ?? ""}`);
      });
      lines.push("");
    }
  }
  const top = Array.isArray(run?.verdict?.findings) ? run.verdict.findings[0] : undefined;
  if (top) {
    lines.push(topFindingLine(top));
    lines.push("");
  }
  const id = typeof run?.id === "string" ? run.id : "";
  lines.push(`Full map: ${origin}/r/${id}`);
  return lines.join("\n");
}

function advisoryCheck(run) {
  const stamp = stampLabel(run);
  return {
    name: ADVISORY_CHECK_NAME,
    conclusion: "neutral",
    output: {
      title: `${ADVISORY_CHECK_NAME} · ${stamp}`,
      summary: "This is not a merge gate.",
    },
  };
}

async function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    console.error("MergeDesk: failed to read event payload:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

function prContext(event) {
  const pr = event?.pull_request;
  if (!pr || typeof pr !== "object") return undefined;
  const htmlUrl = typeof pr.html_url === "string" ? pr.html_url : "";
  const number = Number(pr.number);
  const headSha = typeof pr.head?.sha === "string" ? pr.head.sha : "";
  const repoFull = typeof process.env.GITHUB_REPOSITORY === "string" ? process.env.GITHUB_REPOSITORY : "";
  const fromEnv = repoFull.split("/");
  const owner =
    event?.repository?.owner?.login ||
    event?.repository?.owner?.name ||
    fromEnv[0];
  const repo = event?.repository?.name || fromEnv[1];
  if (!htmlUrl || !Number.isFinite(number) || !owner || !repo || !headSha) return undefined;
  return { prUrl: htmlUrl, number, owner, repo, headSha };
}

async function postRun(origin, prUrl) {
  const res = await fetch(`${origin}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ prUrl, wait: true }),
    signal: AbortSignal.timeout(WAIT_MS),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(`MergeDesk: /api/runs returned ${res.status} non-JSON`);
    return undefined;
  }
}

async function github(api, token, method, path, body) {
  return fetch(`${api}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function upsertComment(api, token, ctx, body) {
  const list = await github(
    api,
    token,
    "GET",
    `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.number}/comments?per_page=100`,
  );
  if (list.ok) {
    const comments = await list.json();
    const existing = Array.isArray(comments)
      ? comments.find((c) => typeof c?.body === "string" && c.body.startsWith(COMMENT_PREFIX))
      : undefined;
    if (existing?.id) {
      const patched = await github(
        api,
        token,
        "PATCH",
        `/repos/${ctx.owner}/${ctx.repo}/issues/comments/${existing.id}`,
        { body },
      );
      if (!patched.ok) console.error(`MergeDesk: comment PATCH ${patched.status}`);
      return;
    }
  } else {
    console.error(`MergeDesk: comment list ${list.status}; posting new comment`);
  }
  const created = await github(
    api,
    token,
    "POST",
    `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.number}/comments`,
    { body },
  );
  if (!created.ok) console.error(`MergeDesk: comment POST ${created.status}`);
}

async function createNeutralCheck(api, token, ctx, check) {
  const res = await github(api, token, "POST", `/repos/${ctx.owner}/${ctx.repo}/check-runs`, {
    name: check.name,
    head_sha: ctx.headSha,
    status: "completed",
    conclusion: "neutral",
    output: check.output,
  });
  if (res.status === 403) {
    console.log("MergeDesk: check-runs API returned 403; skipping extra check (comment kept). This is not a merge gate.");
    return;
  }
  if (!res.ok) console.error(`MergeDesk: check-runs POST ${res.status}; continuing`);
}

async function main() {
  const origin = originFromEnv();
  const token = process.env.GITHUB_TOKEN;
  const api = process.env.GITHUB_API_URL || "https://api.github.com";
  const event = await readEvent();
  const ctx = event ? prContext(event) : undefined;
  if (!ctx) {
    console.log("MergeDesk: no pull_request context; exiting 0 (not a merge gate)");
    return;
  }
  if (!token) {
    console.log("MergeDesk: GITHUB_TOKEN missing; exiting 0 (not a merge gate)");
    return;
  }

  let run;
  if (!origin) {
    console.log("MergeDesk: MERGEDESK_URL empty; posting neutral check only");
  } else {
    try {
      run = await postRun(origin, ctx.prUrl);
    } catch (err) {
      console.error("MergeDesk: /api/runs failed:", err instanceof Error ? err.message : err);
    }
  }

  const haveRun = run && typeof run === "object" && typeof run.id === "string";
  if (haveRun) {
    try {
      await upsertComment(api, token, ctx, advisoryComment(run, origin));
    } catch (err) {
      console.error("MergeDesk: comment failed:", err instanceof Error ? err.message : err);
    }
  }

  try {
    await createNeutralCheck(api, token, ctx, advisoryCheck(haveRun ? run : { verdict: undefined }));
  } catch (err) {
    console.error("MergeDesk: check-run failed:", err instanceof Error ? err.message : err);
  }
}

main()
  .catch((err) => {
    console.error("MergeDesk action error:", err instanceof Error ? err.message : err);
  })
  .finally(() => {
    process.exit(0);
  });
