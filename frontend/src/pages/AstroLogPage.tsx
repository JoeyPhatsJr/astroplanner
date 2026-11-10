import { BookOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLocations, useSessionMutations, useSessions } from "../api/hooks";
import type { ObservingSession, SessionStatus } from "../api/types";
import { SessionTargetList } from "../components/session/SessionTargetList";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { EmptyState, ErrorState, Notice, Skeleton } from "../components/ui/States";
import { formatCalendarDate, formatExposures, formatIntegration, formatLocalSpan, nightLabel } from "../lib/time";
import { usePrefs } from "../state/prefs";
import { PageHeader } from "../components/ui/PageHeader";

const STATUS_LABEL: Record<SessionStatus, string> = { planned: "Planned", completed: "Completed", cancelled: "Cancelled" };

export function AstroLogPage() {
  const { sessionId } = useParams();
  const sessions = useSessions();
  if (sessions.isLoading)
    return (
      <div className="page-reading flex flex-col gap-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  if (sessions.error) return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} title="Couldn't load sessions" />;
  const list = sessions.data ?? [];
  if (sessionId) {
    const s = list.find((x) => x.id === sessionId);
    if (!s)
      return (
        <EmptyState title="Session not found" action={<Link to="/astrolog/nights" className="btn">Back to nights</Link>}>
          It may have been deleted.
        </EmptyState>
      );
    return <SessionDetail session={s} />;
  }
  return <SessionList sessions={list} />;
}

function SessionList({ sessions }: { sessions: ObservingSession[] }) {
  return (
    <div className="page-reading flex flex-col gap-5">
      <PageHeader title="Nights" subtitle="Every night you planned or imported, newest first." back={{ to: "/astrolog", label: "Library" }} />
      {sessions.length === 0 ? (
        <EmptyState icon={<BookOpen className="size-6" />} title="No saved sessions yet" action={<Link to="/tonight" className="btn btn-primary">Plan tonight</Link>}>
          Add a target from Tonight or Explore and a session plan is created and saved automatically.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link to={`/astrolog/nights/${s.id}`} className="panel flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:border-ice/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{s.title}</span>
                  <span className="block text-xs text-muted">{nightLabel(s.local_night_date)}</span>
                </span>
                <span className="text-sm text-ink-2">
                  {s.target_count} target{s.target_count === 1 ? "" : "s"}
                </span>
                <span className={`badge ${s.status === "planned" ? "border-ice/40 text-ice" : ""}`}>{STATUS_LABEL[s.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionDetail({ session }: { session: ObservingSession }) {
  const m = useSessionMutations();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { prefs, update } = usePrefs();
  const locations = useLocations();
  const loc = locations.data?.find((l) => l.id === session.location_id) ?? null;
  const [title, setTitle] = useState(session.title);
  const [notes, setNotes] = useState(session.notes ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setTitle(session.title);
    setNotes(session.notes ?? "");
  }, [session.id, session.title, session.notes]);

  const dirty = title.trim() !== session.title || (notes || null) !== (session.notes || null);
  const busy = m.reorder.isPending || m.removeTarget.isPending;
  const err = m.update.error ?? m.reorder.error ?? m.removeTarget.error ?? m.remove.error;

  const save = async () => {
    await m.update.mutateAsync({ id: session.id, body: { title: title.trim() || session.title, notes: notes.trim() || null } });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };
  const del = async () => {
    const ok = await confirm({
      title: `Delete “${session.title}”?`,
      body: "This removes the plan and its targets. It cannot be undone.",
      confirmLabel: "Delete session",
      destructive: true,
    });
    if (!ok) return;
    try {
      await m.remove.mutateAsync(session.id);
    } catch {
      return; // shown through m.remove.error
    }
    if (prefs.activeSessionId === session.id) update({ activeSessionId: null });
    navigate("/astrolog/nights");
  };
  const hasCaptures = (session.capture_sets ?? []).length > 0;

  return (
    <div className="page-reading flex flex-col gap-5">
      <PageHeader
        title={session.title}
        back={{ to: "/astrolog/nights", label: "All nights" }}
        subtitle={
          <>
            {nightLabel(session.local_night_date)}
            {loc ? ` · ${loc.label}` : ""}
          </>
        }
        actions={
        <div className="flex gap-2">
          {prefs.nightDate !== session.local_night_date && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                update({ nightDate: session.local_night_date, locationId: session.location_id ?? prefs.locationId, activeSessionId: session.id });
                navigate("/tonight");
              }}
            >
              Open night of {formatCalendarDate(session.local_night_date)}
            </button>
          )}
          <button
            type="button"
            className="btn text-warn"
            onClick={() => void del()}
            disabled={hasCaptures || m.remove.isPending}
            title={hasCaptures ? "This night has imported captures, so it can't be deleted." : undefined}
          >
            <Trash2 className="size-4" aria-hidden /> Delete
          </button>
        </div>
        }
      />
      {err && <Notice tone="warn">{err instanceof Error ? err.message : String(err)}</Notice>}

      <section className="panel flex flex-col gap-4 p-5" aria-labelledby="sd-details">
        <h2 id="sd-details" className="font-semibold text-xl">
          Details
        </h2>
        <div>
          <label htmlFor="sd-title" className="label">
            Title
          </label>
          <input id="sd-title" className="field" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sd-notes" className="label">
            Planning notes
          </label>
          <textarea id="sd-notes" className="field min-h-24" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="sd-status" className="label">
              Status
            </label>
            <select
              id="sd-status"
              className="field py-1.5"
              value={session.status}
              onChange={(e) => m.update.mutate({ id: session.id, body: { status: e.target.value as SessionStatus } })}
            >
              <option value="planned">Planned</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <button type="button" className="btn btn-primary ml-auto self-end" disabled={!dirty || m.update.isPending} onClick={save}>
            {m.update.isPending ? "Saving…" : "Save changes"}
          </button>
          <span className="self-end text-sm text-ok" aria-live="polite">
            {saved ? "Saved" : ""}
          </span>
        </div>
      </section>

      <CaptureSummary session={session} tz={loc?.timezone ?? null} />

      <section className="panel flex flex-col gap-3 p-5" aria-labelledby="sd-targets">
        <h2 id="sd-targets" className="font-semibold text-xl">
          Targets in order
        </h2>
        {session.targets.length ? (
          <SessionTargetList
            targets={session.targets}
            tz={loc?.timezone ?? null}
            busy={busy}
            onReorder={(ids) => m.reorder.mutate({ id: session.id, ids })}
            onRemove={(stId) => m.removeTarget.mutate({ id: session.id, stId })}
          />
        ) : (
          <p className="text-sm text-muted">
            No targets. Add some from{" "}
            <Link to="/explore" className="text-ice hover:underline">
              Explore
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}

function CaptureSummary({ session, tz }: { session: ObservingSession; tz: string | null }) {
  const sets = session.capture_sets ?? [];
  const notShot = session.not_shot ?? [];
  if (!sets.length && !notShot.length) return null;
  // not_shot ids are catalog ids of this session's planned targets; their catalog summary is in the payload.
  const names = new Map(session.targets.map((t) => [t.target_id, t.target?.name ?? t.target?.primary_designation ?? t.target_id]));
  return (
    <>
      {sets.length > 0 && (
        <section className="panel flex flex-col gap-3 p-5" aria-labelledby="sd-shot">
          <h2 id="sd-shot" className="font-semibold text-xl">
            Shot
          </h2>
          <ul className="flex flex-col gap-2">
            {sets.map((c, i) => (
              <li key={`${c.library_target_id}-${i}`}>
                <Link to={`/astrolog/targets/${c.library_target_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 hover:border-ice/40">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{c.display_name}</span>
                  <span className="badge">{c.device}</span>
                  <span className="text-sm text-ink-2">
                    {formatExposures(c.frames, c.exptimes_s ?? [])} · {formatIntegration(c.captured_s)} captured
                  </span>
                  {c.first_utc && c.last_utc && (
                    <span className="w-full text-xs text-muted">{formatLocalSpan(c.first_utc, c.last_utc, tz)}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notShot.length > 0 && (
        <section className="panel flex flex-col gap-3 p-5" aria-labelledby="sd-notshot">
          <h2 id="sd-notshot" className="font-semibold text-xl">
            Planned, not shot
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
            {notShot.map((id) => (
              <li key={id}>{names.get(id) ?? id}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
