import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unpack, type ReadEntry } from "tar";

const DEFAULT_MAX_COMPRESSED = 80 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED = 200 * 1024 * 1024;
const DEFAULT_MAX_FILES = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".git",
  ".next",
  "coverage",
  "__pycache__",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "flake.lock",
]);

const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tif",
  ".tiff",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".o",
  ".a",
  ".lib",
  ".class",
  ".pyc",
  ".pyo",
  ".wasm",
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".tgz",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".wav",
  ".mov",
  ".avi",
  ".pdf",
  ".sqlite",
  ".db",
  ".dmg",
  ".iso",
  ".jar",
]);

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".json",
  ".md",
  ".markdown",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".rs",
  ".go",
  ".java",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".sql",
  ".graphql",
  ".gql",
  ".vue",
  ".svelte",
  ".kt",
  ".swift",
  ".cs",
  ".env",
]);

export type SnapshotResult =
  | { ok: true; dir: string; files: Record<string, string> }
  | { ok: false; code: "tarball_too_large" | "extracted_too_large" | "snapshot_failed" };

export interface ExtractTarballArgs {
  buffer: Buffer;
  runId: string;
  maxUncompressedBytes?: number;
  maxFiles?: number;
  timeoutMs?: number;
  maxCompressedBytes?: number;
}

type FailCode = "extracted_too_large" | "snapshot_failed";

function posix(p: string): string {
  return p.replaceAll("\\", "/");
}

function isSafeRunId(runId: string): boolean {
  return runId.length > 0 && !runId.includes("..") && !runId.includes("/") && !runId.includes("\\");
}

function isReadEntry(entry: object): entry is ReadEntry {
  return typeof (entry as ReadEntry).type === "string";
}

function shouldSkip(relPath: string): boolean {
  const parts = posix(relPath).split("/").filter(Boolean);
  for (const part of parts) {
    if (SKIP_DIRS.has(part)) return true;
  }
  const base = parts[parts.length - 1] ?? "";
  if (base.endsWith(".min.js")) return true;
  if (LOCKFILES.has(base)) return true;
  return BINARY_EXTS.has(extname(base).toLowerCase());
}

function isTextish(relPath: string): boolean {
  return TEXT_EXTS.has(extname(relPath).toLowerCase());
}

function collectTextFiles(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  for (const name of names) {
    const rel = posix(String(name));
    const full = join(dir, rel);
    if (!statSync(full).isFile()) continue;
    if (shouldSkip(rel) || !isTextish(rel)) continue;
    const buf = readFileSync(full);
    if (buf.includes(0)) continue;
    files[rel] = buf.toString("utf8");
  }
  return files;
}

function resultFromUnknown(err: unknown): SnapshotResult {
  const msg = err instanceof Error ? err.message : "";
  if (msg === "extracted_too_large") return { ok: false, code: "extracted_too_large" };
  return { ok: false, code: "snapshot_failed" };
}

export async function extractTarball(args: ExtractTarballArgs): Promise<SnapshotResult> {
  const maxCompressedBytes = args.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED;
  const maxUncompressedBytes = args.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED;
  const maxFiles = args.maxFiles ?? DEFAULT_MAX_FILES;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!isSafeRunId(args.runId)) return { ok: false, code: "snapshot_failed" };
  if (args.buffer.byteLength > maxCompressedBytes) return { ok: false, code: "tarball_too_large" };

  const dir = join(tmpdir(), "mergedesk", args.runId);
  const start = Date.now();
  let uncompressed = 0;
  let kept = 0;
  let abortCode: FailCode | undefined;

  const fail = (code: FailCode): false => {
    abortCode ??= code;
    return false;
  };

  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const unpack = new Unpack({
      cwd: dir,
      strip: 1,
      preservePaths: false,
      strict: true,
      filter(path, entry) {
        if (abortCode) return false;
        if (Date.now() - start >= timeoutMs) return fail("snapshot_failed");
        if (!isReadEntry(entry)) return false;
        const rel = posix(path);
        if (entry.type === "SymbolicLink" || entry.type === "Link") return false;
        if (entry.type === "Directory") return !shouldSkip(rel);
        uncompressed += Number(entry.size) || 0;
        if (uncompressed > maxUncompressedBytes) return fail("extracted_too_large");
        if (shouldSkip(rel) || !isTextish(rel)) return false;
        kept += 1;
        if (kept > maxFiles) return fail("extracted_too_large");
        return true;
      },
    });

    const timer = setTimeout(() => {
      abortCode ??= "snapshot_failed";
      unpack.abort(new Error("snapshot_failed"));
    }, timeoutMs);

    try {
      await pipeline(Readable.from(args.buffer), unpack);
    } catch (err) {
      if (abortCode) return { ok: false, code: abortCode };
      return resultFromUnknown(err);
    } finally {
      clearTimeout(timer);
    }

    if (abortCode) return { ok: false, code: abortCode };
    return { ok: true, dir, files: collectTextFiles(dir) };
  } catch (err) {
    return resultFromUnknown(err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
