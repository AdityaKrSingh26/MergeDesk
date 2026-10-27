export type PullRequestRef = { owner: string; repo: string; number: number };

export type PullRequestBundle = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  issueBody: string;
  headSha: string;
  diff: string;
  changedPaths: string[];
  imageUrls: string[];
};

export type FetchPullRequestResult = PullRequestBundle | { error: "pr_not_found" | "repo_private" };

const API = "https://api.github.com";
const MAX_COMPRESSED = 80 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp)(?:\?.*)?$/i;
const MD_IMAGE = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?/g;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function tarballUrl(owner: string, repo: string, headSha: string): string {
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${headSha}`;
}

function mapStatus(status: number): "pr_not_found" | "repo_private" | undefined {
  if (status === 404) return "pr_not_found";
  if (status === 403) return "repo_private";
  return undefined;
}

function asRecord(data: unknown): Record<string, unknown> {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  MD_IMAGE.lastIndex = 0;
  for (const match of markdown.matchAll(MD_IMAGE)) {
    const url = match[1];
    if (!url || !IMAGE_EXT.test(url)) continue;
    urls.push(url);
    if (urls.length >= 3) break;
  }
  return urls;
}

function reconstructFilePatch(file: Record<string, unknown>): { path: string; text: string } | undefined {
  const path = str(file.filename);
  if (!path) return undefined;
  const status = str(file.status) || "modified";
  const prev = str(file.previous_filename) || path;
  const a = status === "added" ? "/dev/null" : `a/${prev}`;
  const b = status === "removed" ? "/dev/null" : `b/${path}`;
  const gitA = status === "added" ? path : prev;
  const lines = [`diff --git a/${gitA} b/${path}`];
  if (status === "added") lines.push("new file mode 100644");
  if (status === "removed") lines.push("deleted file mode 100644");
  if (status === "renamed") {
    lines.push(`rename from ${prev}`);
    lines.push(`rename to ${path}`);
  }
  lines.push(`--- ${a}`);
  lines.push(`+++ ${b}`);
  const patch = str(file.patch);
  if (patch) lines.push(patch.replace(/\n$/, ""));
  return { path, text: lines.join("\n") };
}

function closingIssueNumbers(body: string, prNumber: number): number[] {
  const nums: number[] = [];
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  for (const match of body.matchAll(re)) {
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n === prNumber || nums.includes(n)) continue;
    nums.push(n);
    if (nums.length >= 3) break;
  }
  return nums;
}

async function linkedIssuePreface(
  ref: PullRequestRef,
  body: string,
  fetchImpl: FetchLike,
  headers: Record<string, string>,
): Promise<string> {
  const parts: string[] = [];
  for (const n of closingIssueNumbers(body, ref.number)) {
    try {
      const res = await fetchImpl(`${API}/repos/${ref.owner}/${ref.repo}/issues/${n}`, { headers });
      if (!res.ok) continue;
      const issue = asRecord(await readJson(res));
      const text = [str(issue.title), str(issue.body)].filter(Boolean).join("\n\n");
      if (text) parts.push(text);
    } catch {
      continue;
    }
  }
  return [parts.join("\n\n"), body].filter(Boolean).join("\n\n");
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function fetchPullRequest(
  ref: PullRequestRef,
  fetchImpl: FetchLike = fetch,
): Promise<FetchPullRequestResult> {
  const headers = githubHeaders();
  const prRes = await fetchImpl(`${API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, { headers });
  const mapped = mapStatus(prRes.status);
  if (mapped) return { error: mapped };
  if (!prRes.ok) return { error: "pr_not_found" };

  const pr = asRecord(await readJson(prRes));
  const base = asRecord(pr.base);
  const repo = asRecord(base.repo);
  if (repo.private === true) return { error: "repo_private" };

  const head = asRecord(pr.head);
  const headSha = str(head.sha);
  if (!headSha) return { error: "pr_not_found" };

  const title = str(pr.title);
  const body = str(pr.body);
  const changedPaths: string[] = [];
  const parts: string[] = [];
  let page = 1;
  for (;;) {
    const filesRes = await fetchImpl(
      `${API}/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?page=${page}&per_page=100`,
      { headers },
    );
    const filesMapped = mapStatus(filesRes.status);
    if (filesMapped) return { error: filesMapped };
    if (!filesRes.ok) break;
    const batch = await readJson(filesRes);
    if (!Array.isArray(batch)) break;
    for (const item of batch) {
      const rec = asRecord(item);
      const reconstructed = reconstructFilePatch(rec);
      if (!reconstructed) continue;
      changedPaths.push(reconstructed.path);
      parts.push(reconstructed.text);
    }
    if (batch.length !== 100) break;
    page += 1;
  }

  const issueBody = await linkedIssuePreface(ref, body, fetchImpl, headers);

  return {
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    title,
    body,
    issueBody,
    headSha,
    diff: parts.join("\n"),
    changedPaths,
    imageUrls: extractImageUrls(body),
  };
}

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // already closed or locked
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer | undefined> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.length = 0;
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  return Buffer.concat(chunks, total);
}

export async function fetchTarball(
  ref: Pick<PullRequestRef, "owner" | "repo">,
  headSha: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; code: "tarball_too_large" | "snapshot_failed" }> {
  try {
    const res = await fetchImpl(tarballUrl(ref.owner, ref.repo, headSha), { headers: githubHeaders() });
    if (!res.ok) {
      await cancelBody(res);
      return { ok: false, code: "snapshot_failed" };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_COMPRESSED) {
      await cancelBody(res);
      return { ok: false, code: "tarball_too_large" };
    }
    const buffer = await readCapped(res, MAX_COMPRESSED);
    if (buffer === undefined) return { ok: false, code: "tarball_too_large" };
    return { ok: true, buffer };
  } catch {
    return { ok: false, code: "snapshot_failed" };
  }
}
