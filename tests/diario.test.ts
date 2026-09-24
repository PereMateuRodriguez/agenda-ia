import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar";
import {
  calcularCifras,
  cifrasEnTexto,
  diarioSchema,
  duracion,
  entradasDe,
  huella,
  MAX_ENTRADA,
  mesDe,
  semanaDe,
  tituloPeriodo,
  tramosDelMes,
  type Diario,
  type Periodo,
} from "@/lib/diario";
import { isLocalDate } from "@/lib/time";

const ev = (id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  start,
  end,
  ...extra,
});

// Semana del lunes 21 al domingo 27 de septiembre de 2026.
const SEMANA: Periodo = { tipo: "semana", desde: "2026-09-21", hasta: "2026-09-27" };

describe("periodos", () => {
  it("la semana va de lunes a domingo, esté el día donde esté", () => {
    expect(semanaDe("2026-09-24")).toEqual(SEMANA);
    expect(semanaDe("2026-09-27")).toEqual(SEMANA);
    expect(semanaDe("2026-12-31")).toEqual({ tipo: "semana", desde: "2026-12-28", hasta: "2027-01-03" });
  });

  it("el mes es el natural, con febrero y el cambio de año bien", () => {
    expect(mesDe("2026-09-24")).toEqual({ tipo: "mes", desde: "2026-09-01", hasta: "2026-09-30" });
    expect(mesDe("2026-02-10")).toEqual({ tipo: "mes", desde: "2026-02-01", hasta: "2026-02-28" });
    expect(mesDe("2028-02-10")).toEqual({ tipo: "mes", desde: "2028-02-01", hasta: "2028-02-29" });
    expect(mesDe("2026-12-31")).toEqual({ tipo: "mes", desde: "2026-12-01", hasta: "2026-12-31" });
  });

  it("parte el mes en semanas recortadas a sus bordes", () => {
    // El 1 de septiembre de 2026 es martes y el 30, miércoles.
    expect(tramosDelMes(mesDe("2026-09-15"))).toEqual([
      { desde: "2026-09-01", hasta: "2026-09-06", completa: false },
      { desde: "2026-09-07", hasta: "2026-09-13", completa: true },
      { desde: "2026-09-14", hasta: "2026-09-20", completa: true },
      { desde: "2026-09-21", hasta: "2026-09-27", completa: true },
      { desde: "2026-09-28", hasta: "2026-09-30", completa: false },
    ]);
  });

  it("un mes que empieza en lunes tiene su primera semana completa", () => {
    // El 1 de junio de 2026 es lunes.
    expect(tramosDelMes(mesDe("2026-06-10"))[0]).toEqual({ desde: "2026-06-01", hasta: "2026-06-07", completa: true });
  });

  it("titula con los meses y años que hagan falta", () => {
    expect(tituloPeriodo(SEMANA)).toBe("Semana del 21 al 27 de septiembre de 2026");
    expect(tituloPeriodo(semanaDe("2026-09-30"))).toBe("Semana del 28 de septiembre al 4 de octubre de 2026");
    expect(tituloPeriodo(semanaDe("2026-12-31"))).toBe("Semana del 28 de diciembre de 2026 al 3 de enero de 2027");
    expect(tituloPeriodo(mesDe("2026-09-24"))).toBe("Septiembre de 2026");
  });
});

describe("calcularCifras", () => {
  const diario: Diario = {
    "2026-09-21": "Cerré la migración.",
    "2026-09-22": "Revisión con el cliente.",
    "2026-09-24": "   ",
  };

  it("cuenta los días escritos y nombra los que faltan", () => {
    const c = calcularCifras(SEMANA, entradasDe(diario, SEMANA), [], "2026-09-27");
    expect(c.diasTranscurridos).toBe(7);
    expect(c.escritos).toEqual(["2026-09-21", "2026-09-22"]);
    // Un día con solo espacios no cuenta como escrito.
    expect(c.sinEscribir).toContain("2026-09-24");
    expect(c.sinEscribir).toHaveLength(5);
    expect(c.enCurso).toBe(false);
  });

  it("con la semana a medias, los días que no han llegado no cuentan para nada", () => {
    const eventos = [
      ev("pasado", "2026-09-22T10:00", "2026-09-22T11:00"),
      ev("futuro", "2026-09-25T10:00", "2026-09-25T12:00"),
    ];
    const c = calcularCifras(SEMANA, entradasDe(diario, SEMANA), eventos, "2026-09-23");
    expect(c.enCurso).toBe(true);
    expect(c.diasTranscurridos).toBe(3);
    expect(c.sinEscribir).toEqual(["2026-09-23"]);
    expect(c.eventos).toBe(1);
    expect(c.minutosEnEventos).toBe(60);
  });

  it("de un evento que cruza el borde solo cuenta la parte de dentro", () => {
    const guardia = ev("guardia", "2026-09-20T22:00", "2026-09-21T02:00");
    const c = calcularCifras(SEMANA, [], [guardia], "2026-09-27");
    expect(c.eventos).toBe(1);
    expect(c.minutosEnEventos).toBe(120);
    expect(c.diaMasCargado).toEqual({ fecha: "2026-09-21", minutos: 120 });
  });

  it("reparte por días y en empate se queda con el primero", () => {
    const eventos = [
      ev("a", "2026-09-22T09:00", "2026-09-22T12:00"),
      ev("b", "2026-09-24T15:00", "2026-09-24T18:00"),
      ev("c", "2026-09-23T10:00", "2026-09-23T11:30"),
    ];
    const c = calcularCifras(SEMANA, [], eventos, "2026-09-27");
    expect(c.minutosEnEventos).toBe(450);
    expect(c.diaMasCargado).toEqual({ fecha: "2026-09-22", minutos: 180 });
  });

  it("los de día completo van aparte y no suman horas", () => {
    const eventos = [ev("vacaciones", "2026-09-24T00:00", "2026-09-26T00:00", { allDay: true })];
    const c = calcularCifras(SEMANA, [], eventos, "2026-09-27");
    expect(c.eventos).toBe(0);
    expect(c.eventosDiaCompleto).toBe(1);
    expect(c.minutosEnEventos).toBe(0);
  });

  it("un periodo que aún no ha empezado no tiene nada que contar", () => {
    const c = calcularCifras(SEMANA, [], [ev("x", "2026-09-22T10:00", "2026-09-22T11:00")], "2026-09-10");
    expect(c.diasTranscurridos).toBe(0);
    expect(c.eventos).toBe(0);
  });
});

describe("cifrasEnTexto", () => {
  it("lo escribe en castellano, con singular y plural", () => {
    const diario: Diario = Object.fromEntries(
      ["21", "22", "23", "24", "25", "26"].map((d) => [`2026-09-${d}`, "algo"]),
    );
    const eventos = [ev("a", "2026-09-22T09:00", "2026-09-22T10:30")];
    const texto = cifrasEnTexto(SEMANA, calcularCifras(SEMANA, entradasDe(diario, SEMANA), eventos, "2026-09-27"));
    expect(texto).toBe(
      [
        "- Diario escrito 6 de 7 días. Falta el domingo 27.",
        "- 1 evento con hora en la agenda, 1 h 30 min en total.",
        "- El día más cargado fue el martes 22, con 1 h 30 min.",
      ].join("\n"),
    );
  });

  it("nombra hasta cuatro días y a partir de ahí da la cifra", () => {
    const dos = cifrasEnTexto(
      SEMANA,
      calcularCifras(
        SEMANA,
        entradasDe(
          { "2026-09-21": "x", "2026-09-22": "x", "2026-09-23": "x", "2026-09-24": "x", "2026-09-25": "x" },
          SEMANA,
        ),
        [],
        "2026-09-27",
      ),
    );
    expect(dos).toContain("Faltan el sábado 26 y el domingo 27.");
    const muchos = cifrasEnTexto(SEMANA, calcularCifras(SEMANA, [], [], "2026-09-27"));
    expect(muchos).toContain("Diario escrito 0 de 7 días. Faltan 7 días.");
    expect(muchos).toContain("Ningún evento con hora en la agenda.");
  });

  it("avisa cuando el periodo no ha terminado", () => {
    const texto = cifrasEnTexto(
      SEMANA,
      calcularCifras(SEMANA, [{ fecha: "2026-09-21", texto: "x" }], [], "2026-09-21"),
    );
    expect(texto.split("\n")[0]).toBe("- La semana todavía no ha terminado: esto cubre hasta hoy.");
    expect(texto).toContain("Diario escrito todos los días (1 de 1).");
  });
});

describe("huella", () => {
  const diario: Diario = { "2026-09-22": "Revisión con el cliente.", "2026-09-30": "Fuera de la semana." };

  it("cambia si cambia un día del periodo", () => {
    expect(huella({ ...diario, "2026-09-22": "Otra cosa." }, SEMANA)).not.toBe(huella(diario, SEMANA));
  });

  it("no cambia por días de fuera ni por espacios alrededor", () => {
    expect(huella({ ...diario, "2026-09-30": "Cambiado." }, SEMANA)).toBe(huella(diario, SEMANA));
    expect(huella({ ...diario, "2026-09-22": "  Revisión con el cliente.\n" }, SEMANA)).toBe(huella(diario, SEMANA));
  });
});

describe("validación", () => {
  it("el diario guardado solo admite fechas reales y textos con tope", () => {
    expect(diarioSchema.safeParse({ "2026-09-24": "hoy" }).success).toBe(true);
    expect(diarioSchema.safeParse({ "2026-09-31": "no existe" }).success).toBe(false);
    expect(diarioSchema.safeParse({ "2026-09-24": "x".repeat(MAX_ENTRADA + 1) }).success).toBe(false);
  });

  it("isLocalDate", () => {
    expect(isLocalDate("2026-09-24")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false);
    expect(isLocalDate("2026-09-24T10:00")).toBe(false);
  });

  it("duracion", () => {
    expect(duracion(45)).toBe("45 min");
    expect(duracion(180)).toBe("3 h");
    expect(duracion(570)).toBe("9 h 30 min");
  });
});
