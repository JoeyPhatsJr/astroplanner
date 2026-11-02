import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Telescope } from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrentEquipment, useCurrentLocation, useEquipmentList, useLocations, useNightDate } from "../../api/hooks";
import { addDays, defaultNightDate, nightLabel, NIGHT_ROLLOVER_HOUR } from "../../lib/time";
import { usePrefs } from "../../state/prefs";

export function HeaderControls() {
  const { prefs, update } = usePrefs();
  const locations = useLocations();
  const equipment = useEquipmentList();
  const { location } = useCurrentLocation();
  const eq = useCurrentEquipment();
  const { nightDate, isAuto } = useNightDate();

  const setNight = (d: string) => {
    const auto = location ? defaultNightDate(Date.now(), location.timezone) : null;
    update({ nightDate: d === auto ? null : d });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:justify-start md:gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <MapPin className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />
        <label htmlFor="hdr-location" className="sr-only">
          Observing location
        </label>
        <select
          id="hdr-location"
          className="field max-w-[14rem] py-1.5"
          value={location?.id ?? ""}
          disabled={!locations.data?.length}
          onChange={(e) => update({ locationId: e.target.value, nightDate: null })}
        >
          {!locations.data?.length && <option value="">{locations.isLoading ? "Loading…" : "No locations"}</option>}
          {locations.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <Telescope className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />
        <label htmlFor="hdr-equipment" className="sr-only">
          Equipment profile
        </label>
        <select
          id="hdr-equipment"
          className="field max-w-[13rem] py-1.5"
          value={eq?.id ?? ""}
          disabled={!equipment.data?.length}
          onChange={(e) => update({ equipmentId: e.target.value })}
        >
          {equipment.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>

      {nightDate && location && (
        <div className="flex items-center gap-1" role="group" aria-label="Observing night">
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Previous night" onClick={() => setNight(addDays(nightDate, -1))}>
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <label htmlFor="hdr-night" className="flex items-center gap-2">
            <CalendarDays className="hidden size-4 text-muted lg:block" aria-hidden />
            <span className="hidden text-sm text-ink-2 lg:inline" title={`Times shown in ${location.timezone}`}>
              {nightLabel(nightDate)}
            </span>
            <span className="sr-only">Night date (evening of)</span>
          </label>
          <input
            id="hdr-night"
            type="date"
            className="field w-[9.5rem] py-1.5"
            value={nightDate}
            onChange={(e) => e.target.value && setNight(e.target.value)}
            aria-describedby="hdr-night-help"
          />
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Next night" onClick={() => setNight(addDays(nightDate, 1))}>
            <ChevronRight className="size-4" aria-hidden />
          </button>
          {!isAuto ? (
            <button type="button" className="btn btn-ghost hidden text-ice sm:inline-flex" onClick={() => update({ nightDate: null })}>
              Tonight
            </button>
          ) : null}
          <span id="hdr-night-help" className="sr-only">
            The date is the evening the night starts. Before {NIGHT_ROLLOVER_HOUR}:00 local time the default is the previous evening.
          </span>
        </div>
      )}
      {!locations.isLoading && !locations.data?.length && (
        <Link to="/settings" className="btn btn-primary">
          Add a location
        </Link>
      )}
      <span className="sr-only" aria-live="polite">
        {prefs.nightDate ? `Selected ${nightLabel(prefs.nightDate)}` : ""}
      </span>
    </div>
  );
}
