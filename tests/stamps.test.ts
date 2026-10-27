import { describe, expect, it } from "vitest";
import { displayStamp } from "@/server/shared";

describe("displayStamp", () => {
  it("maps SHIP to No cited exceptions", () => {
    expect(displayStamp("SHIP")).toBe("No cited exceptions");
  });
  it("maps FIX to Cited exceptions", () => {
    expect(displayStamp("FIX")).toBe("Cited exceptions");
  });
  it("maps BLOCK to High-certainty exception", () => {
    expect(displayStamp("BLOCK")).toBe("High-certainty exception");
  });
});
