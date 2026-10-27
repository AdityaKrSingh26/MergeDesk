const WINDOW_MS = 3_600_000;
const LIMIT = 20;

const hits = new Map<string, number[]>();

export function resetRateLimit(): void {
  hits.clear();
}

export function allowPost(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
