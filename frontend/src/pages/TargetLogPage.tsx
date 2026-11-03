import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAstroLogTarget, useUpdateLibraryTarget, type TargetPage } from "../api/astrolog";
import { FinalPicturePicker } from "../components/astrolog/FinalPicturePicker";
import { headlineLabel, imageSrc } from "../components/astrolog/TargetTile";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatCalendarDate, formatIntegration } from "../lib/time";

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
              {headline.seconds !== null && <span className="pb-1.5 text-sm text-ink-2">{headlineLabel(headline.label)}</span>}
            </div>
            {data.percent_used !== null && (
              <div className="mt-3">
                <div
                  className="h-2 overflow-hidden rounded-full bg-line"
                  role="progressbar"
                  aria-label="Frames used in the final stack"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(data.percent_used)}
                >
                  <div className="h-full bg-ice" style={{ width: `${Math.min(100, Math.max(0, data.percent_used))}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-ink-2">
                  {nStack !== null ? `${nStack.toLocaleString()} of ${data.frames_total.toLocaleString()}` : `${Math.round(data.percent_used)}% of ${data.frames_total.toLocaleString()}`}{" "}
                  frames used{nStack !== null ? ` (${Math.round(data.percent_used)}%)` : ""} · {formatIntegration(data.captured_s)} captured
                </p>
              </div>
            )}
            {data.percent_used === null && headline.label === "stack" && data.captured_s !== null && (
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

          {t.kind !== "catalog" && <ManageTarget id={t.id} name={t.display_name} kind={t.kind} />}

          <section aria-labelledby="tl-nights">
            <h2 id="tl-nights" className="label">
              Nights
            </h2>
            {data.nights.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No nights recorded.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-2">
                {data.nights.map((n) => (
                  <li key={`${n.session_id}-${n.device}`}>
                    <Link to={`/astrolog/nights/${n.session_id}`} className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:border-ice/40">
                      <span className="flex-1 font-medium text-ink">Night of {formatCalendarDate(n.night_date, true)}</span>
                      <span className="badge">{n.device}</span>
                      <span className="w-full text-xs text-muted">
                        {n.frames.toLocaleString()} frames · {formatIntegration(n.captured_s)} captured{n.planned ? " · matched a plan" : ""}
                      </span>
                    </Link>
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

function ManageTarget({ id, name, kind }: { id: string; name: string; kind: "custom" | "unsorted" | "catalog" }) {
  const upd = useUpdateLibraryTarget(id);
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
          <input id="tl-rename" className="field" value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn"
          disabled={!trimmed || trimmed === name || upd.isPending}
          onClick={() => upd.mutate({ custom_name: trimmed })}
        >
          Rename
        </button>
        {kind === "custom" && (
          <button type="button" className="btn" disabled={upd.isPending} onClick={() => upd.mutate({ kind: "unsorted" })}>
            Move to Unsorted
          </button>
        )}
      </div>
    </section>
  );
}
