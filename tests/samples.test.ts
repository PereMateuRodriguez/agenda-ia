import { describe, expect, it } from "vitest";
import { Calendar } from "@/lib/calendar";
import { sampleEvents } from "@/lib/samples";

describe("sampleEvents", () => {
  it.each(["2026-09-21T09:00", "2026-09-24T18:00", "2026-09-25T18:00", "2026-09-27T12:00"])(
    "deja el dentista y la llamada en el futuro (%s)",
    (now) => {
      const events = sampleEvents(now);
      const dentista = events.find((e) => e.title === "Dentista")!;
      const llamada = events.find((e) => e.title === "Llamada con el cliente")!;
      expect(dentista.start > now).toBe(true);
      expect(llamada.start > now).toBe(true);
      // Los ejemplos pasan las mismas reglas que cualquier evento.
      expect(() => new Calendar(events).all()).not.toThrow();
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    },
  );
});
