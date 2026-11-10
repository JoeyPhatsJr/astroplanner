import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "./App";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { DEFAULT_PREFS, PrefsProvider } from "./state/prefs";

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

describe("routes", () => {
  it("shows the landing page at / without the app shell", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1, name: /One night\. One picture\./ })).toBeInTheDocument();
    // The app shell's sidebar and tab bar are both labelled "Primary"; the landing page has neither.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });

  it("sends the main call to action to Tonight at /tonight", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "See tonight’s sky" })).toHaveAttribute("href", "/tonight");
  });

  it("keeps the app shell, with Tonight at /tonight, on app routes", async () => {
    renderAt("/settings");
    const navs = await screen.findAllByRole("navigation", { name: "Primary" });
    expect(navs.length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole("link", { name: "Tonight" })) {
      expect(link).toHaveAttribute("href", "/tonight");
    }
    expect(screen.getAllByRole("link", { name: /AstroPlanner home/ })[0]).toHaveAttribute("href", "/");
  });

  it("points the not-found page back to Tonight", () => {
    renderAt("/no-such-page");
    expect(screen.getByRole("link", { name: "Go to Tonight" })).toHaveAttribute("href", "/tonight");
  });
});
