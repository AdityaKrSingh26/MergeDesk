import type { VerdictStamp } from "./types";

export const DISPLAY_STAMP: Record<VerdictStamp, string> = {
  SHIP: "No cited exceptions",
  FIX: "Cited exceptions",
  BLOCK: "High-certainty exception",
};

export function displayStamp(stamp: VerdictStamp): string {
  return DISPLAY_STAMP[stamp];
}
