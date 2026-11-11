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
    for (const name of ["Never leaves your computer", "What it keeps", "Sent to other services", "Not in AstroPlanner"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/saved preferences in your browser/)).toHaveTextContent(/clearing this site's data in your browser/);
    expect(screen.getByText(/DATABASE_URL/)).toBeInTheDocument();
    expect(screen.queryByText(/For the login design/)).toBeNull();
    expect(screen.getByText(/Updated 10 Nov 2026/)).toBeInTheDocument();
    noDashes(container);
  });
});

describe("Terms", () => {
  it("is a dated draft", () => {
    const { container } = renderAt("/terms");
    expect(screen.getByRole("heading", { level: 1, name: "Plain terms." })).toBeInTheDocument();
    expect(screen.getByText(/Updated 10 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText("Draft: plain-language summary, not legal advice. Review before a public launch.")).toBeInTheDocument();
    noDashes(container);
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
