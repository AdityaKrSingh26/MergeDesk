export function abs(n: number): number {
  if (Number.isNaN(n)) return Number.NaN;
  return n < 0 ? -n : n;
}
