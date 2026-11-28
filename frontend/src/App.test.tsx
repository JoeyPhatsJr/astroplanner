import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { seedSignedIn, seedSignedOut } from "./test/auth";
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
    const ctas = screen.getAllByRole("link", { name: "See tonight’s sky" });
    expect(ctas.length).toBeGreaterThan(0);
    for (const a of ctas) expect(a).toHaveAttribute("href", "/tonight");
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

describe("tab titles", () => {
  beforeEach(() => {
    document.title = "AstroPlanner";
  });
  afterEach(cleanup);

  function renderSeeded(path: string, signedIn: boolean) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (signedIn) seedSignedIn(qc);
    else seedSignedOut(qc);
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

  it.each([
    ["/tonight", "Tonight · AstroPlanner"],
    ["/explore", "Explore · AstroPlanner"],
    ["/variables", "Variable Hunter · AstroPlanner"],
    ["/settings", "Settings · AstroPlanner"],
    ["/account", "Account · AstroPlanner"],
    ["/astrolog", "AstroLog · AstroPlanner"],
    ["/astrolog/nights", "Nights · AstroPlanner"],
    ["/astrolog/import", "Import a folder · AstroPlanner"],
    ["/astrolog/process/cs1", "Processing coach · AstroPlanner"],
    ["/no-such-page", "Page not found · AstroPlanner"],
  ])("signed in, %s is titled %s", async (path, title) => {
    renderSeeded(path, true);
    await waitFor(() => expect(document.title).toBe(title));
  });

  it("signed out, the AstroLog gate is titled AstroLog on every AstroLog route", async () => {
    for (const path of ["/astrolog", "/astrolog/targets/t1", "/astrolog/process/cs1"]) {
      renderSeeded(path, false);
      expect(await screen.findByRole("heading", { level: 1, name: "Your nights live in your account." })).toBeInTheDocument();
      expect(document.title).toBe("AstroLog · AstroPlanner");
      cleanup();
    }
  });

  it("while the account check is still waiting (a sleeping server), AstroLog pages already read AstroLog", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <PrefsProvider initial={DEFAULT_PREFS}>
            <ConfirmProvider>
              <MemoryRouter initialEntries={["/astrolog/targets/t1"]}>
                <App />
              </MemoryRouter>
            </ConfirmProvider>
          </PrefsProvider>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(document.title).toBe("AstroLog · AstroPlanner"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("puts the title back when the page goes", async () => {
    const view = renderSeeded("/explore", true);
    await waitFor(() => expect(document.title).toBe("Explore · AstroPlanner"));
    view.unmount();
    expect(document.title).toBe("AstroPlanner");
  });
});
