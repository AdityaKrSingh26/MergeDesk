import { DEFAULT_NEBIUS_BASE_URL } from "./tokenFactory";

export const MODELS = {
  lightning: "nvidia/Nemotron-3_5-Lightning",
  super: "nvidia/nemotron-3-super-120b-a12b",
  superVl: "nvidia/Nemotron-3.5-Super-VL",
  ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

export function resolveModelId(wanted: string, liveList: Array<{ id: string }>): string {
  const ids = new Set(liveList.map((m) => m.id));
  if (ids.has(wanted)) return wanted;
  if (wanted === MODELS.lightning && ids.has(MODELS.nano)) return MODELS.nano;
  return wanted;
}

let liveCache: Array<{ id: string }> | undefined;
let liveInflight: Promise<Array<{ id: string }>> | undefined;

export function resetLiveModelsCache(): void {
  liveCache = undefined;
  liveInflight = undefined;
}

async function probeLiveModels(fetchImpl: typeof fetch): Promise<Array<{ id: string }>> {
  const base = process.env.NEBIUS_BASE_URL || DEFAULT_NEBIUS_BASE_URL;
  const url = new URL("models", base.endsWith("/") ? base : `${base}/`);
  const headers: Record<string, string> = {};
  if (process.env.NEBIUS_API_KEY) headers.Authorization = `Bearer ${process.env.NEBIUS_API_KEY}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  const parsed = Array.isArray(json.data)
    ? json.data.filter((m): m is { id: string } => typeof m?.id === "string").map((m) => ({ id: m.id }))
    : [];
  liveCache = parsed;
  return parsed;
}

/** Probe GET {base}/models. Cache a successful parse only; a failed probe retries next call. */
export async function loadLiveModels(fetchImpl: typeof fetch = fetch): Promise<Array<{ id: string }>> {
  if (liveCache) return liveCache;
  if (!liveInflight) liveInflight = probeLiveModels(fetchImpl).catch(() => []);
  const pending = liveInflight;
  try {
    return await pending;
  } finally {
    if (liveInflight === pending) liveInflight = undefined;
  }
}
