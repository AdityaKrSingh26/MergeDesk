import { tavilyHitsLabel } from "@/server/shared";
import type { Coverage } from "@/server/shared";

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";
const MAX_SEARCHES = 5;
const MAX_RESULTS = 3;
const QUOTE_MAX = 240;

export interface WebEvidence {
  kind: "tavily";
  quote: string;
  tavilyHits: number;
  url?: string;
  query: string;
}

export interface TavilyClaim {
  type: "package" | "api" | "cve";
  query: string;
  packageName?: string;
  needsExtract?: boolean;
}

function clipQuote(quote: string): string {
  return quote.length <= QUOTE_MAX ? quote : quote.slice(0, QUOTE_MAX);
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.TAVILY_API_KEY ?? ""}`,
    "Content-Type": "application/json",
  };
}

function resultList(data: unknown): Array<{ url?: unknown; content?: unknown; raw_content?: unknown }> {
  if (!data || typeof data !== "object") return [];
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter((r) => r && typeof r === "object") as Array<{
    url?: unknown;
    content?: unknown;
    raw_content?: unknown;
  }>;
}

export async function searchClaims(
  claims: TavilyClaim[],
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ evidence: WebEvidence[]; status: Coverage["tavily"] }> {
  const evidence: WebEvidence[] = [];
  let extracted = false;

  try {
    for (const claim of claims.slice(0, MAX_SEARCHES)) {
      const res = await fetchImpl(SEARCH_URL, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          query: claim.query,
          search_depth: "basic",
          max_results: MAX_RESULTS,
        }),
      });
      if (!res.ok) return { evidence, status: "failed" };

      const results = resultList(await res.json());
      if (results.length === 0) {
        evidence.push({
          kind: "tavily",
          quote: clipQuote(tavilyHitsLabel(0)),
          tavilyHits: 0,
          query: claim.query,
        });
        continue;
      }

      const top = results[0];
      const url = typeof top.url === "string" ? top.url : undefined;
      const quote = tavilyHitsLabel(results.length);

      if (!extracted && claim.needsExtract === true && url) {
        extracted = true;
        const extractRes = await fetchImpl(EXTRACT_URL, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ urls: [url] }),
        });
        if (!extractRes.ok) return { evidence, status: "failed" };
        await extractRes.json();
      }

      evidence.push({
        kind: "tavily",
        quote: clipQuote(quote),
        tavilyHits: results.length,
        ...(url ? { url } : {}),
        query: claim.query,
      });
    }

    return { evidence, status: "ok" };
  } catch {
    return { evidence: [], status: "failed" };
  }
}
