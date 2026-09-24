import { describe, expect, it } from "vitest";
import { toICS } from "@/lib/ics";

const stamp = new Date("2026-09-24T08:00:00Z");

describe("toICS", () => {
  it("genera un VCALENDAR válido con finales de línea CRLF", () => {
    const ics = toICS(
      [
        { id: "a", title: "Dentista", start: "2026-09-25T17:00", end: "2026-09-25T18:00", location: "Palma" },
        { id: "c", title: "Cumpleaños", start: "2026-09-29T00:00", end: "2026-09-30T00:00", allDay: true },
      ],
      stamp,
    );
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:a@agenda-ia");
    expect(lines).toContain("DTSTAMP:20260924T080000Z");
    expect(lines).toContain("DTSTART:20260925T170000");
    expect(lines).toContain("DTEND:20260925T180000");
    expect(lines).toContain("LOCATION:Palma");
    expect(lines).toContain("DTSTART;VALUE=DATE:20260929");
    expect(lines).toContain("DTEND;VALUE=DATE:20260930");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("escapa comas, puntos y coma y saltos de línea", () => {
    const ics = toICS(
      [
        {
          id: "x",
          title: "Comida; Joan, Marta",
          start: "2026-09-25T14:00",
          end: "2026-09-25T15:30",
          notes: "línea 1\nlínea 2",
        },
      ],
      stamp,
    );
    expect(ics).toContain("SUMMARY:Comida\; Joan\\, Marta");
    expect(ics).toContain("DESCRIPTION:línea 1\\nlínea 2");
  });

  it("parte las líneas largas por bytes sin romper caracteres", () => {
    const title = "Reunión de planificación trimestral con el equipo de producto y diseño en la oficina";
    const ics = toICS([{ id: "x", title, start: "2026-09-25T09:00", end: "2026-09-25T10:00" }], stamp);
    const encoder = new TextEncoder();
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Al desplegar (quitar CRLF + espacio) sale el título original.
    expect(ics.replaceAll("\r\n ", "")).toContain(`SUMMARY:${title}`);
  });
});
