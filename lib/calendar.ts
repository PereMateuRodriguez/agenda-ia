import { z } from "zod";
import {
  addDays,
  addMinutes,
  dateOf,
  isLocalDateTime,
  startOfDay,
  toMinutes,
  weekdayIndex,
  type LocalDate,
  type LocalDateTime,
} from "./time";

export const MAX_EVENTS = 1000;
const MAX_TIMED_MINUTES = 7 * 24 * 60;
const MAX_ALL_DAY_DAYS = 60;

export const eventSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  start: z.string().refine(isLocalDateTime, "start debe ser AAAA-MM-DDTHH:mm"),
  end: z.string().refine(isLocalDateTime, "end debe ser AAAA-MM-DDTHH:mm"),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export type CalendarEvent = z.infer<typeof eventSchema>;

/**
 * Error de uso, no de programación: el mensaje vuelve tal cual al modelo como
 * resultado de la herramienta, para que corrija la llamada en vez de rendirse.
 */
export class CalendarError extends Error {}

export interface NewEvent {
  title: string;
  /** Hora de inicio, o solo la fecha si es de día completo. */
  start: LocalDateTime;
  end?: LocalDateTime;
  durationMinutes?: number;
  allDay?: boolean;
  location?: string;
  notes?: string;
}

export type EventPatch = Partial<NewEvent>;

export interface Slot {
  start: LocalDateTime;
  end: LocalDateTime;
}

export interface FreeSlotQuery {
  from: LocalDateTime;
  to: LocalDateTime;
  durationMinutes: number;
  /** Franja del día en la que tiene sentido proponer huecos. */
  dayStart?: string;
  dayEnd?: string;
  includeWeekends?: boolean;
  limit?: number;
}

function defaultId(): string {
  return `ev_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Sin tildes y en minúsculas, para que "reunion" encuentre "Reunión". */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function cleanText(value: string | undefined, max: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  if (v.length > max) throw new CalendarError(`${field} no puede pasar de ${max} caracteres.`);
  return v.length > 0 ? v : undefined;
}

function hhmmToMinutes(hhmm: string, field: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) {
    throw new CalendarError(`${field} debe ser HH:mm.`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * La agenda de una petición. Vive en memoria y no sabe nada del modelo: todas
 * las reglas (duraciones, solapes, huecos) son deterministas y se prueban sin
 * LLM. El modelo decide qué hacer; lo que se puede hacer lo decide esto.
 */
export class Calendar {
  private events: CalendarEvent[];

  constructor(
    events: CalendarEvent[] = [],
    private readonly newId: () => string = defaultId,
  ) {
    this.events = events.map((e) => ({ ...e }));
  }

  all(): CalendarEvent[] {
    return [...this.events].sort(byStart);
  }

  get(id: string): CalendarEvent {
    const event = this.events.find((e) => e.id === id);
    if (!event) {
      throw new CalendarError(`No existe ningún evento con id "${id}". Búscalo antes con list_events o search_events.`);
    }
    return event;
  }

  /** Eventos que se solapan con [from, to), ordenados por inicio. */
  list(from: LocalDateTime, to: LocalDateTime): CalendarEvent[] {
    if (to <= from) throw new CalendarError("El final del rango debe ser posterior al inicio.");
    return this.events.filter((e) => overlaps(e, { start: from, end: to })).sort(byStart);
  }

  search(query: string, limit = 20): CalendarEvent[] {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) throw new CalendarError("La búsqueda está vacía.");
    return this.events
      .filter((e) => {
        const haystack = fold([e.title, e.location ?? "", e.notes ?? ""].join(" "));
        return words.every((w) => haystack.includes(w));
      })
      .sort(byStart)
      .slice(0, limit);
  }

  create(input: NewEvent): { event: CalendarEvent; overlaps: CalendarEvent[] } {
    if (this.events.length >= MAX_EVENTS) {
      throw new CalendarError(`La agenda ya tiene ${MAX_EVENTS} eventos, que es el máximo.`);
    }
    const title = cleanText(input.title, 200, "El título");
    if (!title) throw new CalendarError("El evento necesita un título.");

    const event: CalendarEvent = {
      id: this.newId(),
      title,
      ...resolveSpan(input),
      ...optional("location", cleanText(input.location, 200, "El lugar")),
      ...optional("notes", cleanText(input.notes, 2000, "Las notas")),
    };
    this.events.push(event);
    return { event, overlaps: this.overlapsOf(event) };
  }

  /**
   * Si solo cambia el inicio, el evento se mueve conservando su duración:
   * "pasa el dentista al lunes" no debería convertirlo en una cita de una hora.
   */
  update(id: string, patch: EventPatch): { event: CalendarEvent; overlaps: CalendarEvent[] } {
    const current = this.get(id);
    const allDay = patch.allDay ?? current.allDay ?? false;
    const spanChanged =
      patch.start !== undefined ||
      patch.end !== undefined ||
      patch.durationMinutes !== undefined ||
      patch.allDay !== undefined;

    let span: { start: LocalDateTime; end: LocalDateTime; allDay?: boolean } = {
      start: current.start,
      end: current.end,
      allDay: current.allDay,
    };
    if (spanChanged) {
      const keepDuration = patch.end === undefined && patch.durationMinutes === undefined && patch.allDay === undefined;
      const currentMinutes = toMinutes(current.end) - toMinutes(current.start);
      span = resolveSpan({
        title: current.title,
        start: patch.start ?? (allDay ? dateOf(current.start) : current.start),
        end: patch.end,
        allDay,
        durationMinutes: patch.durationMinutes ?? (keepDuration && !allDay ? currentMinutes : undefined),
      });
      if (keepDuration && allDay && patch.start !== undefined) {
        const days = Math.round(currentMinutes / (24 * 60));
        span.end = startOfDay(addDays(dateOf(span.start), Math.max(days, 1)));
      }
    }

    const title = patch.title === undefined ? current.title : cleanText(patch.title, 200, "El título");
    if (!title) throw new CalendarError("El evento necesita un título.");

    const next: CalendarEvent = {
      id: current.id,
      title,
      start: span.start,
      end: span.end,
      ...(span.allDay ? { allDay: true } : {}),
      ...optional(
        "location",
        patch.location === undefined ? current.location : cleanText(patch.location, 200, "El lugar"),
      ),
      ...optional("notes", patch.notes === undefined ? current.notes : cleanText(patch.notes, 2000, "Las notas")),
    };
    this.events = this.events.map((e) => (e.id === id ? next : e));
    return { event: next, overlaps: this.overlapsOf(next) };
  }

  remove(id: string): CalendarEvent {
    const event = this.get(id);
    this.events = this.events.filter((e) => e.id !== id);
    return event;
  }

  /**
   * Huecos libres de al menos `durationMinutes` dentro de la franja diaria.
   * Los eventos de día completo no bloquean, igual que en Google Calendar: un
   * cumpleaños no te ocupa la tarde.
   */
  freeSlots(q: FreeSlotQuery): Slot[] {
    if (q.to <= q.from) throw new CalendarError("El final del rango debe ser posterior al inicio.");
    if (!Number.isInteger(q.durationMinutes) || q.durationMinutes < 5 || q.durationMinutes > 24 * 60) {
      throw new CalendarError("La duración debe estar entre 5 minutos y 24 horas.");
    }
    const dayStart = hhmmToMinutes(q.dayStart ?? "09:00", "dayStart");
    const dayEnd = hhmmToMinutes(q.dayEnd ?? "20:00", "dayEnd");
    if (dayEnd <= dayStart) throw new CalendarError("dayEnd debe ser posterior a dayStart.");
    const limit = q.limit ?? 10;

    const timed = this.events.filter((e) => !e.allDay);
    const slots: Slot[] = [];
    let day: LocalDate = dateOf(q.from);
    const lastDay = dateOf(q.to);

    for (let guard = 0; day <= lastDay && guard < 366 && slots.length < limit; guard++) {
      const weekend = weekdayIndex(day) >= 5;
      if (!weekend || q.includeWeekends) {
        const windowStart = maxOf(addMinutes(startOfDay(day), dayStart), q.from);
        const windowEnd = minOf(addMinutes(startOfDay(day), dayEnd), q.to);
        if (windowStart < windowEnd) {
          let cursor = windowStart;
          const busy = timed.filter((e) => overlaps(e, { start: windowStart, end: windowEnd })).sort(byStart);
          for (const e of busy) {
            if (e.start > cursor && fits(cursor, e.start, q.durationMinutes)) {
              slots.push({ start: cursor, end: e.start });
            }
            cursor = maxOf(cursor, e.end);
          }
          if (fits(cursor, windowEnd, q.durationMinutes)) {
            slots.push({ start: cursor, end: windowEnd });
          }
        }
      }
      day = addDays(day, 1);
    }
    return slots.slice(0, limit);
  }

  private overlapsOf(event: CalendarEvent): CalendarEvent[] {
    if (event.allDay) return [];
    return this.events.filter((e) => e.id !== event.id && !e.allDay && overlaps(e, event)).sort(byStart);
  }
}

function resolveSpan(input: NewEvent): { start: LocalDateTime; end: LocalDateTime; allDay?: boolean } {
  if (input.allDay) {
    const first = dateOf(input.start);
    // En los de día completo, `end` es el último día incluido: "del 3 al 5".
    const last = input.end ? dateOf(input.end) : first;
    if (last < first) throw new CalendarError("El último día no puede ser anterior al primero.");
    const end = startOfDay(addDays(last, 1));
    if (toMinutes(end) - toMinutes(startOfDay(first)) > MAX_ALL_DAY_DAYS * 24 * 60) {
      throw new CalendarError(`Un evento de día completo no puede durar más de ${MAX_ALL_DAY_DAYS} días.`);
    }
    return { start: startOfDay(first), end, allDay: true };
  }

  const start = input.start;
  let end: LocalDateTime;
  if (input.end !== undefined) {
    end = input.end;
  } else {
    const minutes = input.durationMinutes ?? 60;
    if (!Number.isInteger(minutes) || minutes < 5) {
      throw new CalendarError("La duración debe ser de al menos 5 minutos.");
    }
    end = addMinutes(start, minutes);
  }
  if (end <= start) throw new CalendarError("El evento debe terminar después de empezar.");
  if (toMinutes(end) - toMinutes(start) > MAX_TIMED_MINUTES) {
    throw new CalendarError("Un evento con hora no puede durar más de 7 días; usa uno de día completo.");
  }
  return { start, end };
}

function optional<K extends string>(key: K, value: string | undefined): { [P in K]?: string } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: string };
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title);
}

function maxOf(a: string, b: string): string {
  return a > b ? a : b;
}

function minOf(a: string, b: string): string {
  return a < b ? a : b;
}

function fits(from: LocalDateTime, to: LocalDateTime, minutes: number): boolean {
  return toMinutes(to) - toMinutes(from) >= minutes;
}
