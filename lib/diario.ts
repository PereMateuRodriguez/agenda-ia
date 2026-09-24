import { z } from "zod";
import type { CalendarEvent } from "./calendar";
import {
  addDays,
  DIAS,
  isLocalDate,
  MESES,
  startOfDay,
  startOfWeek,
  toMinutes,
  weekdayIndex,
  type LocalDate,
} from "./time";

/**
 * El diario: un texto por día contando qué has hecho, y lo que se calcula a
 * partir de él para los informes.
 *
 * Aquí no hay ningún modelo. Todo lo que sea contar —horas en reuniones, días
 * escritos, qué días faltan— se hace en código y sale exacto. Es la misma
 * regla que las fechas de la agenda: al modelo se le da la cifra hecha y solo
 * redacta. Un modelo de 7B sumando duraciones se equivoca, y un informe con
 * horas inventadas es peor que no tener informe.
 */

/**
 * Tope de cada día. No es por espacio: es lo que deja que una semana entera
 * de diario, con sus eventos y las instrucciones, quepa en los 8.192 tokens
 * de contexto que se le piden a Ollama. Si no cabe, Ollama no avisa: recorta
 * por el principio y lo primero que pierde son las instrucciones. Dos mil
 * caracteres son unas trescientas palabras, de sobra para contar un día.
 */
export const MAX_ENTRADA = 2000;

/** Lo que se guarda en el navegador: el texto de cada día, por fecha. */
export type Diario = Record<LocalDate, string>;

export const diarioSchema = z
  .record(z.string().refine(isLocalDate, "Fecha del diario inválida."), z.string().max(MAX_ENTRADA))
  .refine((d) => Object.keys(d).length <= 3700, "El diario tiene demasiados días.");

export const entradaSchema = z.object({
  fecha: z.string().refine(isLocalDate, "fecha debe ser AAAA-MM-DD."),
  texto: z.string().trim().min(1).max(MAX_ENTRADA),
});

export type Entrada = z.infer<typeof entradaSchema>;

export type TipoPeriodo = "semana" | "mes";

export interface Periodo {
  tipo: TipoPeriodo;
  /** Primer día, incluido. */
  desde: LocalDate;
  /** Último día, incluido. */
  hasta: LocalDate;
}

/** La semana, de lunes a domingo, que contiene ese día. */
export function semanaDe(fecha: LocalDate): Periodo {
  const desde = startOfWeek(fecha);
  return { tipo: "semana", desde, hasta: addDays(desde, 6) };
}

/** El mes natural que contiene ese día, del 1 al último. */
export function mesDe(fecha: LocalDate): Periodo {
  const desde = `${fecha.slice(0, 8)}01`;
  const siguiente = addDays(desde, 32).slice(0, 8) + "01";
  return { tipo: "mes", desde, hasta: addDays(siguiente, -1) };
}

export function diasDe(periodo: { desde: LocalDate; hasta: LocalDate }): LocalDate[] {
  const dias: LocalDate[] = [];
  for (let d = periodo.desde; d <= periodo.hasta; d = addDays(d, 1)) dias.push(d);
  return dias;
}

export interface Tramo {
  desde: LocalDate;
  hasta: LocalDate;
  /** Si es una semana entera, de lunes a domingo, dentro del mes. */
  completa: boolean;
}

/**
 * El mes, partido por semanas y recortado a sus bordes.
 *
 * El informe mensual no se escribe de una vez sobre los treinta días: con un
 * modelo local no cabrían. Se resume cada tramo por separado y el mensual se
 * redacta a partir de esos resúmenes. Los tramos siguen las semanas de la
 * agenda para que, cuando una semana cae entera dentro del mes y ya tiene su
 * informe, se pueda aprovechar en vez de resumirla otra vez.
 */
export function tramosDelMes(mes: Periodo): Tramo[] {
  const tramos: Tramo[] = [];
  let desde = mes.desde;
  while (desde <= mes.hasta) {
    const finDeSemana = addDays(startOfWeek(desde), 6);
    const hasta = finDeSemana < mes.hasta ? finDeSemana : mes.hasta;
    tramos.push({ desde, hasta, completa: weekdayIndex(desde) === 0 && hasta === finDeSemana });
    desde = addDays(hasta, 1);
  }
  return tramos;
}

/** Las entradas con texto de un tramo, en orden. */
export function entradasDe(diario: Diario, tramo: { desde: LocalDate; hasta: LocalDate }): Entrada[] {
  return diasDe(tramo)
    .filter((fecha) => (diario[fecha] ?? "").trim() !== "")
    .map((fecha) => ({ fecha, texto: diario[fecha].trim() }));
}

export interface Cifras {
  /** Días del periodo que ya han pasado o son hoy. */
  diasTranscurridos: number;
  escritos: LocalDate[];
  /** Días ya transcurridos sin nada escrito. */
  sinEscribir: LocalDate[];
  /** Eventos con hora que tocan el periodo. */
  eventos: number;
  /** Minutos de esos eventos, contando solo la parte que cae dentro. */
  minutosEnEventos: number;
  diaMasCargado: { fecha: LocalDate; minutos: number } | null;
  eventosDiaCompleto: number;
  /** El periodo no ha terminado: el informe cubre hasta hoy. */
  enCurso: boolean;
}

/**
 * Las cuentas del periodo, hasta `hoy` incluido. Si el periodo no ha
 * terminado, los días que aún no han llegado no cuentan para nada: ni como
 * días sin escribir ni por sus eventos, porque el informe dice que cubre
 * hasta hoy y tiene que ser verdad.
 *
 * Los eventos que cruzan la medianoche o el borde del periodo cuentan solo
 * por la parte que cae dentro: una guardia del domingo a las 22:00 al lunes a
 * las 2:00 no le suma cuatro horas a la semana que empieza el lunes.
 */
export function calcularCifras(
  periodo: { desde: LocalDate; hasta: LocalDate },
  entradas: Entrada[],
  eventos: CalendarEvent[],
  hoy: LocalDate,
): Cifras {
  const enCurso = periodo.hasta > hoy;
  const dias = diasDe({ desde: periodo.desde, hasta: enCurso ? hoy : periodo.hasta });
  const conTexto = new Set(entradas.filter((e) => e.texto.trim() !== "").map((e) => e.fecha));

  const porDia = new Map<LocalDate, number>();
  let conHora = 0;
  let diaCompleto = 0;
  let total = 0;

  if (dias.length > 0) {
    const inicio = toMinutes(startOfDay(dias[0]));
    const fin = toMinutes(startOfDay(addDays(dias[dias.length - 1], 1)));

    for (const e of eventos) {
      const a = toMinutes(e.start);
      const b = toMinutes(e.end);
      if (b <= inicio || a >= fin) continue;
      if (e.allDay) {
        diaCompleto++;
        continue;
      }
      conHora++;
      for (const dia of dias) {
        const d0 = toMinutes(startOfDay(dia));
        const dentro = Math.min(b, d0 + 24 * 60) - Math.max(a, d0);
        if (dentro > 0) {
          porDia.set(dia, (porDia.get(dia) ?? 0) + dentro);
          total += dentro;
        }
      }
    }
  }

  // En empate gana el primero: es el que se lee antes en el informe.
  let diaMasCargado: Cifras["diaMasCargado"] = null;
  for (const dia of dias) {
    const minutos = porDia.get(dia) ?? 0;
    if (minutos > 0 && (!diaMasCargado || minutos > diaMasCargado.minutos)) {
      diaMasCargado = { fecha: dia, minutos };
    }
  }

  return {
    diasTranscurridos: dias.length,
    escritos: dias.filter((d) => conTexto.has(d)),
    sinEscribir: dias.filter((d) => !conTexto.has(d)),
    eventos: conHora,
    minutosEnEventos: total,
    diaMasCargado,
    eventosDiaCompleto: diaCompleto,
    enCurso,
  };
}

/** "9 h 30 min", "3 h", "45 min". */
export function duracion(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "el sábado 26" */
function elDia(fecha: LocalDate): string {
  return `el ${DIAS[weekdayIndex(fecha)]} ${Number(fecha.slice(8, 10))}`;
}

/** "a", "a y b", "a, b y c" */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join("");
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "del 21 al 27 de septiembre de 2026", con los meses y años que hagan falta. */
function rango(desde: LocalDate, hasta: LocalDate): string {
  const [a1, m1, d1] = [desde.slice(0, 4), Number(desde.slice(5, 7)), Number(desde.slice(8, 10))];
  const [a2, m2, d2] = [hasta.slice(0, 4), Number(hasta.slice(5, 7)), Number(hasta.slice(8, 10))];
  if (a1 !== a2) return `del ${d1} de ${MESES[m1 - 1]} de ${a1} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  if (m1 !== m2) return `del ${d1} de ${MESES[m1 - 1]} al ${d2} de ${MESES[m2 - 1]} de ${a2}`;
  return `del ${d1} al ${d2} de ${MESES[m1 - 1]} de ${a1}`;
}

/** "Semana del 21 al 27 de septiembre de 2026" o "Septiembre de 2026". */
export function tituloPeriodo(periodo: Periodo): string {
  if (periodo.tipo === "mes") {
    const mes = MESES[Number(periodo.desde.slice(5, 7)) - 1];
    return `${mes[0].toUpperCase()}${mes.slice(1)} de ${periodo.desde.slice(0, 4)}`;
  }
  return `Semana ${rango(periodo.desde, periodo.hasta)}`;
}

/** "Informe de la semana del 21 al 27 de septiembre de 2026" o "Informe de septiembre de 2026". */
export function tituloInforme(periodo: Periodo): string {
  if (periodo.tipo === "mes") return `Informe de ${tituloPeriodo(periodo).toLowerCase()}`;
  return `Informe de la semana ${rango(periodo.desde, periodo.hasta)}`;
}

/** Un tramo, para rotular los resúmenes parciales: "del 1 al 6 de septiembre de 2026". */
export function rotuloTramo(tramo: { desde: LocalDate; hasta: LocalDate }): string {
  return rango(tramo.desde, tramo.hasta);
}

/**
 * El apartado de cifras del informe, escrito por el código. Va delante de lo
 * que redacta el modelo y el modelo no lo repite: así ningún número del
 * informe sale de él.
 */
export function cifrasEnTexto(periodo: Periodo, c: Cifras): string {
  const lineas: string[] = [];
  const unidad = periodo.tipo === "semana" ? "la semana" : "el mes";

  if (c.enCurso) {
    lineas.push(`${unidad[0].toUpperCase()}${unidad.slice(1)} todavía no ha terminado: esto cubre hasta hoy.`);
  }

  if (c.diasTranscurridos > 0) {
    if (c.sinEscribir.length === 0) {
      lineas.push(`Diario escrito todos los días (${c.diasTranscurridos} de ${c.diasTranscurridos}).`);
    } else {
      // Con pocos días se nombran, que es lo útil; con muchos, basta la cifra.
      const n = c.sinEscribir.length;
      const faltan =
        n > 4 ? `Faltan ${n} días.` : `${n === 1 ? "Falta" : "Faltan"} ${enumerar(c.sinEscribir.map(elDia))}.`;
      lineas.push(`Diario escrito ${c.escritos.length} de ${c.diasTranscurridos} días. ${faltan}`);
    }
  }

  if (c.eventos === 0) {
    lineas.push("Ningún evento con hora en la agenda.");
  } else {
    lineas.push(
      `${plural(c.eventos, "evento", "eventos")} con hora en la agenda, ${duracion(c.minutosEnEventos)} en total.`,
    );
    if (c.diaMasCargado) {
      lineas.push(`El día más cargado fue ${elDia(c.diaMasCargado.fecha)}, con ${duracion(c.diaMasCargado.minutos)}.`);
    }
  }
  if (c.eventosDiaCompleto > 0) {
    lineas.push(`${plural(c.eventosDiaCompleto, "evento", "eventos")} de día completo.`);
  }

  return lineas.map((l) => `- ${l}`).join("\n");
}

/**
 * Huella del texto de un periodo. Se guarda con cada informe para saber si
 * el diario ha cambiado desde que se escribió: si no ha cambiado, el informe
 * semanal se puede reutilizar para el mensual; si ha cambiado, se avisa de
 * que está desactualizado. FNV-1a de 32 bits: no es para seguridad, solo para
 * notar un cambio.
 */
export function huella(diario: Diario, periodo: { desde: LocalDate; hasta: LocalDate }): string {
  const texto = diasDe(periodo)
    .map((d) => `${d}\n${(diario[d] ?? "").trim()}`)
    .join("\u0000");
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
