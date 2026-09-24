import { z } from "zod";
import { Calendar, CalendarError, type CalendarEvent } from "./calendar";
import { addDays, dateOf, normalizeLocal, shortDay, startOfDay, timeOf, type LocalDateTime } from "./time";
import type { ToolSpec } from "./providers/types";

/*
 * Las herramientas que ve el modelo. Los nombres van en inglés y en
 * snake_case porque es lo que los modelos pequeños han visto más veces al
 * entrenar, y con un 7B en local eso se nota en cuántas llamadas salen bien a
 * la primera. Las descripciones, en castellano, que es el idioma de la agenda.
 *
 * Cada entrada se valida con zod antes de tocar el calendario. Un modelo local
 * se equivoca de formato a menudo; cuando pasa, el error vuelve como resultado
 * de la herramienta con el motivo, y el modelo suele corregirlo solo.
 */

const date = z.string().describe("Fecha AAAA-MM-DD (también vale AAAA-MM-DDTHH:mm; se usa solo el día)");
const dateTime = z.string().describe("Fecha y hora local AAAA-MM-DDTHH:mm. En eventos de día completo, AAAA-MM-DD");
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "HH:mm");

const inputs = {
  list_events: z.object({
    from_date: date.describe("Primer día del rango, AAAA-MM-DD"),
    to_date: date.optional().describe("Último día del rango, incluido, AAAA-MM-DD. Si falta, solo from_date"),
  }),
  search_events: z.object({
    query: z.string().min(1).max(100).describe("Palabras del título, el lugar o las notas"),
  }),
  create_event: z.object({
    title: z.string().min(1).max(200).describe("Título corto, como lo escribiría una persona"),
    start: dateTime,
    end: dateTime
      .optional()
      .describe(
        "Fin AAAA-MM-DDTHH:mm. En eventos de día completo, el último día incluido. Alternativa a duration_minutes",
      ),
    duration_minutes: z
      .number()
      .int()
      .min(5)
      .max(10080)
      .optional()
      .describe("Duración en minutos si no se da end. Por defecto 60"),
    all_day: z.boolean().optional().describe("true para cumpleaños, viajes, festivos…"),
    location: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  }),
  update_event: z.object({
    id: z.string().min(1).describe("id del evento, sacado de list_events o search_events"),
    title: z.string().min(1).max(200).optional(),
    start: dateTime.optional().describe("Nuevo inicio. Si no se da end ni duration_minutes, se conserva la duración"),
    end: dateTime.optional(),
    duration_minutes: z.number().int().min(5).max(10080).optional(),
    all_day: z.boolean().optional(),
    location: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  }),
  delete_event: z.object({
    id: z.string().min(1).describe("id del evento, sacado de list_events o search_events"),
  }),
  find_free_slots: z.object({
    from_date: date.describe("Primer día en el que buscar, AAAA-MM-DD"),
    to_date: date.describe("Último día en el que buscar, incluido, AAAA-MM-DD"),
    duration_minutes: z.number().int().min(5).max(1440).describe("Minutos que hacen falta"),
    day_start: hhmm.optional().describe("Desde qué hora buscar cada día, HH:mm. Por defecto 09:00"),
    day_end: hhmm.optional().describe("Hasta qué hora buscar cada día, HH:mm. Por defecto 20:00"),
    include_weekends: z.boolean().optional().describe("Por defecto false"),
  }),
} as const;

export type ToolName = keyof typeof inputs;

const descriptions: Record<ToolName, string> = {
  list_events:
    "Lista los eventos de un día o de un rango de días. Úsala antes de responder qué hay en la agenda y para encontrar el id de un evento por su fecha.",
  search_events:
    "Busca eventos por texto (título, lugar o notas), sin importar la fecha. Úsala para encontrar el id de un evento que el usuario nombra.",
  create_event: "Crea un evento. Devuelve el evento creado y los eventos con los que se solapa, si los hay.",
  update_event:
    "Modifica un evento existente: moverlo, cambiar su duración, título, lugar o notas. Solo se cambian los campos que se envían.",
  delete_event: "Borra un evento por su id.",
  find_free_slots:
    "Busca huecos libres de al menos una duración dentro de un rango de días. Solo devuelve huecos futuros.",
};

export const TOOL_SPECS: ToolSpec[] = (Object.keys(inputs) as ToolName[]).map((name) => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(inputs[name]) as Record<string, unknown>;
  return { name, description: descriptions[name], inputSchema: schema };
});

export interface ToolContext {
  calendar: Calendar;
  now: LocalDateTime;
}

export interface ToolOutcome {
  /** Lo que lee el modelo, en JSON. */
  content: string;
  isError: boolean;
  /** Una línea para la interfaz: qué ha hecho el agente, en cristiano. */
  summary: string;
  /** Si la agenda ha cambiado; la interfaz lo usa para ofrecer deshacer. */
  changed: boolean;
}

/** Cómo ve el modelo un evento: los datos, y el día ya escrito para no tener que calcularlo. */
export function describeEvent(e: CalendarEvent) {
  return {
    id: e.id,
    title: e.title,
    when: when(e),
    start: e.allDay ? dateOf(e.start) : e.start,
    end: e.allDay ? addDays(dateOf(e.end), -1) : e.end,
    ...(e.allDay ? { all_day: true } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
  };
}

export function when(e: CalendarEvent): string {
  if (e.allDay) {
    const last = addDays(dateOf(e.end), -1);
    const first = dateOf(e.start);
    return first === last ? `${shortDay(first)}, todo el día` : `${shortDay(first)} – ${shortDay(last)}, todo el día`;
  }
  const sameDay = dateOf(e.start) === dateOf(e.end) || e.end === startOfDay(addDays(dateOf(e.start), 1));
  return sameDay
    ? `${shortDay(dateOf(e.start))} ${timeOf(e.start)}–${timeOf(e.end)}`
    : `${shortDay(dateOf(e.start))} ${timeOf(e.start)} – ${shortDay(dateOf(e.end))} ${timeOf(e.end)}`;
}

function toDate(value: string, field: string): string {
  const n = normalizeLocal(value);
  if (!n) throw new CalendarError(`${field} no es una fecha válida (AAAA-MM-DD): "${value}".`);
  return dateOf(n);
}

function toDateTime(value: string, field: string): LocalDateTime {
  const n = normalizeLocal(value);
  if (!n) throw new CalendarError(`${field} no es una fecha válida (AAAA-MM-DDTHH:mm): "${value}".`);
  return n;
}

function ok(payload: unknown, summary: string, changed = false): ToolOutcome {
  return { content: JSON.stringify(payload), isError: false, summary, changed };
}

function fail(message: string, summary: string): ToolOutcome {
  return { content: JSON.stringify({ error: message }), isError: true, summary, changed: false };
}

function pastWarning(e: CalendarEvent, now: LocalDateTime): { warning?: string } {
  return e.end <= now ? { warning: "El evento queda en el pasado. Si no era la intención, revisa la fecha." } : {};
}

/**
 * Los modelos pequeños mandan a menudo `"90"` por `90` o `"true"` por `true`.
 * Se arregla aquí, en vez de gastar una vuelta del bucle en un error que no
 * aporta nada. Solo se tocan campos numéricos y booleanos conocidos.
 */
function looseTypes(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...input };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== "string") continue;
    if (key.endsWith("_minutes") && /^\d+$/.test(value.trim())) out[key] = Number(value);
    if ((key === "all_day" || key === "include_weekends") && /^(true|false)$/i.test(value.trim())) {
      out[key] = value.trim().toLowerCase() === "true";
    }
  }
  return out;
}

export function executeTool(name: string, rawInput: unknown, ctx: ToolContext): ToolOutcome {
  if (!(name in inputs)) {
    return fail(`La herramienta "${name}" no existe.`, `Herramienta desconocida: ${name}`);
  }
  const tool = name as ToolName;
  const parsed = inputs[tool].safeParse(looseTypes(rawInput ?? {}));
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; ");
    return fail(`Parámetros inválidos para ${tool}: ${detail}`, `${tool}: parámetros inválidos`);
  }

  try {
    return run(tool, parsed.data, ctx);
  } catch (err) {
    if (err instanceof CalendarError) return fail(err.message, `${tool}: ${err.message}`);
    throw err;
  }
}

function run(tool: ToolName, input: z.infer<(typeof inputs)[ToolName]>, ctx: ToolContext): ToolOutcome {
  const { calendar, now } = ctx;
  switch (tool) {
    case "list_events": {
      const i = input as z.infer<typeof inputs.list_events>;
      const from = toDate(i.from_date, "from_date");
      const to = i.to_date ? toDate(i.to_date, "to_date") : from;
      if (to < from) throw new CalendarError("to_date no puede ser anterior a from_date.");
      const events = calendar.list(startOfDay(from), startOfDay(addDays(to, 1)));
      const range = from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`;
      return ok(
        events.length > 0
          ? { events: events.map(describeEvent) }
          : { events: [], note: "No hay ningún evento en ese rango." },
        `Consultada la agenda: ${range} (${events.length} ${events.length === 1 ? "evento" : "eventos"})`,
      );
    }
    case "search_events": {
      const i = input as z.infer<typeof inputs.search_events>;
      const events = calendar.search(i.query);
      return ok(
        events.length > 0
          ? { events: events.map(describeEvent) }
          : { events: [], note: `Ningún evento contiene "${i.query}".` },
        `Buscado «${i.query}» (${events.length} ${events.length === 1 ? "resultado" : "resultados"})`,
      );
    }
    case "create_event": {
      const i = input as z.infer<typeof inputs.create_event>;
      const { event, overlaps } = calendar.create({
        title: i.title,
        start: toDateTime(i.start, "start"),
        end: i.end ? toDateTime(i.end, "end") : undefined,
        durationMinutes: i.duration_minutes,
        allDay: i.all_day,
        location: i.location,
        notes: i.notes,
      });
      return ok(
        {
          created: describeEvent(event),
          overlaps_with: overlaps.map(describeEvent),
          ...pastWarning(event, now),
        },
        `Creado «${event.title}» · ${when(event)}${overlaps.length ? " (se solapa)" : ""}`,
        true,
      );
    }
    case "update_event": {
      const i = input as z.infer<typeof inputs.update_event>;
      const before = calendar.get(i.id);
      const { event, overlaps } = calendar.update(i.id, {
        title: i.title,
        start: i.start ? toDateTime(i.start, "start") : undefined,
        end: i.end ? toDateTime(i.end, "end") : undefined,
        durationMinutes: i.duration_minutes,
        allDay: i.all_day,
        location: i.location,
        notes: i.notes,
      });
      const moved = when(before) !== when(event) ? ` · ${when(before)} → ${when(event)}` : "";
      return ok(
        {
          updated: describeEvent(event),
          overlaps_with: overlaps.map(describeEvent),
          ...pastWarning(event, now),
        },
        `Modificado «${event.title}»${moved}`,
        true,
      );
    }
    case "delete_event": {
      const i = input as z.infer<typeof inputs.delete_event>;
      const event = calendar.remove(i.id);
      return ok({ deleted: describeEvent(event) }, `Borrado «${event.title}» · ${when(event)}`, true);
    }
    case "find_free_slots": {
      const i = input as z.infer<typeof inputs.find_free_slots>;
      const from = toDate(i.from_date, "from_date");
      const to = toDate(i.to_date, "to_date");
      if (to < from) throw new CalendarError("to_date no puede ser anterior a from_date.");
      const rangeStart = startOfDay(from) > now ? startOfDay(from) : now;
      const rangeEnd = startOfDay(addDays(to, 1));
      const slots =
        rangeStart < rangeEnd
          ? calendar.freeSlots({
              from: rangeStart,
              to: rangeEnd,
              durationMinutes: i.duration_minutes,
              dayStart: i.day_start,
              dayEnd: i.day_end,
              includeWeekends: i.include_weekends,
            })
          : [];
      return ok(
        slots.length > 0
          ? {
              slots: slots.map((s) => ({
                start: s.start,
                end: s.end,
                when: `${shortDay(dateOf(s.start))} ${timeOf(s.start)}–${timeOf(s.end)}`,
              })),
            }
          : { slots: [], note: "No hay ningún hueco libre con esas condiciones." },
        `Buscados huecos de ${i.duration_minutes} min (${slots.length} ${slots.length === 1 ? "hueco" : "huecos"})`,
      );
    }
  }
}
