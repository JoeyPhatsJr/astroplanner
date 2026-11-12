import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedSignedIn } from "../../test/auth";
import { HistoryBadge } from "./HistoryBadge";

vi.mock("../../api/astrolog", () => ({
  useAstroLogHistory: () => ({ data: { m31: { library_target_id: "t1", seconds: 3600, label: "stack" } } }),
}));

afterEach(cleanup);

describe("HistoryBadge", () => {
  it("is an accent badge, not a text-ice link, so night vision does not underline it", () => {
    const qc = new QueryClient();
    seedSignedIn(qc); // the badge is personal: shown only signed in
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <HistoryBadge catalogId="m31" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = screen.getByRole("link", { name: /stacked/ });
    expect(link.classList.contains("badge")).toBe(true);
    expect(link.classList.contains("badge-accent")).toBe(true);
    expect(link.classList.contains("text-ice")).toBe(false);
  });
});
