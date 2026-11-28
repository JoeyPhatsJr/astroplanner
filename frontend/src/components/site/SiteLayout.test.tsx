import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
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

  it("phones: the Menu button discloses the section links; Escape closes it and returns focus; a link closes it", async () => {
    renderAt("/");
    const site = screen.getByRole("navigation", { name: "Site" });
    const button = within(site).getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Closed, the links exist once (the desktop list); the panel adds no copies.
    expect(within(site).getAllByRole("link", { name: "Explore" })).toHaveLength(1);

    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(within(panel).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Explore", "/explore"],
      ["AstroLog", "/astrolog"],
      ["Variable stars", "/variables"],
    ]);

    await userEvent.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    await userEvent.click(button);
    await userEvent.click(within(document.getElementById(button.getAttribute("aria-controls")!)!).getByRole("link", { name: "Variable stars" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Variable Hunter" })).toBeInTheDocument();
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

  it("scrolls to the top when a link opens another page", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    renderAt("/");
    scrollTo.mockClear();
    await userEvent.click(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Privacy" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Your pictures stay yours." })).toBeInTheDocument());
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockRestore();
  });

  it("sets and restores the document title for site pages", async () => {
    document.title = "AstroPlanner";
    const { unmount } = renderAt("/privacy");
    expect(document.title).toBe("Privacy · AstroPlanner");
    unmount();
    expect(document.title).toBe("AstroPlanner");
  });
});
