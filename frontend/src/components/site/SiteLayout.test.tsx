import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../../App";
import { DEFAULT_PREFS, PrefsProvider } from "../../state/prefs";
import { ConfirmProvider } from "../ui/ConfirmDialog";

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

describe("SiteLayout", () => {
  it("renders the site header and footer around the homescreen, outside the app shell", () => {
    renderAt("/");
    expect(screen.getByRole("navigation", { name: "Site" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    const link = within(screen.getByRole("contentinfo")).getByRole("link", { name: /Source on GitHub/ });
    expect(link).toHaveAttribute("href", "https://github.com/JoeyPhatsJr/astroplanner");
  });

  it("skip link targets the main landmark", () => {
    renderAt("/");
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#site-main");
    const main = document.getElementById("site-main");
    expect(main).not.toBeNull();
    expect(main!.tagName).toBe("MAIN");
  });

  it("leaving the homescreen clears its page sky", async () => {
    renderAt("/");
    expect(document.body).toHaveClass("landing-sky");
    await userEvent.click(within(screen.getByRole("navigation", { name: "Site" })).getByRole("link", { name: "Explore" }));
    await waitFor(() => expect(document.body).not.toHaveClass("landing-sky"));
    expect(document.body.style.backgroundColor).toBe("");
  });
});
