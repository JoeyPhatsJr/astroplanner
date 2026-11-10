import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { qk } from "../../api/hooks";
import type { GeocodeResult } from "../../api/types";
import { findMatchingLocation } from "../../lib/locationMatch";
import type { PrefillLocationState } from "../../pages/SettingsPage";
import { usePrefs } from "../../state/prefs";

type State =
  | { kind: "idle" }
  | { kind: "tooShort" }
  | { kind: "searching" }
  | { kind: "results"; query: string; results: GeocodeResult[] }
  | { kind: "error"; message: string }
  | { kind: "saving"; label: string };

/**
 * "Clear skies tonight?": find a place, make it the current location and open Tonight for it.
 * Choosing a place reuses a saved location at the same spot (within ~1 km) or saves a new one.
 * The timezone is never guessed: if neither the search nor the coordinate lookup gives one,
 * the place is handed to Settings to finish by hand.
 */
export function CitySearch() {
  const id = useId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { update } = usePrefs();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setState({ kind: "tooShort" });
      return;
    }
    setState({ kind: "searching" });
    try {
      const r = await api.geocode(q);
      setState({ kind: "results", query: q, results: r.results });
    } catch {
      setState({ kind: "error", message: "Couldn’t reach the place search right now." });
    }
  }

  async function choose(r: GeocodeResult) {
    setState({ kind: "saving", label: r.label });
    try {
      const saved = await qc.fetchQuery({ queryKey: qk.locations, queryFn: api.locations, staleTime: 0 });
      const match = findMatchingLocation(saved, r);
      if (match) {
        update({ locationId: match.id, nightDate: null });
        navigate("/tonight");
        return;
      }
      const timezone = r.timezone ?? (await api.timezoneAt(r.latitude, r.longitude)).timezone;
      if (!timezone) {
        const state: PrefillLocationState = {
          prefillLocation: { latitude_deg: r.latitude, longitude_deg: r.longitude, timezone: null, returnTo: "/tonight" },
        };
        navigate("/settings", { state });
        return;
      }
      const created = await api.createLocation({
        label: r.label,
        latitude_deg: r.latitude,
        longitude_deg: r.longitude,
        elevation_m: r.elevation_m,
        timezone,
      });
      // The place is saved at this point; a failed refresh of the list must not report a failed save.
      await qc.invalidateQueries({ queryKey: qk.locations }).catch(() => undefined);
      update({ locationId: created.id, nightDate: null });
      navigate("/tonight");
    } catch {
      setState({ kind: "error", message: `Couldn’t save ${r.label} as a location.` });
    }
  }

  const busy = state.kind === "searching" || state.kind === "saving";

  return (
    <div className="mx-auto w-full max-w-[560px] text-left">
      <form
        role="search"
        onSubmit={search}
        className="flex gap-2 rounded-full border border-line bg-panel-2 p-1.5 focus-within:border-ice"
      >
        <label htmlFor={`${id}-city`} className="sr-only">
          Your city
        </label>
        <input
          id={`${id}-city`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your city"
          autoComplete="address-level2"
          maxLength={100}
          disabled={state.kind === "saving"}
          className="min-w-0 flex-1 bg-transparent px-4 text-base text-ink outline-none placeholder:text-muted"
        />
        <button type="submit" className="btn landing-pill landing-cta-primary" disabled={busy}>
          <Search className="size-4" aria-hidden />
          {state.kind === "searching" ? "Searching…" : "Find out"}
        </button>
      </form>

      <div aria-live="polite" className="mt-3 min-h-6 text-sm">
        {state.kind === "idle" && (
          <p className="text-center text-muted">Opens Tonight for your location. No account needed.</p>
        )}
        {state.kind === "tooShort" && <p className="text-center text-warn">Type at least two letters of a place name.</p>}
        {state.kind === "searching" && <p className="text-center text-muted">Searching places…</p>}
        {state.kind === "saving" && <p className="text-center text-muted">Opening Tonight for {state.label}…</p>}
        {state.kind === "error" && (
          <p className="text-center text-warn">
            {state.message} Try again, or{" "}
            <Link to="/settings" className="text-ice underline underline-offset-2">
              add your location in Settings
            </Link>
            .
          </p>
        )}
        {state.kind === "results" && state.results.length === 0 && (
          <p className="text-center text-muted">
            No places found for “{state.query}”. Try a nearby larger town, or{" "}
            <Link to="/settings" className="text-ice underline underline-offset-2">
              enter coordinates in Settings
            </Link>
            .
          </p>
        )}
        {state.kind === "results" && state.results.length > 0 && (
          <div className="panel overflow-hidden">
            <ul className="m-0 list-none p-0" aria-label={`Places matching ${state.query}`}>
              {state.results.map((r) => (
                <li key={`${r.latitude},${r.longitude},${r.label}`} className="border-b border-line-soft last:border-0">
                  <button
                    type="button"
                    onClick={() => choose(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left [-webkit-tap-highlight-color:transparent] hover:bg-panel-2 focus-visible:bg-panel-2 active:bg-line-soft"
                  >
                    <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
                    {r.timezone && <span className="hidden shrink-0 text-xs text-muted sm:inline">{r.timezone}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="m-0 border-t border-line-soft px-4 py-2 text-xs text-muted">
              Place search by Open-Meteo Geocoding. Choosing a place saves it to your locations.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
