let liveSpendUsd = 0;

export function resetLiveSpend(): void {
  liveSpendUsd = 0;
}

export function recordLiveSpend(usd: number): void {
  liveSpendUsd += usd;
}

export function wouldExceedDaily(
  additionalUsd: number,
  capUsd = Number(process.env.MERGEDESK_DAILY_SPEND_CAP_USD ?? 8),
): boolean {
  return liveSpendUsd + additionalUsd > capUsd;
}
