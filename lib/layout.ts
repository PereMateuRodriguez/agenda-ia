import type { CalendarEvent } from "./calendar";
import { addDays, diffMinutes, startOfDay, type LocalDate } from "./time";

export interface PlacedEvent {
  event: CalendarEvent;
  /** Minutos desde las 00:00 del día. */
  top: number;
  /** Duración visible en minutos, recortada al día. */
  height: number;
  column: number;
  columns: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Coloca los eventos con hora de un día en columnas para que los que se
 * solapan queden lado a lado en vez de uno encima de otro. Los que se solapan
 * entre sí (aunque sea en cadena) forman un grupo y comparten el ancho.
 */
export function layoutDay(events: CalendarEvent[], date: LocalDate): PlacedEvent[] {
  const dayStart = startOfDay(date);
  const dayEnd = startOfDay(addDays(date, 1));

  const items = events
    .filter((e) => !e.allDay && e.start < dayEnd && e.end > dayStart)
    .map((e) => {
      const start = e.start < dayStart ? dayStart : e.start;
      const end = e.end > dayEnd ? dayEnd : e.end;
      return {
        event: e,
        top: diffMinutes(dayStart, start),
        bottom: diffMinutes(dayStart, end),
        continuesBefore: e.start < dayStart,
        continuesAfter: e.end > dayEnd,
      };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

  const placed: PlacedEvent[] = [];
  let group: (PlacedEvent & { bottom: number })[] = [];
  let groupEnd = -1;
  let columnEnds: number[] = [];

  const closeGroup = () => {
    const columns = columnEnds.length;
    for (const p of group) {
      const { bottom: _b, ...rest } = p;
      placed.push({ ...rest, columns });
    }
    group = [];
    columnEnds = [];
  };

  for (const item of items) {
    if (group.length > 0 && item.top >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((end) => end <= item.top);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.bottom);
    } else {
      columnEnds[column] = item.bottom;
    }
    group.push({
      event: item.event,
      top: item.top,
      height: item.bottom - item.top,
      bottom: item.bottom,
      column,
      columns: 1,
      continuesBefore: item.continuesBefore,
      continuesAfter: item.continuesAfter,
    });
    groupEnd = Math.max(group.length === 1 ? item.bottom : groupEnd, item.bottom);
  }
  if (group.length > 0) closeGroup();
  return placed;
}

/** Eventos de día completo que caen en ese día. */
export function allDayOn(events: CalendarEvent[], date: LocalDate): CalendarEvent[] {
  const dayStart = startOfDay(date);
  const dayEnd = startOfDay(addDays(date, 1));
  return events.filter((e) => e.allDay && e.start < dayEnd && e.end > dayStart);
}
