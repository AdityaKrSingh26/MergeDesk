import { MODELS, type ModelId } from "./models";

/** HACKATHON_DISPLAY_RATES — catalog 2026-10-25, not the Nebius invoice */
export const HACKATHON_DISPLAY_RATES: Record<string, { in: number; cachedIn: number; out: number }> = {
  [MODELS.lightning]: { in: 0.06, cachedIn: 0.06, out: 0.24 },
  [MODELS.nano]: { in: 0.06, cachedIn: 0.06, out: 0.24 },
  [MODELS.super]: { in: 0.30, cachedIn: 0.06, out: 0.90 },
  [MODELS.superVl]: { in: 0.30, cachedIn: 0.06, out: 0.90 },
  [MODELS.ultra]: { in: 1.00, cachedIn: 0.12, out: 3.00 },
};

export function usdEstimate(args: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}): number {
  const r = HACKATHON_DISPLAY_RATES[args.model] ?? HACKATHON_DISPLAY_RATES[MODELS.lightning];
  const uncached = Math.max(0, args.promptTokens - args.cachedTokens);
  return (
    (uncached / 1_000_000) * r.in +
    (args.cachedTokens / 1_000_000) * r.cachedIn +
    (args.completionTokens / 1_000_000) * r.out
  );
}

export function ultraWorstCaseUsd(): number {
  return usdEstimate({
    model: MODELS.ultra,
    promptTokens: 8_000,
    completionTokens: 2_048,
    cachedTokens: 0,
  });
}
