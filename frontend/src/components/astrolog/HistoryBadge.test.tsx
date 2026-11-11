import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryBadge } from "./HistoryBadge";

vi.mock("../../api/astrolog", () => ({
  useAstroLogHistory: () => ({ data: { m31: { library_target_id: "t1", seconds: 3600, label: "stack" } } }),
}));

afterEach(cleanup);

describe("HistoryBadge", () => {
  it("is an accent badge, not a text-ice link, so night vision does not underline it", () => {
    render(
      <MemoryRouter>
        <HistoryBadge catalogId="m31" />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /stacked/ });
    expect(link.classList.contains("badge")).toBe(true);
    expect(link.classList.contains("badge-accent")).toBe(true);
    expect(link.classList.contains("text-ice")).toBe(false);
  });
});
