import { describe, expect, it } from "vitest";
import { addDays, addMinutes, longDay, normalizeLocal, nowIn, shortDay, startOfWeek, weekdayIndex } from "@/lib/time";

describe("normalizeLocal", () => {
  it("acepta las variantes que suelen devolver los modelos", () => {
    expect(normalizeLocal("2026-09-25T17:00")).toBe("2026-09-25T17:00");
    expect(normalizeLocal("2026-09-25T17:00:00")).toBe("2026-09-25T17:00");
    expect(normalizeLocal("2026-09-25 9:30")).toBe("2026-09-25T09:30");
    expect(normalizeLocal("2026-09-25")).toBe("2026-09-25T00:00");
    expect(normalizeLocal(" 2026-09-25T17:00:00.000 ")).toBe("2026-09-25T17:00");
  });

  it("rechaza fechas que no existen", () => {
    expect(normalizeLocal("2026-09-31T10:00")).toBeNull();
    expect(normalizeLocal("2026-02-29")).toBeNull();
    expect(normalizeLocal("2028-02-29")).toBe("2028-02-29T00:00");
    expect(normalizeLocal("2026-09-25T24:00")).toBeNull();
    expect(normalizeLocal("25/09/2026")).toBeNull();
    expect(normalizeLocal("2026-09-25T17:00Z")).toBeNull();
  });
});

describe("aritmética de calendario", () => {
  it("cruza meses y años", () => {
    expect(addMinutes("2026-12-31T23:30", 45)).toBe("2027-01-01T00:15");
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("no se desplaza con el cambio de hora: es hora de pared", () => {
    // En España el 25/10/2026 se atrasa la hora; la agenda no debe notarlo.
    expect(addMinutes("2026-10-25T01:00", 120)).toBe("2026-10-25T03:00");
  });

  it("cuenta la semana de lunes a domingo", () => {
    expect(weekdayIndex("2026-09-28")).toBe(0); // lunes
    expect(weekdayIndex("2026-09-27")).toBe(6); // domingo
    expect(startOfWeek("2026-09-24")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
  });

  it("escribe los días en castellano", () => {
    expect(shortDay("2026-09-25")).toBe("vie 25/09");
    expect(longDay("2026-09-25")).toBe("viernes 25 de septiembre");
  });
});

describe("nowIn", () => {
  it("da la hora de pared de la zona pedida", () => {
    const at = new Date("2026-09-24T08:32:00Z");
    expect(nowIn("Europe/Madrid", at)).toBe("2026-09-24T10:32");
    expect(nowIn("America/Mexico_City", at)).toBe("2026-09-24T02:32");
  });
});
