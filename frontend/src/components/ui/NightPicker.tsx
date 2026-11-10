import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays } from "../../lib/time";
import { usePopupContainer } from "./popupContainer";

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Same day-of-month one month away, clamped to the target month's length. */
export function addMonths(isoDate: string, n: number): string {
  const d = toDate(isoDate);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return iso(target);
}

/** Weeks (Monday first) covering the month of `isoDate`; days outside the month are null. */
export function monthGrid(isoDate: string): (string | null)[][] {
  const d = toDate(isoDate);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 1; i <= days; i++) cells.push(iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), i))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Themed night-date picker: a button that opens a month grid (arrows move, Enter chooses, Esc closes). */
export function NightPicker({
  id,
  value,
  onChange,
  ariaLabel,
  describedBy,
  className = "",
}: {
  id: string;
  value: string;
  onChange: (isoDate: string) => void;
  ariaLabel: string;
  describedBy?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(value);
  const [container, triggerRef] = usePopupContainer();
  const gridRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (open) setFocused(value);
  }, [open, value]);

  // After a keyboard move, put DOM focus on the newly focused day (roving tabindex).
  useEffect(() => {
    if (!open || !moveFocus.current) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`);
    if (el) {
      el.focus();
      moveFocus.current = false;
    }
  }, [open, focused]);

  const go = (next: string) => {
    moveFocus.current = true;
    setFocused(next);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dow = (toDate(focused).getUTCDay() + 6) % 7;
    const moves: Record<string, string> = {
      ArrowLeft: addDays(focused, -1),
      ArrowRight: addDays(focused, 1),
      ArrowUp: addDays(focused, -7),
      ArrowDown: addDays(focused, 7),
      Home: addDays(focused, -dow),
      End: addDays(focused, 6 - dow),
      PageUp: addMonths(focused, -1),
      PageDown: addMonths(focused, 1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      go(moves[e.key]);
    }
  };

  const choose = (d: string) => {
    onChange(d);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        id={id}
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={`field select-trigger ${className}`}
      >
        <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left tabular-nums">{SHORT_FMT.format(toDate(value))}</span>
      </Popover.Trigger>
      <Popover.Portal container={container ?? undefined}>
        <Popover.Positioner className="pop-positioner" sideOffset={6} align="start">
          <Popover.Popup
            className="pop picker-popup"
            aria-label="Choose night"
            initialFocus={() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${value}"]`) ?? true}
          >
            <div className="flex items-center justify-between gap-1 pb-2">
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Previous month" onClick={() => go(addMonths(focused, -1))}>
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <p className="text-sm font-semibold" aria-live="polite">
                {MONTH_FMT.format(toDate(focused))}
              </p>
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Next month" onClick={() => go(addMonths(focused, 1))}>
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <div ref={gridRef} role="grid" aria-label={MONTH_FMT.format(toDate(focused))} onKeyDown={onKey}>
              <div role="row" className="picker-row">
                {WEEKDAYS.map((w) => (
                  <span key={w} role="columnheader" className="picker-head">
                    {w}
                  </span>
                ))}
              </div>
              {monthGrid(focused).map((week, i) => (
                <div key={i} role="row" className="picker-row">
                  {week.map((d, j) =>
                    d ? (
                      <div key={d} role="gridcell" aria-selected={d === value}>
                        <button
                          type="button"
                          data-date={d}
                          className="picker-day"
                          tabIndex={d === focused ? 0 : -1}
                          aria-label={DAY_FMT.format(toDate(d))}
                          onClick={() => choose(d)}
                        >
                          {Number(d.slice(8))}
                        </button>
                      </div>
                    ) : (
                      <span key={`e${j}`} role="gridcell" className="picker-blank" />
                    ),
                  )}
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
