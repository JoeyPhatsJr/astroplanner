import { FolderOpen, MapPin, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  astrologApi,
  type CommitResponse,
  type ImportItem,
  type PreviewGroup,
  type PreviewResponse,
  type SkippedItem,
} from "../api/astrolog";
import { qk, useLocations, useSessions } from "../api/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { batch, classifyFile, readExifSlice, readFitsHeader } from "../lib/headerSlice";
import { mergeGroups } from "../lib/importMerge";
import { formatCalendarDate, formatDateTime, formatIntegration, nightLabel } from "../lib/time";

type PickedFile = { file: File; path: string };

interface Review {
  previews: PreviewResponse[]; // one per batch of `items`, same order
}

interface Stash {
  items: ImportItem[];
  readSkipped: SkippedItem[];
  ignored: number;
}
// Header slices survive one trip to Settings (create location) and back. Set only right before
// navigating there, consumed and cleared on return, cleared on any other exit. Never persisted.
let stash: Stash | null = null;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- drag and drop folder traversal -----------------------------------------------------

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: PickedFile[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const f = await new Promise<File>((ok, err) => entry.file!(ok, err));
    out.push({ file: f, path: entry.fullPath.replace(/^\//, "") });
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const chunk = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!chunk.length) break;
      for (const c of chunk) await walk(c, out);
    }
  }
}

export function AstroLogImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const locations = useLocations();
  const folderRef = useRef<HTMLInputElement>(null);

  const routeLocationId = ((useLocation().state ?? null) as { locationId?: string | null } | null)?.locationId ?? "";
  const keepStash = useRef(false);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [readSkipped, setReadSkipped] = useState<SkippedItem[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);

  const [locationId, setLocationId] = useState<string>("");
  const [offsetInput, setOffsetInput] = useState("0");
  const [appliedOffset, setAppliedOffset] = useState(0);
  const [planChoices, setPlanChoices] = useState<Record<string, string>>({});
  const sessions = useSessions();
  const [names, setNames] = useState<Record<string, string>>({});
  const [unsorted, setUnsorted] = useState<Record<string, boolean>>({});
  const [committing, setCommitting] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = progress !== null || committing;
  const hasCr2 = useMemo(() => items.some((i) => i.kind === "cr2"), [items]);
  const batches = useMemo(() => batch(items, 300), [items]);

  /** Preview every batch with the given location/offset. Group keys come from THIS run only. */
  const runPreview = useCallback(async (all: ImportItem[], locId: string, offset: number) => {
    const batches = batch(all, 300);
    setError(null);
    const previews: PreviewResponse[] = [];
    try {
      for (let i = 0; i < batches.length; i++) {
        setProgress({ label: "Checking headers", done: i, total: batches.length });
        previews.push(
          await astrologApi.previewImport({ items: batches[i], location_id: locId || null, clock_offset_minutes: offset }),
        );
      }
      setReview({ previews });
      setNames({});
      setUnsorted({});
      setPlanChoices({});
      const ids = new Set(previews.map((p) => p.location_id));
      if (locId) setLocationId(locId);
      else setLocationId(ids.size === 1 && !previews.some((p) => p.needs_location) ? (previews[0]?.location_id ?? "") : "");
    } catch (e) {
      setReview(null);
      setError(e);
    } finally {
      setProgress(null);
    }
  }, []);

  const startWith = useCallback(
    async (files: PickedFile[]) => {
      setReview(null);
      setError(null);
      setNotice(null);
      setLocationId("");
      setOffsetInput("0");
      setAppliedOffset(0);
      const out: ImportItem[] = [];
      const skipped: SkippedItem[] = [];
      let ign = 0;
      for (let i = 0; i < files.length; i++) {
        const { file, path } = files[i];
        if (i % 20 === 0) setProgress({ label: "Reading file headers", done: i, total: files.length });
        const kind = classifyFile(path);
        if (kind === "ignored" || kind === "image") {
          ign++;
          continue;
        }
        try {
          const bytes = kind === "fits" ? await readFitsHeader(file) : await readExifSlice(file);
          out.push({ path, kind, header_b64: toB64(bytes), size: file.size });
        } catch (e) {
          skipped.push({ path, reason: describe(e) });
        }
      }
      setItems(out);
      setReadSkipped(skipped);
      setIgnored(ign);
      if (!out.length) {
        setProgress(null);
        return;
      }
      await runPreview(out, "", 0);
    },
    [runPreview],
  );

  // Returning from Settings: restore the slices and re-preview (preferring the location just created).
  useEffect(() => {
    const s = stash;
    stash = null;
    if (s) {
      setItems(s.items);
      setReadSkipped(s.readSkipped);
      setIgnored(s.ignored);
      if (s.items.length) void runPreview(s.items, routeLocationId, 0);
    }
    return () => {
      if (!keepStash.current) stash = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFolder = (list: FileList | null) => {
    if (!list || !list.length) return;
    const files = [...list].map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
    void startWith(files);
    if (folderRef.current) folderRef.current.value = "";
  };

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const entries = [...e.dataTransfer.items]
      .map((it) => (it as unknown as { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.() ?? null)
      .filter((x): x is FsEntry => !!x);
    try {
      const out: PickedFile[] = [];
      for (const en of entries) await walk(en, out);
      if (out.length) void startWith(out);
    } catch (err) {
      setError(err);
    }
  }

  // ---- derived review data ----
  const preview = review?.previews ?? [];
  const groups = useMemo(() => mergeGroups(preview), [preview]);
  const stacks = useMemo(() => preview.flatMap((p) => p.stacks), [preview]);
  const skipped = useMemo(() => [...readSkipped, ...preview.flatMap((p) => p.skipped)], [readSkipped, preview]);
  const needsLocation = preview.some((p) => p.needs_location) && !locationId;
  const candidates = useMemo(() => {
    const m = new Map<string, { id: string; label: string; distance_km: number }>();
    for (const c of preview.flatMap((p) => p.location_candidates)) if (!m.has(c.id) || m.get(c.id)!.distance_km > c.distance_km) m.set(c.id, c);
    return [...m.values()].sort((a, b) => a.distance_km - b.distance_km);
  }, [preview]);
  const ambiguousNights = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of groups) if (g.night_date && g.plan_session_ids.length > 1) m.set(g.night_date, g.plan_session_ids);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [groups]);
  const plansResolved = ambiguousNights.every(([night]) => !!planChoices[night]);
  const planLabel = (id: string) => {
    const s = sessions.data?.find((x) => x.id === id);
    return s ? `${s.title} (${nightLabel(s.local_night_date)})` : "Planned session";
  };
  const newFrames = groups.reduce((n, g) => n + g.new_frames, 0);
  const newStacks = stacks.filter((s) => s.new).length;
  const unsortedTarget = (g: PreviewGroup) => g.target.kind === "unsorted";
  const isCanonGroup = (g: PreviewGroup) => g.is_canon;
  const tzFor = locations.data?.find((l) => l.id === locationId)?.timezone ?? "UTC";
  const offsetValid = /^-?\d{1,4}$/.test(offsetInput.trim()) && Math.abs(Number(offsetInput)) <= 1440;

  function changeLocation(id: string) {
    setLocationId(id);
    if (id) void runPreview(items, id, appliedOffset);
  }

  function applyOffset() {
    if (!offsetValid) return;
    const v = Number(offsetInput);
    setAppliedOffset(v);
    void runPreview(items, locationId, v);
  }

  async function createLocationFromFile() {
    setSuggestBusy(true);
    setNotice(null);
    try {
      let found = null;
      for (const b of batch(items.filter((i) => i.kind === "fits"), 300)) {
        try {
          found = await astrologApi.suggestLocation({ items: b });
          break;
        } catch {
          /* this batch has no site; try the next */
        }
      }
      if (!found) {
        setNotice("These files contain no site position, so a location can't be suggested. Add one in Settings.");
        return;
      }
      stash = { items, readSkipped, ignored };
      keepStash.current = true;
      navigate("/settings", {
        state: { prefillLocation: { ...found, returnTo: "/astrolog/import" } },
      });
    } finally {
      setSuggestBusy(false);
    }
  }

  async function commit() {
    if (!review || !locationId || !plansResolved) return;
    setCommitting(true);
    setError(null);
    const total: CommitResponse = { session_ids: [], inserted_frames: 0, inserted_stacks: 0, skipped: [] };
    try {
      for (let i = 0; i < batches.length; i++) {
        setProgress({ label: "Importing", done: i, total: batches.length });
        const keys = new Set(review.previews[i].groups.map((g) => g.group_key));
        const canon_set_names = Object.fromEntries(
          Object.entries(names).filter(([k, v]) => keys.has(k) && v.trim() && !unsorted[k]).map(([k, v]) => [k, v.trim()]),
        );
        const unsorted_groups = Object.keys(unsorted).filter((k) => unsorted[k] && keys.has(k));
        const nights = new Set(review.previews[i].groups.map((g) => g.night_date));
        const plan_choices = Object.fromEntries(Object.entries(planChoices).filter(([n]) => nights.has(n)));
        const r = await astrologApi.commitImport({
          items: batches[i],
          location_id: locationId,
          clock_offset_minutes: appliedOffset,
          plan_choices,
          canon_set_names,
          unsorted_groups,
        });
        total.session_ids = [...new Set([...total.session_ids, ...r.session_ids])];
        total.inserted_frames += r.inserted_frames;
        total.inserted_stacks += r.inserted_stacks;
      }
      void qc.invalidateQueries({ queryKey: ["astrolog"] });
      void qc.invalidateQueries({ queryKey: qk.sessions });
      const lib = await astrologApi.library().catch(() => []);
      const first = groups.find((g) => g.new_frames > 0) ?? null;
      const named = first ? (names[first.group_key] ?? "").trim().toLowerCase() : "";
      const hit =
        first &&
        lib.find((t) =>
          first.target.catalog_target_id
            ? t.catalog_target_id === first.target.catalog_target_id
            : named
              ? t.display_name.toLowerCase() === named
              : first.target.kind === "unsorted"
                ? t.kind === "unsorted"
                : t.display_name.toLowerCase() === first.target.display_name.toLowerCase(),
        );
      if (hit) navigate(`/astrolog/targets/${hit.id}`);
      else if (total.session_ids[0]) navigate(`/astrolog/nights/${total.session_ids[0]}`);
      else navigate("/astrolog");
    } catch (e) {
      setCommitting(false);
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ["astrolog"] });
      void qc.invalidateQueries({ queryKey: qk.sessions });
      if (total.inserted_frames || total.inserted_stacks) {
        // Earlier batches were saved; refresh the review so "new" counts are accurate.
        await runPreview(items, locationId, appliedOffset);
        setNotice(
          `The import stopped part way. ${total.inserted_frames} frame${total.inserted_frames === 1 ? "" : "s"} and ${total.inserted_stacks} stack${total.inserted_stacks === 1 ? "" : "s"} were saved before the problem; the review below shows what is still new.`,
        );
      }
      setError(e);
      return;
    } finally {
      setCommitting(false);
      setProgress(null);
    }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <div>
        <Link to="/astrolog" className="text-sm text-ice hover:underline">
          Back to AstroLog
        </Link>
        <h1 className="mt-2 font-semibold tracking-tight text-3xl md:text-[2.4rem]">Import a folder</h1>
        <p className="mt-1 text-sm text-ink-2">
          Pick a folder of Seestar FITS or Canon CR2 files. Only the file headers are read in your browser and sent; the image data never leaves
          your computer.
        </p>
      </div>

      <section
        aria-labelledby="pick-h"
        className={`panel flex flex-col items-start gap-3 p-5 ${dragging ? "border-ice/60" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <h2 id="pick-h" className="font-semibold tracking-tight text-lg">
          Choose files
        </h2>
        <input
          ref={folderRef}
          id="astrolog-folder"
          type="file"
          className="sr-only"
          multiple
          // Non-standard but supported by every current browser.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          disabled={busy}
          onChange={(e) => onFolder(e.target.files)}
        />
        <label htmlFor="astrolog-folder" className={`btn btn-primary ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          <FolderOpen className="size-4" aria-hidden /> Choose folder
        </label>
        <p className="text-xs text-muted">Or drop a folder here. Working files (process folders, pp_ and r_ files, .seq, .txt, .mp4) are skipped.</p>
        {progress && (
          <div className="w-full" role="status" aria-live="polite">
            <div className="mb-1 flex justify-between text-xs text-ink-2">
              <span>{progress.label}</span>
              <span>
                {progress.done} of {progress.total}
              </span>
            </div>
            <progress className="h-2 w-full" max={100} value={pct} aria-label={progress.label} />
          </div>
        )}
      </section>

      {error != null && <ErrorState error={error} title="Import problem" onRetry={items.length ? () => void runPreview(items, locationId, appliedOffset) : undefined} />}
      {notice && <Notice tone="warn">{notice}</Notice>}

      {!review && !progress && !error && items.length === 0 && (
        <EmptyState icon={<Upload className="size-6" />} title="Nothing selected yet">
          Choose the folder from your Seestar or camera. {ignored > 0 ? `${ignored} working or non-frame files were ignored.` : ""}
        </EmptyState>
      )}
      {!review && progress && <Skeleton className="h-24" label="Preparing the review" />}

      {review && (
        <section className="flex flex-col gap-5" aria-labelledby="review-h">
          <h2 id="review-h" className="font-semibold tracking-tight text-2xl">
            Review
          </h2>

          <div className="panel grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <div>
              <label htmlFor="imp-loc" className="label">
                Observing location
              </label>
              <select id="imp-loc" className="field" value={locationId} disabled={busy} onChange={(e) => changeLocation(e.target.value)}>
                <option value="">Choose a saved location…</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                    {candidates.find((c) => c.id === l.id) ? ` (about ${Math.round(candidates.find((c) => c.id === l.id)!.distance_km)} km from the files)` : ""}
                  </option>
                ))}
              </select>
              {needsLocation && (
                <p className="mt-1 text-xs text-warn">The files match no saved location. Choose one or create it from the files.</p>
              )}
              <button type="button" className="btn mt-2" onClick={() => void createLocationFromFile()} disabled={busy || suggestBusy || !items.some((i) => i.kind === "fits")}>
                <MapPin className="size-4" aria-hidden /> Create location from file
              </button>
              <p className="mt-1 text-xs text-muted">Opens Settings with the position rounded to ~1 km.</p>
            </div>

            <div className="flex flex-col gap-4">
              {hasCr2 && (
                <div>
                  <label htmlFor="imp-offset" className="label">
                    Canon clock offset (minutes)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="imp-offset"
                      className="field"
                      inputMode="numeric"
                      value={offsetInput}
                      onChange={(e) => setOffsetInput(e.target.value)}
                      aria-invalid={!offsetValid}
                    />
                    <button type="button" className="btn shrink-0" onClick={applyOffset} disabled={busy || !offsetValid || Number(offsetInput) === appliedOffset}>
                      Apply
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">Camera times are read as local time at the chosen location, plus this offset.</p>
                </div>
              )}
              {ambiguousNights.map(([night, ids]) => (
                <div key={night}>
                  <label htmlFor={`imp-plan-${night}`} className="label">
                    Planned session for {formatCalendarDate(night, true)}
                  </label>
                  <select
                    id={`imp-plan-${night}`}
                    className="field"
                    value={planChoices[night] ?? ""}
                    onChange={(e) => setPlanChoices((c) => ({ ...c, [night]: e.target.value }))}
                  >
                    <option value="">Choose a planned session…</option>
                    {ids.map((id) => (
                      <option key={id} value={id}>
                        {planLabel(id)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted">Several plans match this night; pick the one these files belong to.</p>
                </div>
              ))}
            </div>
          </div>

          {groups.length === 0 ? (
            <EmptyState title="No capture frames found">The folder had no readable sub-frames. Stacks and skipped files are listed below.</EmptyState>
          ) : (
            <div className="panel overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">Capture groups found in the folder</caption>
                <thead className="text-xs text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2">Night</th>
                    <th scope="col" className="px-4 py-2">Target</th>
                    <th scope="col" className="px-4 py-2">Device</th>
                    <th scope="col" className="px-4 py-2 text-right">Frames</th>
                    <th scope="col" className="px-4 py-2">Captured</th>
                    <th scope="col" className="px-4 py-2 text-right">New</th>
                    <th scope="col" className="px-4 py-2">Adjust</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.group_key} className="border-t border-line-soft align-top">
                      <td className="px-4 py-2 text-ink">{g.night_date ? formatCalendarDate(g.night_date, true) : <span className="text-muted">unknown</span>}</td>
                      <td className="px-4 py-2 text-ink">{g.target.display_name}</td>
                      <td className="px-4 py-2 text-ink-2">{g.device}</td>
                      <td className="px-4 py-2 text-right text-ink-2">{g.frames}</td>
                      <td className="px-4 py-2 text-ink-2">
                        {g.first_utc ? formatDateTime(g.first_utc, tzFor) : "unknown"}
                        <span className="block text-xs text-muted">{formatIntegration(g.captured_s)} exposure</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={`badge ${g.new_frames ? "border-ice/40 text-ice" : ""}`}>{g.new_frames}</span>
                      </td>
                      <td className="px-4 py-2">
                        {isCanonGroup(g) && (
                          <div>
                            <label htmlFor={`name-${g.group_key}`} className="label">
                              Set name (optional)
                            </label>
                            <input
                              id={`name-${g.group_key}`}
                              className="field"
                              maxLength={160}
                              value={names[g.group_key] ?? ""}
                              placeholder="e.g. M 31"
                              onChange={(e) => setNames((n) => ({ ...n, [g.group_key]: e.target.value }))}
                            />
                          </div>
                        )}
                        {!unsortedTarget(g) && (
                          <label className="flex items-center gap-2 text-xs text-ink-2">
                            <input
                              type="checkbox"
                              checked={!!unsorted[g.group_key]}
                              onChange={(e) => setUnsorted((u) => ({ ...u, [g.group_key]: e.target.checked }))}
                            />
                            Move to Unsorted
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stacks.length > 0 && (
            <div className="panel p-5">
              <h3 className="font-semibold tracking-tight text-lg">Stacked images</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-2">
                {stacks.map((s) => (
                  <li key={s.path} className="flex flex-wrap items-center gap-2">
                    <span className="text-ink">{s.source_filename}</span>
                    <span>{s.target.display_name}</span>
                    <span className={`badge ${s.new ? "border-ice/40 text-ice" : ""}`}>{s.new ? "New" : "Already imported"}</span>
                    {s.livetime_s !== null && <span className="text-xs text-muted">{formatIntegration(s.livetime_s)} integration</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(skipped.length > 0 || ignored > 0) && (
            <details className="panel p-5" open={skipped.length > 0 && skipped.length <= 8}>
              <summary className="cursor-pointer font-semibold tracking-tight text-lg">
                Skipped ({skipped.length}
                {ignored > 0 ? `, plus ${ignored} working files ignored` : ""})
              </summary>
              {skipped.length > 0 && (
                <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                  {skipped.map((s, n) => (
                    <li key={`${s.path}-${n}`} className="flex flex-col sm:flex-row sm:gap-3">
                      <span className="break-all text-ink">{s.path}</span>
                      <span className="text-ink-2">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !locationId || !plansResolved || (newFrames === 0 && newStacks === 0)}
              onClick={() => void commit()}
            >
              {committing ? "Importing…" : `Import ${newFrames} new frame${newFrames === 1 ? "" : "s"}${newStacks ? ` and ${newStacks} stack${newStacks === 1 ? "" : "s"}` : ""}`}
            </button>
            {locationId && !plansResolved && <span className="text-sm text-warn">Choose a planned session for each night above.</span>}
            {!locationId && <span className="text-sm text-warn">Choose a location to import.</span>}
            {locationId && newFrames === 0 && newStacks === 0 && <span className="text-sm text-ink-2">Everything in this folder is already imported.</span>}
          </div>
        </section>
      )}
    </div>
  );
}
