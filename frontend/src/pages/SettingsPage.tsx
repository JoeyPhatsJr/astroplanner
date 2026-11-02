import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, Crosshair, ExternalLink, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { qk, useAbout, useCurrentLocation, useEquipmentList, useLocations } from "../api/hooks";
import type { EquipmentInput, EquipmentProfile, FovDefinition, GeocodeResult, LocationInput, ObservingLocation } from "../api/types";
import { MIN_ALT_OPTIONS } from "../components/targets/TargetFilters";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatLatLon } from "../lib/format";
import { usePrefs } from "../state/prefs";

export function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-8">
      <div>
        <h1 className="font-serif text-3xl tracking-tight md:text-[2.4rem]">Settings</h1>
        <p className="mt-1 text-sm text-ink-2">Locations, equipment and observing preferences are saved on this AstroPlanner server.</p>
      </div>
      <LocationsSection />
      <EquipmentSection />
      <PreferencesSection />
      <AboutSection />
    </div>
  );
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ---- Locations -----------------------------------------------------------------

function LocationsSection() {
  const q = useLocations();
  const qc = useQueryClient();
  const { prefs, update } = usePrefs();
  const currentId = useCurrentLocation().location?.id ?? null;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<ObservingLocation | "new" | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.deleteLocation(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: qk.locations });
      if (prefs.locationId === id) update({ locationId: null });
    },
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="set-loc">
      <div className="flex items-end justify-between gap-3">
        <h2 id="set-loc" className="font-serif text-2xl">
          Observing locations
        </h2>
        {editing === null && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Add location
          </button>
        )}
      </div>
      {editing !== null && (
        <LocationForm
          initial={editing === "new" ? null : editing}
          onDone={(saved) => {
            setEditing(null);
            if (saved) update({ locationId: saved.id, nightDate: null });
          }}
        />
      )}
      {del.error && <Notice tone="warn">{errMsg(del.error)}</Notice>}
      {q.isLoading && <Skeleton className="h-20" />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && editing === null && (
        <EmptyState icon={<MapPin className="size-6" />} title="No locations yet">
          Add the place you observe from. AstroPlanner never guesses your location.
        </EmptyState>
      )}
      {q.data && q.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {q.data.map((l) => (
            <li key={l.id} className={`panel flex flex-wrap items-center gap-3 px-4 py-3 ${currentId === l.id ? "border-gold/50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
                  {l.label}
                  {l.is_sample && <span className="badge border-gold/40 text-gold">Sample</span>}
                </p>
                <p className="text-xs text-muted">
                  {formatLatLon(l.latitude_deg, l.longitude_deg)}
                  {l.elevation_m !== null ? ` · ${Math.round(l.elevation_m)} m` : ""} · {l.timezone}
                </p>
              </div>
              {currentId !== l.id ? (
                <button type="button" className="btn" onClick={() => update({ locationId: l.id, nightDate: null })}>
                  Use
                </button>
              ) : (
                <span className="badge border-gold/40 text-gold">In use</span>
              )}
              <button type="button" className="btn btn-ghost btn-icon" aria-label={`Edit ${l.label}`} onClick={() => setEditing(l)}>
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon text-warn"
                aria-label={`Delete ${l.label}`}
                disabled={del.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete location “${l.label}”?`,
                    body: "Locations used by a saved session can’t be deleted until those sessions are removed.",
                    confirmLabel: "Delete location",
                    destructive: true,
                  });
                  if (ok) del.mutate(l.id);
                }}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function allTimezones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (fn) return ["UTC", ...fn("timeZone").filter((z) => z !== "UTC")];
  } catch {
    /* fall through */
  }
  return ["UTC"];
}

function LocationForm({ initial, onDone }: { initial: ObservingLocation | null; onDone: (saved: ObservingLocation | null) => void }) {
  const qc = useQueryClient();
  const zones = useMemo(allTimezones, []);
  const [label, setLabel] = useState(initial?.label ?? "");
  const [lat, setLat] = useState(initial ? String(initial.latitude_deg) : "");
  const [lon, setLon] = useState(initial ? String(initial.longitude_deg) : "");
  const [elev, setElev] = useState(initial?.elevation_m != null ? String(Math.round(initial.elevation_m)) : "");
  const [tz, setTz] = useState(initial?.timezone ?? "");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [status, setStatus] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const zoneOptions = tz && !zones.includes(tz) ? [tz, ...zones] : zones;

  const save = useMutation({
    mutationFn: (body: LocationInput) => (initial ? api.updateLocation(initial.id, body) : api.createLocation(body)),
    onSuccess: (loc) => {
      qc.invalidateQueries({ queryKey: qk.locations });
      onDone(loc);
    },
  });

  async function runSearch(e?: FormEvent) {
    e?.preventDefault();
    if (search.trim().length < 2) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.geocode(search.trim());
      setResults(r.results);
      if (!r.results.length) setStatus({ tone: "warn", text: `No places found for “${search.trim()}”.` });
    } catch (err) {
      setStatus({ tone: "warn", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  function pick(r: GeocodeResult) {
    setLabel(r.label);
    setLat(r.latitude.toFixed(5));
    setLon(r.longitude.toFixed(5));
    // Open-Meteo uses -9999 as a "no elevation" sentinel; never store it as a real value.
    const elevOk = r.elevation_m != null && r.elevation_m >= -500 && r.elevation_m <= 9000;
    setElev(elevOk ? String(Math.round(r.elevation_m!)) : "");
    if (r.timezone) setTz(r.timezone);
    setResults(null);
    setStatus({
      tone: "info",
      text: `Filled from Open-Meteo geocoding${elevOk ? "" : " (no elevation available, left blank)"}. Check the values, then save.`,
    });
  }

  async function detectTz(la = Number(lat), lo = Number(lon)) {
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
    try {
      const r = await api.timezoneAt(la, lo);
      if (r.timezone) {
        setTz(r.timezone);
        setStatus({ tone: "info", text: `Timezone set to ${r.timezone} from the coordinates. You can change it.` });
      } else setStatus({ tone: "warn", text: "No timezone found for these coordinates (open ocean?). Choose one manually." });
    } catch (err) {
      setStatus({ tone: "warn", text: errMsg(err) });
    }
  }

  function geolocate() {
    if (!("geolocation" in navigator)) {
      setStatus({ tone: "warn", text: "This browser doesn’t support location access. Enter coordinates instead." });
      return;
    }
    setBusy(true);
    setStatus({ tone: "info", text: "Asking your browser for your position…" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setLat(la.toFixed(5));
        setLon(lo.toFixed(5));
        if (pos.coords.altitude != null) setElev(String(Math.round(pos.coords.altitude)));
        if (!label) setLabel("My location");
        void detectTz(la, lo);
      },
      (err) => {
        setBusy(false);
        setStatus({
          tone: "warn",
          text: err.code === err.PERMISSION_DENIED ? "Location access was blocked. Search for a city or enter coordinates instead." : `Couldn’t get your position (${err.message}).`,
        });
      },
      { timeout: 10000, maximumAge: 600000 },
    );
  }

  const latN = Number(lat);
  const lonN = Number(lon);
  const valid =
    label.trim().length > 0 && lat !== "" && lon !== "" && Number.isFinite(latN) && latN >= -90 && latN <= 90 && Number.isFinite(lonN) && lonN >= -180 && lonN <= 180 && !!tz;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    save.mutate({
      label: label.trim(),
      latitude_deg: latN,
      longitude_deg: lonN,
      elevation_m: elev === "" ? null : Number(elev),
      timezone: tz,
    });
  }

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <h3 className="font-serif text-lg">{initial ? `Edit ${initial.label}` : "New location"}</h3>
      <form onSubmit={runSearch} className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-[200px] flex-1">
          <label htmlFor="loc-search" className="label">
            Find a city or place
          </label>
          <input id="loc-search" className="field" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. Flagstaff" />
        </div>
        <button type="submit" className="btn" disabled={busy || search.trim().length < 2}>
          <Search className="size-4" aria-hidden /> Search
        </button>
        <button type="button" className="btn" onClick={geolocate} disabled={busy}>
          <Crosshair className="size-4" aria-hidden /> Use my current position
        </button>
      </form>
      {results && results.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Search results">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button type="button" className="w-full rounded-lg border border-line-soft px-3 py-2 text-left text-sm hover:border-ice/40" onClick={() => pick(r)}>
                <span className="text-ink">{r.label}</span>
                <span className="ml-2 text-xs text-muted">
                  {formatLatLon(r.latitude, r.longitude)} · {r.timezone}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {status && <Notice tone={status.tone}>{status.text}</Notice>}

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="loc-label" className="label">
            Name
          </label>
          <input id="loc-label" className="field" required maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <label htmlFor="loc-lat" className="label">
            Latitude (°, north positive)
          </label>
          <input id="loc-lat" className="field" inputMode="decimal" required value={lat} onChange={(e) => setLat(e.target.value)} onBlur={() => !tz && detectTz()} />
        </div>
        <div>
          <label htmlFor="loc-lon" className="label">
            Longitude (°, east positive)
          </label>
          <input id="loc-lon" className="field" inputMode="decimal" required value={lon} onChange={(e) => setLon(e.target.value)} onBlur={() => !tz && detectTz()} />
        </div>
        <div>
          <label htmlFor="loc-elev" className="label">
            Elevation (m, optional)
          </label>
          <input id="loc-elev" className="field" inputMode="numeric" value={elev} onChange={(e) => setElev(e.target.value)} />
        </div>
        <div>
          <label htmlFor="loc-tz" className="label">
            Timezone (IANA)
          </label>
          <div className="flex gap-2">
            <select id="loc-tz" className="field" required value={tz} onChange={(e) => setTz(e.target.value)}>
              <option value="">Choose…</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <button type="button" className="btn shrink-0" onClick={() => detectTz()} disabled={lat === "" || lon === ""}>
              Detect
            </button>
          </div>
        </div>
        {save.error && (
          <div className="sm:col-span-2">
            <Notice tone="warn">{errMsg(save.error)}</Notice>
          </div>
        )}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
            {save.isPending ? "Saving…" : initial ? "Save changes" : "Save location"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ---- Equipment -----------------------------------------------------------------

function EquipmentSection() {
  const q = useEquipmentList();
  const qc = useQueryClient();
  const { prefs, update } = usePrefs();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<EquipmentProfile | "new" | null>(null);
  const dup = useMutation({
    mutationFn: (id: string) => api.duplicateEquipment(id),
    onSuccess: (eq) => {
      qc.invalidateQueries({ queryKey: qk.equipment });
      setEditing(eq);
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteEquipment(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: qk.equipment });
      if (prefs.equipmentId === id) update({ equipmentId: "seestar-s30" });
    },
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby="set-eq">
      <div className="flex items-end justify-between gap-3">
        <h2 id="set-eq" className="font-serif text-2xl">
          Equipment
        </h2>
        {editing === null && (
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Custom profile
          </button>
        )}
      </div>
      {editing !== null && <EquipmentForm initial={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      {(dup.error || del.error) && <Notice tone="warn">{errMsg(dup.error ?? del.error)}</Notice>}
      {q.isLoading && <Skeleton className="h-40" />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {q.data?.map((eq) => (
          <article key={eq.id} className={`panel flex flex-col gap-3 p-4 ${prefs.equipmentId === eq.id ? "border-gold/50" : ""}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <h3 className="font-medium text-ink">{eq.name}</h3>
                <p className="text-xs text-muted">{eq.manufacturer ?? "Custom profile"}</p>
              </div>
              {eq.is_preset ? (
                <span className="badge border-ice/40 text-ice">
                  <BadgeCheck className="size-3.5" aria-hidden /> Manufacturer specs
                </span>
              ) : (
                <span className="badge">Custom, unverified</span>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <Spec label="Aperture" value={eq.aperture_mm ? `${eq.aperture_mm} mm` : "–"} />
              <Spec label="Focal length" value={eq.focal_length_mm ? `${eq.focal_length_mm} mm` : "–"} />
              <Spec label="Focal ratio" value={eq.focal_ratio ? `f/${eq.focal_ratio}` : "–"} />
              <Spec label="Field of view" value={eq.fov_deg ? `${eq.fov_deg}° (${eq.fov_definition === "unknown" ? "axis unverified" : eq.fov_definition})` : "–"} />
              {eq.wide_fov_deg ? <Spec label="Wide-angle FOV" value={`${eq.wide_fov_deg}°`} /> : null}
              <Spec label="Sensor" value={eq.sensor ?? "–"} />
              <Spec label="Mount" value={eq.mount_type ?? "–"} />
            </dl>
            {eq.notes && <p className="text-xs leading-relaxed text-muted">{eq.notes}</p>}
            <div className="mt-auto flex flex-wrap gap-2">
              {prefs.equipmentId !== eq.id ? (
                <button type="button" className="btn" onClick={() => update({ equipmentId: eq.id })}>
                  Use
                </button>
              ) : (
                <span className="badge border-gold/40 text-gold">In use</span>
              )}
              {eq.is_preset ? (
                <>
                  <button type="button" className="btn" onClick={() => dup.mutate(eq.id)} disabled={dup.isPending}>
                    <Copy className="size-4" aria-hidden /> Duplicate as custom
                  </button>
                  {eq.source_url && (
                    <a className="btn btn-ghost text-ice" href={eq.source_url} target="_blank" rel="noreferrer">
                      Source <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </>
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => setEditing(eq)}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn text-warn"
                    disabled={del.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete “${eq.name}”?`,
                        body: "This removes the custom profile. The verified Seestar S30 preset is not affected.",
                        confirmLabel: "Delete profile",
                        destructive: true,
                      });
                      if (ok) del.mutate(eq.id);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden /> Delete
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink-2">{value}</dd>
    </div>
  );
}

function EquipmentForm({ initial, onDone }: { initial: EquipmentProfile | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    manufacturer: initial?.manufacturer ?? "",
    aperture_mm: initial?.aperture_mm?.toString() ?? "",
    focal_length_mm: initial?.focal_length_mm?.toString() ?? "",
    fov_deg: initial?.fov_deg?.toString() ?? "",
    fov_definition: (initial?.fov_definition ?? "unknown") as FovDefinition,
    sensor: initial?.sensor ?? "",
    mount_type: initial?.mount_type ?? "",
    notes: initial?.notes ?? "",
  });
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const save = useMutation({
    mutationFn: (body: EquipmentInput) => (initial ? api.updateEquipment(initial.id, body) : api.createEquipment(body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.equipment });
      onDone();
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const nums = [f.aperture_mm, f.focal_length_mm, f.fov_deg].map(num);
  const valid = f.name.trim() && nums.every((n) => n === null || (Number.isFinite(n) && n > 0));

  return (
    <form
      className="panel grid grid-cols-1 gap-3 p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate({
          name: f.name.trim(),
          manufacturer: f.manufacturer.trim() || null,
          aperture_mm: nums[0],
          focal_length_mm: nums[1],
          fov_deg: nums[2],
          fov_definition: f.fov_definition,
          sensor: f.sensor.trim() || null,
          mount_type: f.mount_type.trim() || null,
          notes: f.notes.trim() || null,
        });
      }}
    >
      <h3 className="font-serif text-lg sm:col-span-2">{initial ? `Edit ${initial.name}` : "New custom profile"}</h3>
      <Field id="eq-name" label="Name" value={f.name} onChange={set("name")} required />
      <Field id="eq-mf" label="Manufacturer" value={f.manufacturer} onChange={set("manufacturer")} />
      <Field id="eq-ap" label="Aperture (mm)" value={f.aperture_mm} onChange={set("aperture_mm")} inputMode="decimal" />
      <Field id="eq-fl" label="Focal length (mm)" value={f.focal_length_mm} onChange={set("focal_length_mm")} inputMode="decimal" />
      <Field id="eq-fov" label="Field of view (°)" value={f.fov_deg} onChange={set("fov_deg")} inputMode="decimal" />
      <div>
        <label htmlFor="eq-fovdef" className="label">
          Field-of-view measured along
        </label>
        <select id="eq-fovdef" className="field" value={f.fov_definition} onChange={set("fov_definition")}>
          <option value="unknown">Unknown</option>
          <option value="diagonal">Diagonal</option>
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertical</option>
        </select>
      </div>
      <Field id="eq-sensor" label="Sensor" value={f.sensor} onChange={set("sensor")} />
      <Field id="eq-mount" label="Mount" value={f.mount_type} onChange={set("mount_type")} />
      <div className="sm:col-span-2">
        <label htmlFor="eq-notes" className="label">
          Notes
        </label>
        <textarea id="eq-notes" className="field min-h-20" value={f.notes} onChange={set("notes")} maxLength={2000} />
      </div>
      {save.error && (
        <div className="sm:col-span-2">
          <Notice tone="warn">{errMsg(save.error)}</Notice>
        </div>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
          {save.isPending ? "Saving…" : initial ? "Save changes" : "Create profile"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  required,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  required?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} className="field" value={value} onChange={onChange} required={required} inputMode={inputMode} maxLength={120} />
    </div>
  );
}

// ---- Preferences & about -------------------------------------------------------

function PreferencesSection() {
  const { prefs, update } = usePrefs();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="set-pref">
      <h2 id="set-pref" className="font-serif text-2xl">
        Observing preferences
      </h2>
      <div className="panel grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
        <div>
          <label htmlFor="pref-alt" className="label">
            Minimum target altitude
          </label>
          <select id="pref-alt" className="field" value={prefs.minAltitudeDeg} onChange={(e) => update({ minAltitudeDeg: Number(e.target.value) })}>
            {MIN_ALT_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}°{a === 30 ? " (default)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">A planning rule of thumb, not a physical limit: low targets image through more atmosphere.</p>
        </div>
        <div>
          <label htmlFor="pref-dark" className="label">
            Darkness definition
          </label>
          <select id="pref-dark" className="field" value={prefs.darkness} onChange={(e) => update({ darkness: e.target.value as "astronomical" | "nautical" })}>
            <option value="astronomical">Astronomical (Sun below −18°)</option>
            <option value="nautical">Nautical (Sun below −12°)</option>
          </select>
          <p className="mt-1.5 text-xs text-muted">Nautical darkness helps at high latitudes in summer, when astronomical night never comes.</p>
        </div>
      </div>
    </section>
  );
}

function AboutSection() {
  const q = useAbout();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="set-about">
      <h2 id="set-about" className="font-serif text-2xl">
        Data sources
      </h2>
      {q.isLoading && <Skeleton className="h-32" />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <div className="panel flex flex-col gap-4 p-5">
          <ul className="flex flex-col gap-2.5 text-sm">
            {q.data.data_sources.map((s) => (
              <li key={s.name}>
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-ice hover:underline">
                  {s.name}
                </a>
                <span className="text-ink-2"> · {s.use}</span>
                <span className="block text-xs text-muted">
                  {s.license}
                  {s.version ? ` · version ${s.version.slice(0, 12)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="text-xs leading-relaxed text-muted">
            Tonight’s Score weights: {Object.entries(q.data.score_weights.tonight).map(([k, v]) => `${k} ${v}`).join(", ")}. Target score weights:{" "}
            {Object.entries(q.data.score_weights.target).map(([k, v]) => `${k} ${v}`).join(", ")}. Both are documented heuristics, not measurements.
          </div>
        </div>
      )}
    </section>
  );
}
