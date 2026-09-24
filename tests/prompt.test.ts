import { describe, expect, it } from "vitest";
import { buildContext, INSTRUCTIONS } from "@/lib/prompt";

describe("buildContext", () => {
  const ctx = buildContext("2026-09-24T10:32", "Europe/Madrid");

  it("dice qué día y hora es", () => {
    expect(ctx).toContain("Ahora mismo es jueves 24 de septiembre de 2026, a las 10:32 (zona horaria Europe/Madrid).");
  });

  it("marca hoy, mañana y el próximo de cada día de la semana", () => {
    expect(ctx).toContain("- jueves 24/09/2026 → 2026-09-24  (HOY)");
    expect(ctx).toContain("- viernes 25/09/2026 → 2026-09-25  (mañana, «el viernes»)");
    expect(ctx).toContain("- sábado 26/09/2026 → 2026-09-26  (pasado mañana, «el sábado»)");
    expect(ctx).toContain("- lunes 28/09/2026 → 2026-09-28  («el lunes»)");
    // «el jueves» es el de la semana que viene, no hoy.
    expect(ctx).toContain("- jueves 01/10/2026 → 2026-10-01  («el jueves»)");
    expect(ctx).toContain("- jueves 08/10/2026 → 2026-10-08\n");
  });

  it("da los límites de las semanas", () => {
    expect(ctx).toContain("Esta semana va del lunes 2026-09-21 al domingo 2026-09-27.");
    expect(ctx).toContain("La semana que viene va del lunes 2026-09-28 al domingo 2026-10-04.");
  });

  it("cruza bien el fin de año", () => {
    const c = buildContext("2026-12-30T09:00", "Europe/Madrid");
    expect(c).toContain("- viernes 01/01/2027 → 2027-01-01  (pasado mañana, «el viernes»)");
  });
});

describe("INSTRUCTIONS", () => {
  it("no lleva nada que cambie entre peticiones, para poder cachearse", () => {
    expect(INSTRUCTIONS).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
