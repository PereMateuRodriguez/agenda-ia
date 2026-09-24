import { describe, expect, it } from "vitest";
import { Calendar, type CalendarEvent } from "@/lib/calendar";
import { executeTool, TOOL_SPECS } from "@/lib/tools";

const NOW = "2026-09-24T10:30"; // jueves

const base: CalendarEvent[] = [
  { id: "a", title: "Dentista", start: "2026-09-25T17:00", end: "2026-09-25T18:00" },
  { id: "b", title: "Reunión con Marta", start: "2026-09-28T10:00", end: "2026-09-28T11:30" },
  { id: "c", title: "Cumpleaños de mamá", start: "2026-09-29T00:00", end: "2026-09-30T00:00", allDay: true },
];

function setup(events = base) {
  let n = 0;
  const calendar = new Calendar(events, () => `ev_${++n}`);
  const run = (name: string, input: unknown) => {
    const out = executeTool(name, input, { calendar, now: NOW });
    return { ...out, data: JSON.parse(out.content) };
  };
  return { calendar, run };
}

describe("TOOL_SPECS", () => {
  it("publica un JSON Schema de objeto por herramienta", () => {
    expect(TOOL_SPECS.map((t) => t.name)).toEqual([
      "list_events",
      "search_events",
      "create_event",
      "update_event",
      "delete_event",
      "find_free_slots",
    ]);
    for (const t of TOOL_SPECS) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema).not.toHaveProperty("$schema");
      expect(t.description.length).toBeGreaterThan(10);
    }
    const create = TOOL_SPECS.find((t) => t.name === "create_event")!;
    expect(create.inputSchema.required).toEqual(["title", "start"]);
  });
});

describe("list_events", () => {
  it("un día incluye los de día completo y lleva el día ya escrito", () => {
    const { run } = setup();
    const out = run("list_events", { from_date: "2026-09-29" });
    expect(out.isError).toBe(false);
    expect(out.data.events).toEqual([
      {
        id: "c",
        title: "Cumpleaños de mamá",
        when: "mar 29/09, todo el día",
        start: "2026-09-29",
        end: "2026-09-29",
        all_day: true,
      },
    ]);
  });

  it("el rango incluye el último día", () => {
    const { run } = setup();
    const out = run("list_events", { from_date: "2026-09-25", to_date: "2026-09-28" });
    expect(out.data.events.map((e: { id: string }) => e.id)).toEqual(["a", "b"]);
    expect(out.summary).toBe("Consultada la agenda: vie 25/09 – lun 28/09 (2 eventos)");
  });

  it("admite fechas con hora y se queda con el día", () => {
    const { run } = setup();
    expect(run("list_events", { from_date: "2026-09-25T00:00:00" }).data.events).toHaveLength(1);
  });

  it("dice explícitamente que no hay nada", () => {
    const { run } = setup();
    expect(run("list_events", { from_date: "2026-09-26" }).data).toEqual({
      events: [],
      note: "No hay ningún evento en ese rango.",
    });
  });
});

describe("create_event", () => {
  it("crea y cuenta con qué se solapa", () => {
    const { run, calendar } = setup();
    const out = run("create_event", { title: "Café con Joan", start: "2026-09-25 17:30", duration_minutes: 45 });
    expect(out.isError).toBe(false);
    expect(out.changed).toBe(true);
    expect(out.data.created).toMatchObject({ id: "ev_1", start: "2026-09-25T17:30", end: "2026-09-25T18:15" });
    expect(out.data.overlaps_with.map((e: { id: string }) => e.id)).toEqual(["a"]);
    expect(out.summary).toBe("Creado «Café con Joan» · vie 25/09 17:30–18:15 (se solapa)");
    expect(calendar.all()).toHaveLength(4);
  });

  it("un evento de día completo acepta solo la fecha y el último día incluido", () => {
    const { run } = setup([]);
    const out = run("create_event", { title: "Viaje", start: "2026-10-03", end: "2026-10-05", all_day: true });
    expect(out.data.created).toMatchObject({ start: "2026-10-03", end: "2026-10-05", all_day: true });
    expect(out.summary).toBe("Creado «Viaje» · sáb 03/10 – lun 05/10, todo el día");
  });

  it("avisa si queda en el pasado, que suele ser un error de fecha", () => {
    const { run } = setup([]);
    const out = run("create_event", { title: "Dentista", start: "2025-09-25T17:00" });
    expect(out.data.warning).toMatch(/pasado/);
  });

  it("devuelve al modelo errores que puede corregir", () => {
    const { run, calendar } = setup([]);
    const missing = run("create_event", { start: "2026-09-25T17:00" });
    expect(missing.isError).toBe(true);
    expect(missing.data.error).toMatch(/title/);

    const badDate = run("create_event", { title: "X", start: "el viernes a las 5" });
    expect(badDate.isError).toBe(true);
    expect(badDate.data.error).toMatch(/no es una fecha válida/);

    expect(calendar.all()).toEqual([]);
  });

  it("ignora campos que no existen en vez de fallar", () => {
    const { run } = setup([]);
    const out = run("create_event", { title: "X", start: "2026-09-25T09:00", timezone: "Europe/Madrid" });
    expect(out.isError).toBe(false);
  });
});

describe("update_event y delete_event", () => {
  it("mover conserva la duración y el resumen enseña el antes y el después", () => {
    const { run } = setup();
    const out = run("update_event", { id: "b", start: "2026-09-29T16:00" });
    expect(out.data.updated).toMatchObject({ start: "2026-09-29T16:00", end: "2026-09-29T17:30" });
    expect(out.summary).toBe("Modificado «Reunión con Marta» · lun 28/09 10:00–11:30 → mar 29/09 16:00–17:30");
  });

  it("borrar un id que no existe no toca nada", () => {
    const { run, calendar } = setup();
    const out = run("delete_event", { id: "nope" });
    expect(out.isError).toBe(true);
    expect(out.changed).toBe(false);
    expect(calendar.all()).toHaveLength(3);
  });

  it("borra", () => {
    const { run, calendar } = setup();
    const out = run("delete_event", { id: "a" });
    expect(out.summary).toBe("Borrado «Dentista» · vie 25/09 17:00–18:00");
    expect(calendar.all().map((e) => e.id)).toEqual(["b", "c"]);
  });
});

describe("find_free_slots", () => {
  it("no propone horas que ya han pasado hoy", () => {
    const { run } = setup([]);
    const out = run("find_free_slots", { from_date: "2026-09-24", to_date: "2026-09-24", duration_minutes: 60 });
    expect(out.data.slots).toEqual([
      { start: "2026-09-24T10:30", end: "2026-09-24T20:00", when: "jue 24/09 10:30–20:00" },
    ]);
  });

  it("un rango entero en el pasado no tiene huecos", () => {
    const { run } = setup([]);
    const out = run("find_free_slots", { from_date: "2026-09-01", to_date: "2026-09-02", duration_minutes: 60 });
    expect(out.data.slots).toEqual([]);
  });

  it("usa la franja pedida", () => {
    const { run } = setup();
    const out = run("find_free_slots", {
      from_date: "2026-09-28",
      to_date: "2026-09-28",
      duration_minutes: 30,
      day_start: "08:00",
      day_end: "12:00",
    });
    expect(out.data.slots.map((s: { when: string }) => s.when)).toEqual([
      "lun 28/09 08:00–10:00",
      "lun 28/09 11:30–12:00",
    ]);
  });
});

it("una herramienta inventada es un error, no una excepción", () => {
  const { run } = setup();
  const out = run("send_email", { to: "x" });
  expect(out.isError).toBe(true);
  expect(out.data.error).toMatch(/no existe/);
});

it("acepta números y booleanos escritos como texto, que es lo que mandan los modelos pequeños", () => {
  const { run } = setup([]);
  const out = run("create_event", { title: "Comida", start: "2026-09-25T14:00", duration_minutes: "90" });
  expect(out.isError).toBe(false);
  expect(out.data.created.end).toBe("2026-09-25T15:30");
  const trip = run("create_event", { title: "Viaje", start: "2026-10-03", all_day: "true" });
  expect(trip.data.created.all_day).toBe(true);
});
