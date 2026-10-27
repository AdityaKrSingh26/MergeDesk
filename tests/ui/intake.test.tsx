// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Home from "@/app/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

describe("intake", () => {
  it("intake shows three fixture chips with display stamps", () => {
    render(<Home />);
    expect(screen.getByRole("button", { name: /no cited exceptions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cited exceptions$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /high-certainty exception/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/github pr url/i)).toBeInTheDocument();
  });
});
