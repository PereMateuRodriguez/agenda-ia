"use client";

import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@/lib/calendar";
import { allDayOn, layoutDay } from "@/lib/layout";
import {
  addDays,
  addMinutes,
  dateOf,
  DIAS_CORTOS,
  diffMinutes,
  longDay,
  startOfDay,
  timeOf,
  type LocalDate,
  type LocalDateTime,
} from "@/lib/time";

const HOUR_PX = 48;
const COLUMNS = "grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]";

interface Props {
  weekStart: LocalDate;
  events: CalendarEvent[];
  now: LocalDateTime;
  highlight: Set<string>;
  disabled: boolean;
  onOpenEvent: (event: CalendarEvent) => void;
  onCreateAt: (start: LocalDateTime) => void;
}

export function eventLabel(e: CalendarEvent): string {
  if (e.allDay) return `${e.title}, ${longDay(dateOf(e.start))}, todo el día`;
  return `${e.title}, ${longDay(dateOf(e.start))} de ${timeOf(e.start)} a ${timeOf(e.end)}`;
}

export default function WeekView({ weekStart, events, now, highlight, disabled, onOpenEvent, onCreateAt }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = dateOf(now);

  // Al entrar, la rejilla arranca poco antes de las 7:00 y no a medianoche.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX - 12;
  }, []);

  const createAt = (day: LocalDate, clientY: number, target: HTMLElement) => {
    if (disabled) return;
    const y = clientY - target.getBoundingClientRect().top;
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor((y / HOUR_PX) * 2) * 30));
    onCreateAt(addMinutes(startOfDay(day), minutes));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`grid ${COLUMNS} border-b border-white/10`}>
        <div />
        {days.map((d, i) => {
          const isToday = d === today;
          return (
            <div key={d} className="px-1 py-3 text-center">
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">{DIAS_CORTOS[i]}</div>
              <div
                className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full font-display text-lg font-bold ${
                  isToday ? "bg-neon-cyan text-carbon-950" : "text-zinc-200"
                }`}
              >
                {Number(d.slice(8, 10))}
              </div>
              {isToday && <span className="sr-only">(hoy)</span>}
            </div>
          );
        })}
      </div>

      <div className={`grid ${COLUMNS} border-b border-white/10`}>
        <div className="px-1 py-1.5 font-mono text-[9px] uppercase leading-tight tracking-wider text-zinc-600">
          todo el día
        </div>
        {days.map((d) => (
          <div key={d} className="min-h-9 space-y-1 border-l border-white/5 p-1">
            {allDayOn(events, d).map((e) => (
              <button
                key={e.id}
                type="button"
                disabled={disabled}
                onClick={() => onOpenEvent(e)}
                aria-label={eventLabel(e)}
                className={`block w-full truncate rounded border-l-2 border-neon-purple bg-neon-purple/15 px-1.5 py-0.5 text-left text-xs text-violet-100 transition-colors hover:bg-neon-purple/25 ${
                  highlight.has(e.id) ? "destello" : ""
                }`}
              >
                {e.title}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className={`grid ${COLUMNS}`} style={{ height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden="true">
            {Array.from({ length: 23 }, (_, h) => (
              <span
                key={h}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-zinc-600"
                style={{ top: (h + 1) * HOUR_PX }}
              >
                {String(h + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {days.map((d) => (
            <div
              key={d}
              className={`relative border-l border-white/5 ${disabled ? "" : "cursor-copy"} ${
                d === today ? "bg-neon-cyan/[0.025]" : ""
              }`}
              style={{
                backgroundImage: "linear-gradient(to bottom, rgb(255 255 255 / 0.06) 1px, transparent 1px)",
                backgroundSize: `100% ${HOUR_PX}px`,
              }}
              onClick={(ev) => createAt(d, ev.clientY, ev.currentTarget)}
              title={disabled ? undefined : "Haz clic para crear un evento aquí"}
            >
              {layoutDay(events, d).map((p) => {
                const height = Math.max((p.height / 60) * HOUR_PX - 2, 18);
                return (
                  <button
                    key={p.event.id}
                    type="button"
                    disabled={disabled}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenEvent(p.event);
                    }}
                    aria-label={eventLabel(p.event)}
                    className={`absolute overflow-hidden rounded-md border-l-2 border-neon-cyan bg-[#0c2a31] px-1.5 py-1 text-left text-xs transition-colors hover:bg-[#10363f] ${
                      highlight.has(p.event.id) ? "destello" : ""
                    }`}
                    style={{
                      top: (p.top / 60) * HOUR_PX + 1,
                      height,
                      left: `calc(${(p.column / p.columns) * 100}% + 2px)`,
                      width: `calc(${100 / p.columns}% - 4px)`,
                    }}
                  >
                    <span
                      className={`block font-medium leading-tight text-zinc-100 ${
                        height >= 64 ? "line-clamp-2 break-words" : "truncate"
                      }`}
                    >
                      {p.event.title}
                    </span>
                    {height >= 34 && (
                      <span className="block truncate font-mono text-[10px] text-cyan-200/70">
                        {p.continuesBefore ? "…" : timeOf(p.event.start)}–{p.continuesAfter ? "…" : timeOf(p.event.end)}
                      </span>
                    )}
                    {height >= 52 && p.event.location && (
                      <span className="block truncate text-[10px] text-zinc-400">{p.event.location}</span>
                    )}
                  </button>
                );
              })}

              {d === today && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-neon-emerald"
                  style={{ top: (diffMinutes(startOfDay(d), now) / 60) * HOUR_PX }}
                  aria-hidden="true"
                >
                  <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-neon-emerald" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
