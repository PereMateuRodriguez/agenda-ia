import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar";
import { huella, mesDe, semanaDe, type Diario } from "@/lib/diario";
import {
  almacenSchema,
  avisoPendiente,
  desactualizado,
  diarioEnMarkdown,
  guardarInforme,
  nombreArchivo,
  nuevoGuardado,
  peticionInforme,
  reutilizablesPara,
  type InformeGuardado,
} from "@/lib/informes-guardados";
import { informeRequestSchema } from "@/lib/protocol";

const diario: Diario = {
  "2026-09-08": "Pruebas de carga.",
  "2026-09-15": "Revisión de seguridad.",
  "2026-09-22": "Reunión con el cliente.",
};

function semanal(desde: string, d: Diario = diario): InformeGuardado {
  const periodo = semanaDe(desde);
  return nuevoGuardado(
    periodo,
    { markdown: `# ${desde}`, narrativa: `## Resumen\n${desde}`, modelo: "guion" },
    huella(d, periodo),
    "2026-09-28T10:00",
  );
}

describe("avisoPendiente", () => {
  it("ofrece la semana pasada si tiene diario y no tiene informe", () => {
    expect(avisoPendiente("2026-09-28", diario, [])).toEqual(semanaDe("2026-09-21"));
  });

  it("calla si ya tiene informe, si no hay diario o si se ha descartado", () => {
    expect(avisoPendiente("2026-09-28", diario, [semanal("2026-09-21")])).toBeNull();
    expect(avisoPendiente("2026-10-05", diario, [])).toBeNull();
    expect(avisoPendiente("2026-09-28", diario, [], "2026-09-21")).toBeNull();
  });
});

describe("reutilizablesPara", () => {
  it("solo aprovecha semanas enteras del mes cuyo diario no ha cambiado", () => {
    const informes = [semanal("2026-09-07"), semanal("2026-09-14"), semanal("2026-09-28")];
    const cambiado: Diario = { ...diario, "2026-09-15": "Revisión de seguridad, y otra cosa." };
    // La del 28 no es entera dentro de septiembre; la del 14 ha cambiado.
    expect(reutilizablesPara(mesDe("2026-09-01"), cambiado, informes).map((r) => r.desde)).toEqual(["2026-09-07"]);
  });
});

describe("peticionInforme", () => {
  const eventos: CalendarEvent[] = [
    { id: "a", title: "Dentro", start: "2026-09-22T10:00", end: "2026-09-22T11:00" },
    { id: "b", title: "Futuro", start: "2026-09-25T10:00", end: "2026-09-25T11:00" },
    { id: "c", title: "Otra semana", start: "2026-09-15T10:00", end: "2026-09-15T11:00" },
  ];

  it("manda solo lo del periodo hasta hoy, y el servidor lo acepta", () => {
    const p = peticionInforme(semanaDe("2026-09-23"), diario, eventos, "2026-09-23", []);
    expect(p).toMatchObject({ tipo: "semana", desde: "2026-09-21", hoy: "2026-09-23", reutilizables: [] });
    expect(p.entradas).toEqual([{ fecha: "2026-09-22", texto: "Reunión con el cliente." }]);
    expect(p.eventos.map((e) => e.id)).toEqual(["a"]);
    expect(informeRequestSchema.safeParse(p).success).toBe(true);
  });

  it("el mensual lleva los semanales aprovechables", () => {
    const p = peticionInforme(mesDe("2026-09-01"), diario, eventos, "2026-10-02", [semanal("2026-09-07")]);
    expect(p.reutilizables.map((r) => r.desde)).toEqual(["2026-09-07"]);
    expect(p.entradas).toHaveLength(3);
  });
});

describe("informes guardados", () => {
  it("uno por periodo, el más reciente primero", () => {
    const viejo = semanal("2026-09-21");
    const otro = semanal("2026-09-14");
    const nuevo = { ...semanal("2026-09-21"), markdown: "# nuevo" };
    expect(guardarInforme([viejo, otro], nuevo)).toEqual([nuevo, otro]);
  });

  it("sabe cuándo el diario ha cambiado desde el informe", () => {
    const i = semanal("2026-09-21");
    expect(desactualizado(i, diario)).toBe(false);
    expect(desactualizado(i, { ...diario, "2026-09-24": "Algo más." })).toBe(true);
    // Cambiar otra semana no lo toca.
    expect(desactualizado(i, { ...diario, "2026-09-15": "Otra cosa." })).toBe(false);
  });

  it("valida lo guardado al cargar", () => {
    expect(almacenSchema.safeParse({ diario, informes: [semanal("2026-09-21")] }).success).toBe(true);
    expect(almacenSchema.safeParse({ diario: { "2026-13-01": "x" }, informes: [] }).success).toBe(false);
  });

  it("exporta el diario y nombra los ficheros", () => {
    expect(diarioEnMarkdown(diario)).toContain("## martes 8 de septiembre de 2026\n\nPruebas de carga.");
    expect(diarioEnMarkdown({})).toContain("Todavía no hay nada escrito");
    expect(nombreArchivo({ tipo: "semana", desde: "2026-09-21" })).toBe("informe-semana-2026-09-21.md");
    expect(nombreArchivo({ tipo: "mes", desde: "2026-09-01" })).toBe("informe-2026-09.md");
  });
});
