"use client";

import type { CalendarEvent } from "@/lib/calendar";
import { allDayOn, layoutDay } from "@/lib/layout";
import { addDays, dateOf, longDay, timeOf, type LocalDate, type LocalDateTime } from "@/lib/time";
import { eventLabel } from "./WeekView";

interface Props {
  weekStart: LocalDate;
  events: CalendarEvent[];
  now: LocalDateTime;
  highlight: Set<string>;
  disabled: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
}

/** En el móvil, siete columnas no caben: la semana se lee como una lista. */
export default function DayList({ weekStart, events, now, highlight, disabled, onOpenEvent }: Props) {
  const today = dateOf(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <ol className="space-y-6 px-4 py-5">
      {days.map((d) => {
        const allDay = allDayOn(events, d);
        const timed = layoutDay(events, d)
          .map((p) => p.event)
          .sort((a, b) => a.start.localeCompare(b.start));
        const items = [...allDay, ...timed];
        const isToday = d === today;
        return (
          <li key={d}>
            <h3
              className={`font-mono text-xs uppercase tracking-[0.2em] ${isToday ? "text-neon-cyan" : "text-zinc-500"}`}
            >
              {longDay(d)}
              {isToday && " · hoy"}
            </h3>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600">Libre</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onOpenEvent(e)}
                      aria-label={eventLabel(e)}
                      className={`flex w-full items-baseline gap-3 rounded-lg border-l-2 px-3 py-2.5 text-left ${
                        e.allDay ? "border-neon-purple bg-neon-purple/10" : "border-neon-cyan bg-[#0c2a31]"
                      } ${highlight.has(e.id) ? "destello" : ""}`}
                    >
                      <span className="w-24 shrink-0 font-mono text-xs text-zinc-400">
                        {e.allDay ? "todo el día" : `${timeOf(e.start)}–${timeOf(e.end)}`}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-zinc-100">{e.title}</span>
                        {e.location && <span className="block truncate text-xs text-zinc-500">{e.location}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
