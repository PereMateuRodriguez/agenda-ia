import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar";
import {
  generarInforme,
  INSTRUCCIONES_MES,
  INSTRUCCIONES_SEMANA,
  INSTRUCCIONES_TRAMO,
  limpiar,
  planificar,
  type Plan,
} from "@/lib/informe";
import { informeRequestSchema, type InformeRequest } from "@/lib/protocol";
import type { ModelTurn } from "@/lib/providers/types";
import { ScriptedProvider } from "./scripted-provider";

const texto = (t: string): ModelTurn => ({ text: t, stop: "end", toolCalls: [] });

function peticion(parcial: Partial<InformeRequest> & Pick<InformeRequest, "tipo" | "desde">): InformeRequest {
  return informeRequestSchema.parse({ hoy: "2026-09-28", entradas: [], eventos: [], ...parcial });
}

function plan(p: InformeRequest): Plan {
  const r = planificar(p);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
}

const reunion: CalendarEvent = {
  id: "ev_1",
  title: "Reunión con el cliente",
  start: "2026-09-22T10:00",
  end: "2026-09-22T11:00",
  location: "Oficina",
  notes: "Llevar el contrato firmado y la clave del wifi: hunter2",
};

const semana = peticion({
  tipo: "semana",
  desde: "2026-09-21",
  entradas: [
    { fecha: "2026-09-22", texto: "Reunión con el cliente; cerramos el alcance." },
    { fecha: "2026-09-21", texto: "Terminé la migración de la base de datos." },
  ],
  eventos: [reunion, { ...reunion, id: "ev_2", title: "Fuera", start: "2026-10-05T10:00", end: "2026-10-05T11:00" }],
});

describe("planificar", () => {
  it("rechaza periodos mal alineados, futuros o sin diario", () => {
    const err = (p: InformeRequest) => {
      const r = planificar(p);
      return r.ok ? null : r.error;
    };
    expect(err({ ...semana, desde: "2026-09-22" })).toMatch(/lunes/);
    expect(
      err(peticion({ tipo: "mes", desde: "2026-09-02", entradas: [{ fecha: "2026-09-02", texto: "x" }] })),
    ).toMatch(/día 1/);
    expect(err({ ...semana, hoy: "2026-09-10" })).toMatch(/no ha empezado/);
    expect(err({ ...semana, entradas: [] })).toMatch(/nada escrito/);
    expect(err({ ...semana, entradas: [{ fecha: "2026-09-30", texto: "x" }] })).toMatch(/no es de este periodo/);
    expect(err({ ...semana, entradas: [semana.entradas[0], semana.entradas[0]] })).toMatch(/repetido/);
  });

  it("con la semana a medias, un día que aún no ha llegado no es de este periodo", () => {
    const r = planificar({ ...semana, hoy: "2026-09-21" });
    expect(r.ok).toBe(false);
  });

  it("el semanal es una llamada y solo lleva los eventos del periodo, ordenados", () => {
    const p = plan(semana);
    expect(p.llamadas).toBe(1);
    expect(p.periodo).toEqual({ tipo: "semana", desde: "2026-09-21", hasta: "2026-09-27" });
    expect(p.entradas.map((e) => e.fecha)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(p.eventos.map((e) => e.id)).toEqual(["ev_1"]);
  });

  it("un semanal no admite informes reutilizables", () => {
    const r = planificar({ ...semana, reutilizables: [{ desde: "2026-09-21", hasta: "2026-09-27", narrativa: "x" }] });
    expect(r.ok).toBe(false);
  });
});

// Septiembre de 2026: tramos 1–6, 7–13, 14–20, 21–27 y 28–30.
const mes = peticion({
  tipo: "mes",
  desde: "2026-09-01",
  hoy: "2026-10-02",
  entradas: [
    { fecha: "2026-09-02", texto: "Arranqué la migración a Hetzner." },
    { fecha: "2026-09-08", texto: "Pruebas de carga." },
    { fecha: "2026-09-22", texto: "Reunión con el cliente; cerramos el alcance." },
    { fecha: "2026-09-29", texto: "Retomé el informe trimestral." },
  ],
  eventos: [reunion],
  reutilizables: [
    {
      desde: "2026-09-07",
      hasta: "2026-09-13",
      narrativa: "## Resumen\nSemana de pruebas de carga.\n\n## Logros\n- Pruebas de carga en verde.",
    },
  ],
});

describe("planificar el mensual", () => {
  it("resume cada semana con diario, aprovecha la que ya tiene informe y salta la vacía", () => {
    const p = plan(mes);
    expect(p.tramos.map((t) => [t.desde, t.accion])).toEqual([
      ["2026-09-01", "resumir"],
      ["2026-09-07", "reutilizar"],
      ["2026-09-14", "vacio"],
      ["2026-09-21", "resumir"],
      ["2026-09-28", "resumir"],
    ]);
    // Tres resúmenes y el informe final.
    expect(p.llamadas).toBe(4);
  });

  it("solo aprovecha informes de semanas enteras del mes", () => {
    const r = planificar({ ...mes, reutilizables: [{ desde: "2026-09-01", hasta: "2026-09-06", narrativa: "x" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/semana entera/);
  });

  it("a mitad de mes no menciona las semanas que no han empezado", () => {
    const p = plan({
      ...mes,
      hoy: "2026-09-16",
      reutilizables: [],
      entradas: mes.entradas.filter((e) => e.fecha <= "2026-09-16"),
    });
    expect(p.tramos.map((t) => t.desde)).toEqual(["2026-09-01", "2026-09-07", "2026-09-14"]);
    expect(p.cifras.enCurso).toBe(true);
  });
});

describe("generarInforme", () => {
  it("el semanal: una llamada sin herramientas, y las cifras las pone el código", async () => {
    const provider = new ScriptedProvider([
      texto(
        "## Resumen\nSemana de cierre.\n\n## Logros\n- Migración terminada.\n\n## Temas que se repiten\nNada que destacar.\n\n## Bloqueos y pendientes\nNada que destacar.",
      ),
    ]);
    const informe = await generarInforme({ provider, plan: plan(semana) });

    expect(provider.sessions).toHaveLength(1);
    const { options } = provider.sessions[0];
    expect(options.instructions).toBe(INSTRUCCIONES_SEMANA);
    expect(options.tools).toEqual([]);
    expect(options.context).toBe("Hoy es lunes 28 de septiembre.");

    const material = options.messages[0].content;
    expect(material).toContain("### lunes 21 de septiembre\nTerminé la migración de la base de datos.");
    expect(material).toContain("- martes 22, 10:00–11:00: Reunión con el cliente (Oficina)");
    // Ni las notas de los eventos ni las cifras llegan al modelo.
    expect(material).not.toContain("hunter2");
    expect(material).not.toMatch(/cifras|de 7 días/i);

    expect(informe.markdown.split("\n\n")[0]).toBe("# Informe de la semana del 21 al 27 de septiembre de 2026");
    expect(informe.markdown).toContain("## En cifras\n\n- Diario escrito 2 de 7 días. Faltan 5 días.");
    expect(informe.markdown).toContain("- 1 evento con hora en la agenda, 1 h en total.");
    expect(informe.markdown).toContain("## Logros\n- Migración terminada.");
    expect(informe.markdown).toMatch(/_Redactado por guion de pruebas el 28\/09\/2026/);
    expect(informe.narrativa.startsWith("## Resumen")).toBe(true);
    expect(informe.modelo).toBe("guion de pruebas");
  });

  it("el mensual: un resumen por semana, lo aprovechado sin gastar llamada, y el final a partir de todo", async () => {
    const provider = new ScriptedProvider([
      texto("- Arranque de la migración a Hetzner."),
      texto("- Alcance cerrado con el cliente."),
      texto("- Informe trimestral retomado."),
      texto(
        "## Resumen del mes\nUn mes de migración.\n\n## Logros\n- Migración.\n\n## Cómo ha ido evolucionando\nNada que destacar.\n\n## Pendientes para el mes que viene\n- Informe trimestral.",
      ),
    ]);
    const progreso: string[] = [];
    const informe = await generarInforme({ provider, plan: plan(mes), onProgreso: (t) => progreso.push(t) });

    expect(provider.sessions).toHaveLength(4);
    expect(provider.sessions.slice(0, 3).map((s) => s.options.instructions)).toEqual([
      INSTRUCCIONES_TRAMO,
      INSTRUCCIONES_TRAMO,
      INSTRUCCIONES_TRAMO,
    ]);
    expect(provider.sessions[0].options.messages[0].content).toContain("Arranqué la migración a Hetzner.");
    expect(provider.sessions[0].options.messages[0].content).not.toContain("Pruebas de carga.");

    const final = provider.sessions[3].options;
    expect(final.instructions).toBe(INSTRUCCIONES_MES);
    const material = final.messages[0].content;
    expect(material).toContain("### Del 1 al 6 de septiembre de 2026\n- Arranque de la migración a Hetzner.");
    // Lo aprovechado entra sin sus títulos, para no meter un documento dentro de otro.
    expect(material).toContain("### Del 7 al 13 de septiembre de 2026\nResumen:\nSemana de pruebas de carga.");
    expect(material).not.toContain("## Logros");
    expect(material).toContain("### Del 14 al 20 de septiembre de 2026\n(sin nada escrito)");

    expect(progreso).toEqual([
      "Resumiendo del 1 al 6 de septiembre de 2026…",
      "Aprovechando el informe ya escrito del 7 al 13 de septiembre de 2026.",
      "Resumiendo del 21 al 27 de septiembre de 2026…",
      "Resumiendo del 28 al 30 de septiembre de 2026…",
      "Redactando el informe del mes…",
    ]);
    expect(informe.markdown.split("\n\n")[0]).toBe("# Informe de septiembre de 2026");
    expect(informe.markdown).toContain("- Diario escrito 4 de 30 días. Faltan 26 días.");
  });

  it("un rechazo, un corte o una respuesta vacía no se hacen pasar por informe", async () => {
    const fallo = async (turno: ModelTurn) => {
      const provider = new ScriptedProvider([turno]);
      return generarInforme({ provider, plan: plan(semana) }).then(
        () => "sin error",
        (e: Error) => e.message,
      );
    };
    expect(await fallo({ text: "", stop: "refusal", toolCalls: [] })).toMatch(/no ha querido/);
    expect(await fallo({ text: "## Resu", stop: "max_tokens", toolCalls: [] })).toMatch(/cortado/);
    expect(await fallo(texto("   "))).toMatch(/vacío/);
  });
});

describe("limpiar", () => {
  it("quita el bloque de código y el título que a veces añade el modelo", () => {
    expect(limpiar("```markdown\n## Resumen\nHola.\n```")).toBe("## Resumen\nHola.");
    expect(limpiar("# Mi informe\n\n## Resumen\nHola.")).toBe("## Resumen\nHola.");
    expect(limpiar("## Resumen\nHola.")).toBe("## Resumen\nHola.");
  });
});
