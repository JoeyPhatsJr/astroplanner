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

describe("Privacy", () => {
  it("says what is kept and how to delete it", () => {
    const { container } = renderAt("/privacy");
    expect(screen.getByRole("heading", { level: 1, name: "Your pictures stay yours." })).toBeInTheDocument();
    for (const name of ["Read in your browser, sent only in part", "What it keeps", "Sent to other services", "Not in AstroPlanner"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Clearing this site’s data in your browser/)).toHaveTextContent(/saved preferences in your browser/);
    expect(screen.queryByText(/DATABASE_URL|on your own computer|one database file/)).toBeNull(); // no local-only wording left
    expect(screen.queryByText(/For the login design/)).toBeNull();
    expect(screen.getByText(/as it runs at astroplanner-lake\.vercel\.app\. Updated 28 Nov 2026/)).toBeInTheDocument();
    noDashes(container);
  });

  it("names where data lives, every processor, the cookie, children and a contact", () => {
    const { container } = renderAt("/privacy");
    for (const name of ["Where it’s kept", "Without an account", "Cookies and browser storage", "How long it’s kept", "Security", "Children", "Questions and changes"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    const sent = screen.getByRole("heading", { name: "Sent to other services" }).closest("section")!;
    for (const who of ["Open-Meteo", "Vercel", "Render", "Supabase"]) expect(within(sent).getByText(who)).toBeInTheDocument();
    expect(within(sent).queryByText(/STScI/)).toBeNull(); // sky pictures are off on this host
    expect(container.textContent).toMatch(/astroplanner_session/);
    expect(container.textContent).toMatch(/under 13/);
    const contact = screen.getByRole("link", { name: "open an issue on GitHub" });
    expect(contact).toHaveAttribute("href", "https://github.com/JoeyPhatsJr/astroplanner/issues");
    expect(contact).toHaveAttribute("rel", "noreferrer");
    expect(container.textContent).not.toMatch(/encrypted/i);
  });

  it("says what an account stores and how deleting it works", () => {
    const { container } = renderAt("/privacy");
    expect(screen.getByRole("heading", { level: 2, name: "Your account" })).toBeInTheDocument();
    const keeps = screen.getByRole("heading", { name: "What it keeps" }).closest("section")!;
    const items = within(keeps).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/^Your account: your email and a password hash$/);
    expect(items[1]).toHaveTextContent(/^Your places and equipment, visible only to your account$/);
    const section = screen.getByText(/^An account stores your email/);
    expect(within(section).getByRole("link", { name: "Account page" })).toHaveAttribute("href", "/account");
    expect(section).toHaveTextContent(
        "An account stores your email, a password hash (never the password itself) and your sign-in sessions, in AstroPlanner’s database. Deleting your account on the Account page removes it, its sign-in sessions, your places and equipment, your session plans and nights, your AstroLog library, your processing notes and their previews. Your original files are never touched.",
    );
    expect(screen.getAllByText(/password hash/).length).toBeGreaterThanOrEqual(2);
    // The section comes after "Pictures and stacks".
    const h2s = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2s.indexOf("Your account")).toBe(h2s.indexOf("Pictures and stacks") + 1);
    expect(container.textContent).not.toMatch(/encrypted/i);
    noDashes(container);
  });
});

describe("Terms", () => {
  it("is dated, complete, and no longer a draft", () => {
    const { container } = renderAt("/terms");
    expect(screen.getByRole("heading", { level: 1, name: "Plain terms." })).toBeInTheDocument();
    expect(screen.getByText(/Updated 28 Nov 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Draft:/)).toBeNull();
    for (const name of ["Who can use it", "Fair use of a shared, free service", "Availability", "As it is", "Law, contact and changes"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(container.textContent).toMatch(/13 or older/);
    expect(container.textContent).toMatch(/governed by the laws of Pennsylvania/);
    expect(screen.getByRole("link", { name: "open an issue on GitHub" })).toHaveAttribute("href", "https://github.com/JoeyPhatsJr/astroplanner/issues");
    noDashes(container);
  });
});

describe("Cookies", () => {
  it("lists every cookie and storage key the app uses, with no trackers", () => {
    const { container } = renderAt("/cookies");
    expect(screen.getByRole("heading", { level: 1, name: "One cookie, no trackers." })).toBeInTheDocument();
    // These names must match the code (accounts/deps.py, state/prefs.tsx, AppShell.tsx, api/browserForecast.ts).
    for (const name of ["astroplanner_session", "astroplanner.prefs.v1", "astroplanner.sidebar", "astroplanner.forecastClient"]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(container.textContent).toMatch(/no advertising, analytics or tracking cookies/);
    // The page links Privacy inline, as well as the footer.
    expect(screen.getAllByRole("link", { name: "Privacy" }).filter((a) => a.getAttribute("href") === "/privacy").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("link", { name: "open an issue on GitHub" })).toHaveAttribute("rel", "noreferrer");
    expect(document.title).toBe("Cookies · AstroPlanner");
    noDashes(container);
  });

  it("is linked from the footer and from Privacy", () => {
    renderAt("/privacy");
    expect(screen.getAllByRole("link", { name: "Cookies" }).map((a) => a.getAttribute("href"))).toEqual(["/cookies", "/cookies"]);
  });
});

describe("Credits & data", () => {
  it("lists every source with its license", () => {
    const { container } = renderAt("/credits");
    expect(screen.getByRole("heading", { level: 1, name: "Built on open science." })).toBeInTheDocument();
    for (const name of [
      "OpenNGC",
      "Open-Meteo",
      "Digitized Sky Survey (STScI)",
      "AAVSO VSX",
      "Astropy",
      "photutils",
      "timezonefinder",
      "Siril",
      "ZWO Seestar S30",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("CC BY-SA 4.0")).toBeInTheDocument();
    expect(screen.getAllByText("BSD-3-Clause")).toHaveLength(2);
    expect(screen.getByText(/GPL-3\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Catalog data: International Variable Star Index \(VSX\), operated at AAVSO, Cambridge, Massachusetts, USA\./)).toBeInTheDocument();
    expect(screen.getByText(/Digitized Sky Surveys were produced at the Space Telescope Science Institute/)).toBeInTheDocument();
    for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')) {
      expect(a).toHaveAttribute("rel", "noreferrer");
      expect(a).toHaveAttribute("target", "_blank");
    }
    noDashes(container);
  });

  it("Terms links to it", () => {
    renderAt("/terms");
    const para = screen.getByText(/Data from Open-Meteo, OpenNGC/);
    expect(within(para).getByRole("link", { name: "Credits & data" })).toHaveAttribute("href", "/credits");
  });
});
