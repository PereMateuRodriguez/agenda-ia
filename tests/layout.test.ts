import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar";
import { allDayOn, layoutDay } from "@/lib/layout";

const ev = (id: string, start: string, end: string, allDay = false): CalendarEvent => ({
  id,
  title: id,
  start,
  end,
  ...(allDay ? { allDay } : {}),
});

describe("layoutDay", () => {
  it("un evento solo ocupa todo el ancho", () => {
    const [p] = layoutDay([ev("a", "2026-09-25T17:00", "2026-09-25T18:30")], "2026-09-25");
    expect(p).toMatchObject({ top: 17 * 60, height: 90, column: 0, columns: 1 });
  });

  it("los solapados se reparten el ancho y los separados no", () => {
    const placed = layoutDay(
      [
        ev("a", "2026-09-25T09:00", "2026-09-25T10:00"),
        ev("b", "2026-09-25T09:30", "2026-09-25T11:00"),
        ev("c", "2026-09-25T10:00", "2026-09-25T10:30"),
        ev("d", "2026-09-25T12:00", "2026-09-25T13:00"),
      ],
      "2026-09-25",
    );
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(byId.a).toMatchObject({ column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ column: 1, columns: 2 });
    // c empieza cuando acaba a: reutiliza su columna.
    expect(byId.c).toMatchObject({ column: 0, columns: 2 });
    expect(byId.d).toMatchObject({ column: 0, columns: 1 });
  });

  it("recorta los que cruzan la medianoche", () => {
    const e = ev("n", "2026-09-25T22:00", "2026-09-26T02:00");
    expect(layoutDay([e], "2026-09-25")[0]).toMatchObject({ top: 22 * 60, height: 120, continuesAfter: true });
    expect(layoutDay([e], "2026-09-26")[0]).toMatchObject({ top: 0, height: 120, continuesBefore: true });
  });

  it("deja fuera los de día completo, que van en su propia fila", () => {
    const c = ev("c", "2026-09-29T00:00", "2026-10-01T00:00", true);
    expect(layoutDay([c], "2026-09-29")).toEqual([]);
    expect(allDayOn([c], "2026-09-30")).toEqual([c]);
    expect(allDayOn([c], "2026-10-01")).toEqual([]);
  });
});
