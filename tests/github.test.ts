import { afterEach, describe, expect, it } from "vitest";
import { fetchPullRequest, fetchTarball } from "@/server/ingest";

const origGithub = process.env.GITHUB_TOKEN;

afterEach(() => {
  if (origGithub === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = origGithub;
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

describe("github", () => {
  it("maps 404 to pr_not_found", async () => {
    const fetchImpl = async () => json({ message: "Not Found" }, 404);
    const r = await fetchPullRequest({ owner: "a", repo: "b", number: 1 }, fetchImpl);
    expect(r).toEqual({ error: "pr_not_found" });
  });

  it("maps 403 to repo_private", async () => {
    const fetchImpl = async () => json({ message: "Forbidden" }, 403);
    const r = await fetchPullRequest({ owner: "a", repo: "b", number: 1 }, fetchImpl);
    expect(r).toEqual({ error: "repo_private" });
  });

  it("returns headSha, diff fragment, and up to 3 image urls", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.endsWith("/pulls/9")) {
        return json({
          title: "t",
          body: "see ![ci](https://example.com/ci-fail.png) and ![x](https://example.com/a.jpg)",
          head: { sha: "abc123" },
          base: { repo: { private: false } },
        });
      }
      if (u.includes("/pulls/9/files")) {
        return json([{ filename: "src/a.ts", patch: "@@ -0,0 +1 @@\n+export const a = 1;\n", status: "added" }]);
      }
      return json({}, 404);
    };
    const r = await fetchPullRequest({ owner: "acme", repo: "w", number: 9 }, fetchImpl);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.headSha).toBe("abc123");
    expect(r.changedPaths).toContain("src/a.ts");
    expect(r.diff).toContain("export const a = 1");
    expect(r.imageUrls).toHaveLength(2);
  });

  it("sends Authorization Bearer when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";
    let authorization: string | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      return json({ message: "Not Found" }, 404);
    };
    await fetchPullRequest({ owner: "a", repo: "b", number: 1 }, fetchImpl);
    expect(authorization).toBe("Bearer ghs_test");
  });

  it("paginates files while a page has 100 entries", async () => {
    const pages: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const u = new URL(String(url), "https://api.github.com");
      if (u.pathname.endsWith("/pulls/9")) {
        return json({ title: "t", body: "", head: { sha: "abc123" } });
      }
      if (u.pathname.endsWith("/pulls/9/files")) {
        pages.push(u.searchParams.get("page") ?? "");
        const page = Number(u.searchParams.get("page") ?? "1");
        if (page === 1) {
          return json(
            Array.from({ length: 100 }, (_, i) => ({
              filename: `src/f${i}.ts`,
              patch: "@@ -0,0 +1 @@\n+x\n",
              status: "added",
            })),
          );
        }
        return json([{ filename: "src/last.ts", patch: "@@ -0,0 +1 @@\n+y\n", status: "added" }]);
      }
      return json({}, 404);
    };
    const r = await fetchPullRequest({ owner: "acme", repo: "w", number: 9 }, fetchImpl);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.changedPaths).toHaveLength(101);
    expect(pages).toEqual(["1", "2"]);
  });

  it("fetches a closing issue and prepends its body to issueBody", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      urls.push(u);
      if (u.endsWith("/pulls/9")) {
        return json({
          title: "PR title",
          body: "Fixes #12 and closes #13\n\npr body text",
          head: { sha: "abc123" },
          base: { repo: { private: false } },
        });
      }
      if (u.endsWith("/issues/12")) {
        return json({ title: "Linked bug", body: "linked issue body text" });
      }
      if (u.endsWith("/issues/13")) return json({ message: "Not Found" }, 404);
      if (u.includes("/pulls/9/files")) return json([]);
      return json({}, 404);
    };
    const r = await fetchPullRequest({ owner: "acme", repo: "w", number: 9 }, fetchImpl);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(urls.some((u) => u.endsWith("/repos/acme/w/issues/12"))).toBe(true);
    expect(r.issueBody).toContain("linked issue body text");
    expect(r.issueBody).toContain("pr body text");
    expect(r.issueBody.indexOf("linked issue body text")).toBeLessThan(r.issueBody.indexOf("pr body text"));
  });

  it("maps base.repo.private to repo_private", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      if (u.endsWith("/pulls/9")) {
        return json({
          title: "t",
          body: "",
          head: { sha: "abc123" },
          base: { repo: { private: true } },
        });
      }
      return json({}, 404);
    };
    const r = await fetchPullRequest({ owner: "acme", repo: "w", number: 9 }, fetchImpl);
    expect(r).toEqual({ error: "repo_private" });
  });
});

describe("fetchTarball", () => {
  const MAX = 80 * 1024 * 1024;

  it("GETs codeload.github.com/{owner}/{repo}/tar.gz/{headSha}", async () => {
    let seen = "";
    const fetchImpl: typeof fetch = async (url) => {
      seen = String(url);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };
    const r = await fetchTarball({ owner: "acme", repo: "w" }, "abc123", fetchImpl);
    expect(seen).toBe("https://codeload.github.com/acme/w/tar.gz/abc123");
    expect(r.ok).toBe(true);
    if (r.ok) expect([...r.buffer]).toEqual([1, 2, 3]);
  });

  it("sends Authorization Bearer on tarball when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghs_test";
    let authorization: string | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      return new Response(new Uint8Array([1]), { status: 200 });
    };
    await fetchTarball({ owner: "acme", repo: "w" }, "abc123", fetchImpl);
    expect(authorization).toBe("Bearer ghs_test");
  });

  it("aborts when Content-Length exceeds 80 MB without reading the body", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { "content-length": String(MAX + 1) } });
    const r = await fetchTarball({ owner: "acme", repo: "w" }, "abc123", fetchImpl);
    expect(r).toEqual({ ok: false, code: "tarball_too_large" });
    await Promise.resolve();
    expect(pulled).toBeLessThan(4);
  });

  it("aborts when download exceeds 80 MB even if Content-Length is missing or lying", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        if (sent > 200 * 1024 * 1024) {
          controller.error(new Error("read past 200MB — did not abort"));
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const fetchImpl: typeof fetch = async () =>
      new Response(body, { status: 200, headers: { "content-length": "10" } });
    const r = await fetchTarball({ owner: "acme", repo: "w" }, "abc123", fetchImpl);
    expect(r).toEqual({ ok: false, code: "tarball_too_large" });
    expect(sent).toBeLessThan(100 * 1024 * 1024);
  });

  it("returns snapshot_failed when tarball fetch throws", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const r = await fetchTarball({ owner: "acme", repo: "w" }, "abc123", fetchImpl);
    expect(r).toEqual({ ok: false, code: "snapshot_failed" });
  });
});
