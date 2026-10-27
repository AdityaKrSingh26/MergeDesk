import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buffer as consume } from "node:stream/consumers";
import { create } from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { extractTarball } from "@/server/ingest";

async function packTarGz(files: Record<string, string>): Promise<Buffer> {
  const root = mkdtempSync(join(tmpdir(), "md-pack-"));
  try {
    const names = Object.keys(files);
    for (const rel of names) {
      const full = join(root, ...rel.split("/"));
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, files[rel]);
    }
    const tarBuf = Buffer.from(await consume(create({ cwd: root, portable: true }, names)));
    return gzipSync(tarBuf);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const TWO_TS = {
  "repo/src/a.ts": "export const a = 1;\n",
  "repo/src/b.ts": "export const b = 2;\n",
};

describe("extractTarball", () => {
  afterEach(() => {
    rmSync(join(tmpdir(), "mergedesk"), { recursive: true, force: true });
  });

  it("extracts a small tarball into files", async () => {
    const buffer = await packTarGz(TWO_TS);
    const res = await extractTarball({
      buffer,
      maxUncompressedBytes: 200 * 1024 * 1024,
      maxFiles: 8000,
      timeoutMs: 30_000,
      runId: "t0",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.files["src/a.ts"]).toContain("export const a");
    expect(res.files["src/b.ts"]).toContain("export const b");
    expect(existsSync(res.dir)).toBe(false);
  });

  it("aborts when uncompressed bytes exceed cap", async () => {
    const buffer = await packTarGz(TWO_TS);
    const res = await extractTarball({ buffer, maxUncompressedBytes: 10, maxFiles: 8000, timeoutMs: 30_000, runId: "t1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("extracted_too_large");
  });

  it("aborts when compressed size exceeds cap", async () => {
    const buffer = await packTarGz(TWO_TS);
    const res = await extractTarball({
      buffer,
      maxCompressedBytes: 1,
      maxUncompressedBytes: 200 * 1024 * 1024,
      maxFiles: 8000,
      timeoutMs: 30_000,
      runId: "t2",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("tarball_too_large");
  });

  it("skips skip-list dirs, min.js, lockfiles, and binaries", async () => {
    const buffer = await packTarGz({
      "repo/src/ok.ts": "export const ok = 1;\n",
      "repo/node_modules/pkg/index.js": "module.exports = 1;\n",
      "repo/vendor/lib.js": "export const v = 1;\n",
      "repo/dist/out.js": "export const d = 1;\n",
      "repo/build/out.js": "export const b = 1;\n",
      "repo/.git/config": "[core]\n",
      "repo/.next/cache": "x",
      "repo/coverage/lcov.info": "TN:\n",
      "repo/src/__pycache__/x.pyc": "binary",
      "repo/src/app.min.js": "min",
      "repo/package-lock.json": "{}",
      "repo/yarn.lock": "",
      "repo/pnpm-lock.yaml": "",
      "repo/src/photo.png": "\x89PNG",
    });
    const res = await extractTarball({ buffer, runId: "t3" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.files["src/ok.ts"]).toContain("export const ok");
    expect(Object.keys(res.files).sort()).toEqual(["src/ok.ts"]);
  });

  it("aborts when file count exceeds cap", async () => {
    const buffer = await packTarGz({
      "repo/src/a.ts": "export const a = 1;\n",
      "repo/src/b.ts": "export const b = 2;\n",
      "repo/src/c.ts": "export const c = 3;\n",
    });
    const res = await extractTarball({
      buffer,
      maxUncompressedBytes: 200 * 1024 * 1024,
      maxFiles: 2,
      timeoutMs: 30_000,
      runId: "t4",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("extracted_too_large");
  });

  it("returns snapshot_failed for a corrupt tarball", async () => {
    const res = await extractTarball({
      buffer: gzipSync(Buffer.from("not-a-tar")),
      runId: "t6",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("snapshot_failed");
  });

  it("returns snapshot_failed when extract wall time exceeds cap", async () => {
    const buffer = await packTarGz(TWO_TS);
    const res = await extractTarball({ buffer, timeoutMs: 0, runId: "t7" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("snapshot_failed");
  });
});
