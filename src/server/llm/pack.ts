import type { ContextPack } from "@/server/shared";

const BUDGETS = {
  issue: 2_000,
  patch: 8_000,
  repoMap: 3_000,
  neighbors: 7_000,
  tavily: 1_500,
} as const;

const PATCH_HEADER = /^(diff --git |--- |\+\+\+ )/;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function clipBottom(text: string, maxTokens: number): string {
  if (approxTokens(text) <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  return text.slice(0, maxChars);
}

function clipPatch(patch: string, maxTokens: number): string {
  if (approxTokens(patch) <= maxTokens) return patch;
  const lines = patch.split("\n");
  const headers = lines.filter((line) => PATCH_HEADER.test(line)).join("\n");
  const body = lines.filter((line) => !PATCH_HEADER.test(line)).join("\n");
  const combined = body.length === 0 ? headers : headers.length === 0 ? body : `${headers}\n${body}`;
  return clipBottom(combined, maxTokens);
}

export function packContext(args: {
  issue: string;
  patch: string;
  repoMap: string;
  neighbors: string;
  tavily: string;
}): { pack: ContextPack; packTruncated: boolean } {
  const issue = clipBottom(args.issue, BUDGETS.issue);
  const patch = clipPatch(args.patch, BUDGETS.patch);
  const repoMap = clipBottom(args.repoMap, BUDGETS.repoMap);
  const neighbors = clipBottom(args.neighbors, BUDGETS.neighbors);
  const tavily = clipBottom(args.tavily, BUDGETS.tavily);
  const packTruncated =
    issue.length < args.issue.length ||
    patch.length < args.patch.length ||
    repoMap.length < args.repoMap.length ||
    neighbors.length < args.neighbors.length ||
    tavily.length < args.tavily.length;
  const pack: ContextPack = {
    issue,
    patch,
    repoMap,
    neighbors,
    tavily,
    truncated: packTruncated,
    approxTokens: {
      issue: approxTokens(issue),
      patch: approxTokens(patch),
      repoMap: approxTokens(repoMap),
      neighbors: approxTokens(neighbors),
      tavily: approxTokens(tavily),
    },
  };
  return { pack, packTruncated };
}
