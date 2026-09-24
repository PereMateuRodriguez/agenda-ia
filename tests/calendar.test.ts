import { describe, expect, it } from "vitest";
import { Calendar, CalendarError, type CalendarEvent } from "@/lib/calendar";

function ids() {
  let n = 0;
  return () => `ev_${++n}`;
}

const base: CalendarEvent[] = [
  { id: "a", title: "Dentista", start: "2026-09-25T17:00", end: "2026-09-25T18:00", location: "Palma" },
  { id: "b", title: "Reunión con Marta", start: "2026-09-28T10:00", end: "2026-09-28T11:30" },
  { id: "c", title: "Cumpleaños de mamá", start: "2026-09-29T00:00", end: "2026-09-30T00:00", allDay: true },
];

describe("Calendar.list", () => {
  it("devuelve los eventos que tocan el rango, ordenados", () => {
    const cal = new Calendar(base);
    expect(cal.list("2026-09-28T00:00", "2026-09-30T00:00").map((e) => e.id)).toEqual(["b", "c"]);
    expect(cal.list("2026-09-25T17:30", "2026-09-25T17:45").map((e) => e.id)).toEqual(["a"]);
    // Un evento que acaba justo cuando empieza el rango no cuenta.
    expect(cal.list("2026-09-25T18:00", "2026-09-26T00:00")).toEqual([]);
  });
});

describe("Calendar.create", () => {
  it("dura 60 minutos si no se dice otra cosa", () => {
    const cal = new Calendar([], ids());
    const { event } = cal.create({ title: "Llamar al banco", start: "2026-09-25T09:00" });
    expect(event).toEqual({ id: "ev_1", title: "Llamar al banco", start: "2026-09-25T09:00", end: "2026-09-25T10:00" });
  });

  it("avisa de los solapes sin impedir crear", () => {
    const cal = new Calendar(base, ids());
    const { overlaps } = cal.create({ title: "Café", start: "2026-09-25T17:30", durationMinutes: 30 });
    expect(overlaps.map((e) => e.id)).toEqual(["a"]);
    expect(cal.all()).toHaveLength(4);
  });

  it("los de día completo guardan el final exclusivo y no solapan", () => {
    const cal = new Calendar(base, ids());
    const { event, overlaps } = cal.create({
      title: "Viaje a Madrid",
      start: "2026-10-03T00:00",
      end: "2026-10-05T00:00",
      allDay: true,
    });
    expect(event.start).toBe("2026-10-03T00:00");
    expect(event.end).toBe("2026-10-06T00:00");
    expect(overlaps).toEqual([]);
  });

  it("rechaza lo que no tiene sentido con un mensaje para el modelo", () => {
    const cal = new Calendar();
    expect(() => cal.create({ title: "  ", start: "2026-09-25T09:00" })).toThrow(CalendarError);
    expect(() => cal.create({ title: "X", start: "2026-09-25T09:00", end: "2026-09-25T08:00" })).toThrow(
      /terminar después/,
    );
    expect(() => cal.create({ title: "X", start: "2026-09-25T09:00", durationMinutes: 60 * 24 * 8 })).toThrow(/7 días/);
  });
});

describe("Calendar.update", () => {
  it("al mover solo el inicio conserva la duración", () => {
    const cal = new Calendar(base);
    const { event } = cal.update("b", { start: "2026-09-29T16:00" });
    expect(event.start).toBe("2026-09-29T16:00");
    expect(event.end).toBe("2026-09-29T17:30");
  });

  it("cambia la duración sin mover el inicio", () => {
    const cal = new Calendar(base);
    const { event } = cal.update("a", { durationMinutes: 30 });
    expect(event).toMatchObject({ start: "2026-09-25T17:00", end: "2026-09-25T17:30", location: "Palma" });
  });

  it("mueve un evento de día completo conservando los días", () => {
    const cal = new Calendar([
      { id: "v", title: "Vacaciones", start: "2026-10-10T00:00", end: "2026-10-13T00:00", allDay: true },
    ]);
    const { event } = cal.update("v", { start: "2026-10-20T00:00" });
    expect(event).toMatchObject({ start: "2026-10-20T00:00", end: "2026-10-23T00:00", allDay: true });
  });

  it("puede borrar el lugar dejándolo vacío", () => {
    const cal = new Calendar(base);
    const { event } = cal.update("a", { location: "" });
    expect(event.location).toBeUndefined();
  });

  it("no inventa ids", () => {
    const cal = new Calendar(base);
    expect(() => cal.update("zzz", { title: "X" })).toThrow(/No existe/);
  });
});

describe("Calendar.search", () => {
  it("no distingue tildes ni mayúsculas y exige todas las palabras", () => {
    const cal = new Calendar(base);
    expect(cal.search("reunion").map((e) => e.id)).toEqual(["b"]);
    expect(cal.search("MARTA reunión").map((e) => e.id)).toEqual(["b"]);
    expect(cal.search("palma").map((e) => e.id)).toEqual(["a"]);
    expect(cal.search("reunión pepe")).toEqual([]);
  });
});

describe("Calendar.freeSlots", () => {
  it("encuentra los huecos entre eventos dentro de la franja", () => {
    const cal = new Calendar(base);
    const slots = cal.freeSlots({
      from: "2026-09-28T00:00",
      to: "2026-09-29T00:00",
      durationMinutes: 60,
    });
    expect(slots).toEqual([
      { start: "2026-09-28T09:00", end: "2026-09-28T10:00" },
      { start: "2026-09-28T11:30", end: "2026-09-28T20:00" },
    ]);
  });

  it("salta el fin de semana salvo que se pida", () => {
    const cal = new Calendar();
    const q = { from: "2026-09-26T00:00", to: "2026-09-28T00:00", durationMinutes: 60 };
    expect(cal.freeSlots(q)).toEqual([]);
    expect(cal.freeSlots({ ...q, includeWeekends: true })).toHaveLength(2);
  });

  it("los eventos de día completo no ocupan", () => {
    const cal = new Calendar(base);
    const slots = cal.freeSlots({ from: "2026-09-29T00:00", to: "2026-09-30T00:00", durationMinutes: 120 });
    expect(slots).toEqual([{ start: "2026-09-29T09:00", end: "2026-09-29T20:00" }]);
  });

  it("junta eventos solapados al calcular lo ocupado", () => {
    const cal = new Calendar([
      { id: "1", title: "A", start: "2026-09-28T09:00", end: "2026-09-28T11:00" },
      { id: "2", title: "B", start: "2026-09-28T10:00", end: "2026-09-28T10:30" },
      { id: "3", title: "C", start: "2026-09-28T12:00", end: "2026-09-28T19:30" },
    ]);
    const slots = cal.freeSlots({ from: "2026-09-28T00:00", to: "2026-09-29T00:00", durationMinutes: 30 });
    expect(slots).toEqual([
      { start: "2026-09-28T11:00", end: "2026-09-28T12:00" },
      { start: "2026-09-28T19:30", end: "2026-09-28T20:00" },
    ]);
  });

  it("respeta el inicio del rango aunque sea a mitad de día", () => {
    const cal = new Calendar();
    const slots = cal.freeSlots({ from: "2026-09-28T16:20", to: "2026-09-29T00:00", durationMinutes: 60 });
    expect(slots).toEqual([{ start: "2026-09-28T16:20", end: "2026-09-28T20:00" }]);
  });
});
