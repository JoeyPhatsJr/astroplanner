import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAstroLogTarget, useLinkVariable, useUpdateLibraryTarget, type TargetPage } from "../api/astrolog";
import { useVariables, type VariableListItem } from "../api/variables";
import { FinalPicturePicker } from "../components/astrolog/FinalPicturePicker";
import { headlineLabel, imageSrc } from "../components/astrolog/TargetTile";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatCalendarDate, formatExposures, formatIntegration, formatLocalSpan } from "../lib/time";

export function TargetLogPage() {
  const { targetId } = useParams();
  const q = useAstroLogTarget(targetId);
  if (q.isLoading)
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
      </div>
    );
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Couldn't load this target" />;
  if (!q.data)
    return (
      <EmptyState title="Target not found" action={<Link to="/astrolog" className="btn">Back to library</Link>}>
        It may have been removed.
      </EmptyState>
    );
  return <TargetBody data={q.data} />;
}

function TargetBody({ data }: { data: TargetPage }) {
  const t = data.target;
  const { headline } = data;
  const fi = data.final_image;
  const nStack = data.stack?.stack_count ?? null;
  // Shown only when the backend could compute it: frames inside the stack's range is the denominator.
  const usage =
    data.percent_used !== null && data.frames_in_stack_range !== null && nStack !== null
      ? { pct: data.percent_used, n: data.frames_in_stack_range }
      : null;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <Link to="/astrolog" className="inline-flex items-center gap-1.5 self-start text-sm text-ice hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Library
      </Link>
      <div>
        <h1 className="font-semibold tracking-tight text-3xl md:text-[2.4rem]">{t.display_name}</h1>
        {t.category && <p className="mt-1 text-sm capitalize text-ink-2">{t.category}</p>}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          {fi ? (
            <figure className="panel overflow-hidden">
              <img src={imageSrc(fi.preview_url)} alt={`Final picture of ${t.display_name}`} className="w-full" width={fi.width} height={fi.height} />
              <figcaption className="px-3 py-2 text-xs text-muted">Final picture: {fi.source_filename}</figcaption>
            </figure>
          ) : (
            <div className="panel flex aspect-[4/3] items-center justify-center text-sm text-muted">No final picture yet</div>
          )}
          <section className="panel p-4" aria-label="Final picture">
            <FinalPicturePicker
              targetId={t.id}
              stacks={data.stacks}
              suggestionId={data.stack_suggestion_id}
              currentImageId={fi?.id}
              currentStackId={fi?.stack_id}
            />
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section aria-labelledby="tl-time">
            <h2 id="tl-time" className="label">
              Time on this target
            </h2>
            <div className="mt-1 flex flex-wrap items-end gap-x-3">
              <span className="font-semibold tracking-tight text-5xl text-ink">{formatIntegration(headline.seconds)}</span>
              {headline.seconds !== null && <span className="pb-1.5 text-sm text-ink-2">{headlineLabel(headline)}</span>}
            </div>
            {usage && nStack !== null && (
              <div className="mt-3">
                <div
                  className="h-2 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-label="Frames used in the final stack"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(usage.pct)}
                >
                  <div className="h-full bg-ice" style={{ width: `${Math.min(100, Math.max(0, usage.pct))}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-ink-2">
                  {nStack.toLocaleString()} of {usage.n.toLocaleString()} frames used ({Math.round(usage.pct)}%) · {formatIntegration(data.captured_s)} captured
                </p>
              </div>
            )}
            {!usage && headline.label === "stack" && data.captured_s !== null && (
              <p className="mt-1.5 text-sm text-ink-2">{formatIntegration(data.captured_s)} captured in total</p>
            )}
          </section>

          {data.facts.length > 0 && (
            <dl className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {data.facts.map((f) => (
                <div key={`${f.label}-${f.source_key}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                  <dt className="text-sm text-ink-2">
                    {f.label}
                    <span className="block text-xs text-muted">{f.source_key}</span>
                  </dt>
                  <dd className="text-sm font-medium text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {t.kind === "custom" && <ManageTarget id={t.id} name={t.display_name} />}
          {t.kind === "custom" && <LinkVariable id={t.id} name={t.display_name} />}
          {t.kind === "unsorted" && (
            <section className="panel flex flex-col gap-1 p-4" aria-labelledby="tl-manage">
              <h2 id="tl-manage" className="label">
                Unsorted
              </h2>
              <p className="text-sm text-ink-2">Re-import is not needed: name sets during import.</p>
            </section>
          )}

          <section aria-labelledby="tl-nights">
            <h2 id="tl-nights" className="label">
              Nights
            </h2>
            {data.nights.length === 0 ? (
              <p className="mt-1 text-sm text-muted">
                {data.frames_total === 0 && data.stacks.length > 0 ? "Nights unknown: only a stack was imported for this target." : "No nights recorded."}
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {data.nights.map((n) => (
                  <li key={`${n.session_id}-${n.device}`} className="flex flex-col gap-1.5">
                    <Link to={`/astrolog/nights/${n.session_id}`} className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:border-ice/40">
                      <span className="flex-1 font-medium text-ink">Night of {formatCalendarDate(n.night_date, true)}</span>
                      <span className="badge">{n.device}</span>
                      <span className="w-full text-sm text-ink-2">{formatLocalSpan(n.first_utc, n.last_utc, n.timezone)}</span>
                      <span className="w-full text-xs text-muted">
                        {formatExposures(n.frames, n.exptimes_s)} · {formatIntegration(n.captured_s)} captured{n.planned ? " · matched a plan" : ""}
                      </span>
                    </Link>
                    {n.device.trim().toLowerCase() === "seestar s30" && (
                      <Link to={`/astrolog/process/${n.capture_set_id}`} className="btn self-start" aria-label={`Process this night: ${formatCalendarDate(n.night_date, true)}`}>
                        Process this night
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ManageTarget({ id, name }: { id: string; name: string }) {
  const upd = useUpdateLibraryTarget(id);
  const navigate = useNavigate();
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const trimmed = value.trim();
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="tl-manage">
      <h2 id="tl-manage" className="label">
        Manage
      </h2>
      {upd.error && <Notice tone="warn">{upd.error instanceof Error ? upd.error.message : String(upd.error)}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="tl-rename" className="label">
            Name
          </label>
          <input id="tl-rename" className="field" value={value} maxLength={160} onChange={(e) => setValue(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn"
          disabled={!trimmed || trimmed === name || upd.isPending}
          onClick={() => upd.mutate({ custom_name: trimmed })}
        >
          Rename
        </button>
        <button
          type="button"
          className="btn"
          disabled={upd.isPending}
          onClick={() =>
            // The target is merged into the one Unsorted group (and removed): follow it there.
            void upd
              .mutateAsync({ kind: "unsorted" })
              .then((r) => r && r.target.id !== id && navigate(`/astrolog/targets/${r.target.id}`, { replace: true }))
              .catch(() => undefined)
          }
        >
          Move to Unsorted
        </button>
      </div>
    </section>
  );
}

function LinkVariable({ id, name }: { id: string; name: string }) {
  const stars = useVariables();
  const list = stars.data?.stars ?? [];
  if (list.length === 0) return null; // nothing to link to (loading, error or empty): no dead control
  return <LinkVariableForm id={id} name={name} list={list} />;
}

function LinkVariableForm({ id, name, list }: { id: string; name: string; list: VariableListItem[] }) {
  const link = useLinkVariable(id);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [starId, setStarId] = useState("");
  const chosen = list.find((s) => s.id === starId);
  return (
    <section className="panel flex flex-col gap-3 p-4" aria-labelledby="tl-link-var">
      <h2 id="tl-link-var" className="label">
        Variable star
      </h2>
      <p className="text-sm text-ink-2">If this target is one of the curated variable stars, say so and its frames count toward that star&apos;s missions.</p>
      {link.error && <Notice tone="warn">{link.error instanceof Error ? link.error.message : String(link.error)}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="tl-var-star" className="label">
            Star
          </label>
          <select id="tl-var-star" className="field" value={starId} onChange={(e) => setStarId(e.target.value)}>
            <option value="">Choose a star</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn"
          disabled={!chosen || link.isPending}
          onClick={async () => {
            if (!chosen) return;
            const ok = await confirm({
              title: `Link to ${chosen.name}?`,
              body: `"${name}" will become ${chosen.name} (merged with any existing ${chosen.name} target) and its nights will count toward that star's missions.`,
              confirmLabel: `This is ${chosen.name}`,
            });
            if (!ok) return;
            try {
              const page = await link.mutateAsync(chosen.id);
              navigate(`/astrolog/targets/${page.target.id}`, { replace: true });
            } catch {
              /* shown above */
            }
          }}
        >
          {chosen ? `This is ${chosen.name}` : "This is…"}
        </button>
      </div>
    </section>
  );
}
