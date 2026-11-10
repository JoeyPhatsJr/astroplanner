import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Eye, MapPin, Telescope, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrentEquipment, useCurrentLocation, useEquipmentList, useLocations, useNightDate } from "../../api/hooks";
import { addDays, defaultNightDate, nightLabel, NIGHT_ROLLOVER_HOUR } from "../../lib/time";
import { usePrefs } from "../../state/prefs";
import { Overlay } from "../ui/Overlay";

/** Matches the stylesheet's phone breakpoint, where the drawer becomes a bottom sheet. */
const PHONE_QUERY = "(max-width: 639.98px)";

function usePhone(): boolean {
  const read = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return phone;
}

export function HeaderControls() {
  const { prefs, update } = usePrefs();
  const locations = useLocations();
  const { location } = useCurrentLocation();
  const eq = useCurrentEquipment();
  const phone = usePhone();
  const [sheetOpen, setSheetOpen] = useState(false);

  const nightVision = (
    <button
      type="button"
      className={`btn btn-ghost btn-icon gap-1.5 2xl:px-3 md:ml-auto ${prefs.nightVision ? "text-ice" : "text-ink-2"}`}
      aria-pressed={prefs.nightVision}
      aria-label="Night vision"
      title="Night vision: dim red display that preserves dark adaptation"
      onClick={() => update({ nightVision: !prefs.nightVision })}
    >
      <Eye className="size-4" aria-hidden />
      <span className="hidden text-sm 2xl:inline">Night vision</span>
    </button>
  );

  const addLocation = !locations.isLoading && !locations.data?.length && (
    <Link to="/settings" className="btn btn-primary">
      Add a location
    </Link>
  );

  const live = (
    <span className="sr-only" aria-live="polite">
      {prefs.nightDate ? `Selected ${nightLabel(prefs.nightDate)}` : ""}
    </span>
  );

  if (phone) {
    const chipText = location ? `${location.label} · ${eq?.name ?? "No equipment"}` : "No location";
    return (
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <button
          type="button"
          className="btn min-h-11 min-w-0 flex-1 justify-between gap-2 border-line-soft bg-panel text-left"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
        >
          <span className="truncate text-sm">{chipText}</span>
          <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
        {nightVision}
        {addLocation}
        {live}
        <Overlay
          open={sheetOpen}
          onClosed={() => {}}
          onDismiss={() => setSheetOpen(false)}
          onReopen={() => setSheetOpen(true)}
          variant="drawer"
          labelledBy="hdr-sheet-title"
          panelClassName="border-t border-line bg-night text-ink"
        >
          <div className="sticky top-[var(--sheet-grab)] z-10 flex items-center gap-3 border-b border-line-soft bg-night px-5 py-3">
            <h2 id="hdr-sheet-title" className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
              Location and scope
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => setSheetOpen(false)}>
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="flex flex-col gap-5 p-5">
            <Controls stacked />
          </div>
        </Overlay>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:justify-start md:gap-3">
      <Controls />
      {nightVision}
      {addLocation}
      {live}
    </div>
  );
}

/** Location, equipment and night controls; inline in the header, or stacked with visible labels in the phone sheet. */
function Controls({ stacked = false }: { stacked?: boolean }) {
  const { update } = usePrefs();
  const locations = useLocations();
  const equipment = useEquipmentList();
  const { location } = useCurrentLocation();
  const eq = useCurrentEquipment();
  const { nightDate, isAuto } = useNightDate();

  const setNight = (d: string) => {
    const auto = location ? defaultNightDate(Date.now(), location.timezone) : null;
    update({ nightDate: d === auto ? null : d });
  };

  const labelClass = stacked ? "label" : "sr-only";
  const fieldWrap = stacked ? "flex min-w-0 flex-col" : "flex min-w-0 items-center gap-1.5";
  const fieldClass = stacked ? "field w-full py-2.5" : "field py-1.5";

  return (
    <>
      <div className={fieldWrap}>
        {!stacked && <MapPin className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />}
        <label htmlFor="hdr-location" className={labelClass}>
          Observing location
        </label>
        <select
          id="hdr-location"
          className={`${fieldClass} ${stacked ? "" : "max-w-[14rem]"}`}
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

      <div className={fieldWrap}>
        {!stacked && <Telescope className="hidden size-4 shrink-0 text-muted sm:block" aria-hidden />}
        <label htmlFor="hdr-equipment" className={labelClass}>
          Equipment profile
        </label>
        <select
          id="hdr-equipment"
          className={`${fieldClass} ${stacked ? "" : "max-w-[13rem]"}`}
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
        <div className={stacked ? "flex flex-col" : "flex items-center gap-1"} role="group" aria-label="Observing night">
          {stacked && (
            <p className="label" title={`Times shown in ${location.timezone}`}>
              Night (evening of) · {nightLabel(nightDate)}
            </p>
          )}
          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Previous night" onClick={() => setNight(addDays(nightDate, -1))}>
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <label htmlFor="hdr-night" className="flex items-center gap-2">
              {!stacked && (
                <>
                  <CalendarDays className="hidden size-4 text-muted lg:block" aria-hidden />
                  <span className="hidden text-sm text-ink-2 lg:inline" title={`Times shown in ${location.timezone}`}>
                    {nightLabel(nightDate)}
                  </span>
                </>
              )}
              <span className="sr-only">Night date (evening of)</span>
            </label>
            <input
              id="hdr-night"
              type="date"
              className={`field py-1.5 ${stacked ? "min-w-0 flex-1 py-2.5" : "w-[9.5rem]"}`}
              value={nightDate}
              onChange={(e) => e.target.value && setNight(e.target.value)}
              aria-describedby="hdr-night-help"
            />
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Next night" onClick={() => setNight(addDays(nightDate, 1))}>
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
          {!isAuto ? (
            <button type="button" className={`btn btn-ghost text-ice ${stacked ? "mt-2 self-start" : "hidden sm:inline-flex"}`} onClick={() => update({ nightDate: null })}>
              Tonight
            </button>
          ) : null}
          <span id="hdr-night-help" className="sr-only">
            The date is the evening the night starts. Before {NIGHT_ROLLOVER_HOUR}:00 local time the default is the previous evening.
          </span>
        </div>
      )}
    </>
  );
}
