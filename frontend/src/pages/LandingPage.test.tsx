import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeocodeResult, ObservingLocation } from "../api/types";
import { CHAPTERS, GALLERY, HERO_PHOTO } from "../components/landing/content";
import { DEFAULT_PREFS, PrefsProvider, usePrefs } from "../state/prefs";
import { LandingPage } from "./LandingPage";

const api = vi.hoisted(() => ({
  geocode: vi.fn(),
  locations: vi.fn(),
  timezoneAt: vi.fn(),
  createLocation: vi.fn(),
}));
vi.mock("../api/client", () => ({ api }));

const philly: GeocodeResult = {
  label: "Philadelphia, Pennsylvania, US",
  latitude: 39.9526,
  longitude: -75.1652,
  elevation_m: 12,
  timezone: "America/New_York",
  country_code: "US",
  population: 1_600_000,
};
const saved = (over: Partial<ObservingLocation> = {}): ObservingLocation => ({
  id: "loc-1",
  label: "Home",
  latitude_deg: 39.9526,
  longitude_deg: -75.1652,
  elevation_m: 12,
  timezone: "America/New_York",
  is_sample: false,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

function Probe({ name }: { name: string }) {
  const { prefs } = usePrefs();
  const loc = useLocation();
  return (
    <div>
      <p>{name} route</p>
      <p>locationId:{prefs.locationId ?? "none"}</p>
      <p>state:{JSON.stringify(loc.state)}</p>
    </div>
  );
}

function renderLanding() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PrefsProvider initial={DEFAULT_PREFS}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/tonight" element={<Probe name="Tonight" />} />
            <Route path="/settings" element={<Probe name="Settings" />} />
          </Routes>
        </MemoryRouter>
      </PrefsProvider>
    </QueryClientProvider>,
  );
}

async function searchFor(text: string) {
  fireEvent.change(screen.getByLabelText("Your city"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /Find out/ }));
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.locations.mockResolvedValue([]);
});
afterEach(() => {
  document.body.removeAttribute("style");
  document.body.className = "";
});

describe("LandingPage content", () => {
  it("opens with the header, then the photo", () => {
    renderLanding();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("One night. One picture. Everything in between.");
    const photo = screen.getByAltText(HERO_PHOTO.alt);
    expect(h1.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("tells the whole night, one chapter per part of the app", () => {
    renderLanding();
    for (const c of CHAPTERS) {
      expect(screen.getByRole("heading", { level: 3, name: c.title })).toBeInTheDocument();
      expect(screen.getByAltText(c.shot.alt)).toHaveAttribute("src", c.shot.src);
    }
  });

  it("labels its numbers as an example, never as live data", () => {
    renderLanding();
    expect(screen.getByText(/example night in Philadelphia/)).toBeInTheDocument();
    expect(screen.getByText(/not live\s+data/)).toBeInTheDocument();
  });

  it("only links to real app routes", () => {
    renderLanding();
    const routes = new Set(["/", "/tonight", "/explore", "/astrolog", "/variables", "/settings", "#story", "#site-main"]);
    for (const a of screen.getAllByRole("link")) {
      const href = a.getAttribute("href")!;
      if (href.startsWith("http")) continue;
      expect(routes, `unexpected link ${href}`).toContain(href);
    }
  });

  it("uses one label for every way into Tonight, and has no scroll-only call to action", () => {
    renderLanding();
    const intoTonight = screen.getAllByRole("link").filter((a) => a.getAttribute("href") === "/tonight");
    expect(intoTonight.length).toBeGreaterThan(0);
    for (const a of intoTonight) expect(a).toHaveAccessibleName("See tonight’s sky");
    expect(screen.queryByRole("link", { name: /Follow one night/ })).not.toBeInTheDocument();
  });

  it("shows every gallery photo with alt text and the object's name", () => {
    renderLanding();
    for (const p of GALLERY) {
      expect(screen.getByAltText(p.alt)).toBeInTheDocument();
      expect(screen.getByText(p.name)).toBeInTheDocument();
    }
  });

  it("reveals every chapter when there is no layout to measure", () => {
    const { container } = renderLanding();
    const chapters = container.querySelectorAll("[data-chapter]");
    expect(chapters).toHaveLength(CHAPTERS.length);
    chapters.forEach((c) => expect(c).toHaveAttribute("data-seen"));
  });

  it("paints the page sky while mounted and cleans up after", () => {
    const { unmount } = renderLanding();
    expect(document.body).toHaveClass("landing-sky");
    expect(document.body.style.backgroundColor).not.toBe("");
    unmount();
    expect(document.body).not.toHaveClass("landing-sky");
    expect(document.body.style.backgroundColor).toBe("");
  });
});

describe("Clear skies tonight? city box", () => {
  it("asks for at least two letters", async () => {
    renderLanding();
    await searchFor("a");
    expect(screen.getByText(/at least two letters/)).toBeInTheDocument();
    expect(api.geocode).not.toHaveBeenCalled();
  });

  it("reuses a saved location at the same place and opens Tonight", async () => {
    api.geocode.mockResolvedValue({ results: [philly], source: "Open-Meteo Geocoding API" });
    api.locations.mockResolvedValue([saved({ id: "home" })]);
    renderLanding();
    await searchFor("Philadelphia");
    fireEvent.click(await screen.findByRole("button", { name: /Philadelphia, Pennsylvania, US/ }));
    expect(await screen.findByText("Tonight route")).toBeInTheDocument();
    expect(screen.getByText("locationId:home")).toBeInTheDocument();
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it("saves a new place with its timezone and opens Tonight", async () => {
    api.geocode.mockResolvedValue({ results: [philly], source: "Open-Meteo Geocoding API" });
    api.createLocation.mockResolvedValue(saved({ id: "new-1", label: philly.label }));
    renderLanding();
    await searchFor("Philadelphia");
    fireEvent.click(await screen.findByRole("button", { name: /Philadelphia, Pennsylvania, US/ }));
    expect(await screen.findByText("Tonight route")).toBeInTheDocument();
    expect(api.createLocation).toHaveBeenCalledWith({
      label: "Philadelphia, Pennsylvania, US",
      latitude_deg: 39.9526,
      longitude_deg: -75.1652,
      elevation_m: 12,
      timezone: "America/New_York",
    });
    expect(api.timezoneAt).not.toHaveBeenCalled();
    expect(screen.getByText("locationId:new-1")).toBeInTheDocument();
  });

  it("looks the timezone up from coordinates when the search has none", async () => {
    api.geocode.mockResolvedValue({ results: [{ ...philly, timezone: null }], source: "x" });
    api.timezoneAt.mockResolvedValue({ timezone: "America/New_York", source: "timezonefinder" });
    api.createLocation.mockResolvedValue(saved({ id: "new-2" }));
    renderLanding();
    await searchFor("Philadelphia");
    fireEvent.click(await screen.findByRole("button", { name: /Philadelphia/ }));
    expect(await screen.findByText("Tonight route")).toBeInTheDocument();
    expect(api.timezoneAt).toHaveBeenCalledWith(39.9526, -75.1652);
    expect(api.createLocation).toHaveBeenCalledWith(expect.objectContaining({ timezone: "America/New_York" }));
  });

  it("never guesses a timezone: hands the place to Settings instead", async () => {
    api.geocode.mockResolvedValue({ results: [{ ...philly, timezone: null }], source: "x" });
    api.timezoneAt.mockResolvedValue({ timezone: null, source: "timezonefinder" });
    renderLanding();
    await searchFor("Philadelphia");
    fireEvent.click(await screen.findByRole("button", { name: /Philadelphia/ }));
    expect(await screen.findByText("Settings route")).toBeInTheDocument();
    expect(screen.getByText(/"prefillLocation":\{"latitude_deg":39.9526,"longitude_deg":-75.1652,"timezone":null,"returnTo":"\/tonight"\}/)).toBeInTheDocument();
    expect(api.createLocation).not.toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    api.geocode.mockResolvedValue({ results: [], source: "x" });
    renderLanding();
    await searchFor("Nowhereville");
    expect(await screen.findByText(/No places found for “Nowhereville”/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "enter coordinates in Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows an error with a way forward when the search fails", async () => {
    api.geocode.mockRejectedValue(new Error("502"));
    renderLanding();
    await searchFor("Philadelphia");
    expect(await screen.findByText(/Couldn’t reach the place search/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "add your location in Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows an error if saving the place fails, and stays on the page", async () => {
    api.geocode.mockResolvedValue({ results: [philly], source: "x" });
    api.createLocation.mockRejectedValue(new Error("500"));
    renderLanding();
    await searchFor("Philadelphia");
    fireEvent.click(await screen.findByRole("button", { name: /Philadelphia/ }));
    await waitFor(() => expect(screen.getByText(/Couldn’t save Philadelphia, Pennsylvania, US/)).toBeInTheDocument());
    expect(screen.queryByText("Tonight route")).not.toBeInTheDocument();
  });
});
