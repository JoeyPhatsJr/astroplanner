import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../../App";
import { ConfirmProvider } from "../../components/ui/ConfirmDialog";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </ConfirmProvider>
      </PrefsProvider>
    </QueryClientProvider>,
  );
}

function noDashes(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    expect(n.textContent ?? "").not.toMatch(/[—–]/);
  }
}

describe("How it works", () => {
  it("states its working", () => {
    const { container } = renderAt("/how-it-works");
    expect(screen.getByRole("heading", { level: 1, name: "Every number shows its work." })).toBeInTheDocument();

    const rows: [string, string, string][] = [
      ["Cloud cover", "Forecast", "45"],
      ["Rain risk", "Forecast", "25"],
      ["Moonlight", "Calculated", "20"],
      ["Darkness available", "Calculated", "10"],
    ];
    const table = screen.getByRole("table", { name: /Tonight.s Score/ });
    for (const [label, badge, pts] of rows) {
      const row = within(table).getByRole("row", { name: new RegExp(label) });
      expect(within(row).getByText(badge)).toBeInTheDocument();
      expect(within(row).getByText(pts)).toBeInTheDocument();
    }

    expect(screen.getByText(/No forecast, no total\./)).toBeInTheDocument();
    expect(screen.getByText(/out of 75/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SCORING\.md/ })).toHaveAttribute(
      "href",
      "https://github.com/JoeyPhatsJr/astroplanner/blob/main/docs/SCORING.md",
    );
    noDashes(container);
  });
});
