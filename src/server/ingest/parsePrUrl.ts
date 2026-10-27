export type ParsedPr =
  | { owner: string; repo: string; number: number }
  | { error: "pr_not_found" };

const RE =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?(?:#.*)?$/i;

export function parsePrUrl(input: string): ParsedPr {
  const m = input.trim().match(RE);
  if (!m) return { error: "pr_not_found" };
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
