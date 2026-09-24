import { z } from "zod";
import type { CalendarEvent } from "./calendar";
import {
  diarioSchema,
  entradasDe,
  huella,
  semanaDe,
  tramosDelMes,
  type Diario,
  type Periodo,
  type TipoPeriodo,
} from "./diario";
import type { InformeGenerado, InformeRequest } from "./protocol";
import { addDays, isLocalDate, isLocalDateTime, longDay, startOfDay, toMinutes, type LocalDate } from "./time";

/**
 * Lo que el navegador guarda del diario y cómo arma cada petición de informe.
 * Todo son funciones puras: se prueban sin navegador y sin modelo.
 */

export const informeGuardadoSchema = z.object({
  tipo: z.enum(["semana", "mes"]),
  desde: z.string().refine(isLocalDate),
  hasta: z.string().refine(isLocalDate),
  markdown: z.string().max(40_000),
  narrativa: z.string().max(20_000),
  modelo: z.string().max(200),
  creado: z.string().refine(isLocalDateTime),
  /** Huella del diario del periodo cuando se escribió: si cambia, está desactualizado. */
  huella: z.string().max(16),
});

export type InformeGuardado = z.infer<typeof informeGuardadoSchema>;

export const almacenSchema = z.object({
  diario: diarioSchema,
  informes: z.array(informeGuardadoSchema).max(500),
  /** El lunes de la semana cuyo aviso se ha descartado. */
  avisoDescartado: z.string().refine(isLocalDate).optional(),
});

export type Almacen = z.infer<typeof almacenSchema>;

export const ALMACEN_VACIO: Almacen = { diario: {}, informes: [] };

export function claveInforme(i: { tipo: TipoPeriodo; desde: LocalDate }): string {
  return `${i.tipo}:${i.desde}`;
}

export function buscarInforme(informes: InformeGuardado[], periodo: Periodo): InformeGuardado | undefined {
  return informes.find((i) => claveInforme(i) === claveInforme(periodo));
}

/** El diario ha cambiado desde que se escribió el informe. */
export function desactualizado(informe: InformeGuardado, diario: Diario): boolean {
  return huella(diario, informe) !== informe.huella;
}

/** Guarda el informe nuevo en su sitio: uno por periodo, el más reciente primero. */
export function guardarInforme(informes: InformeGuardado[], nuevo: InformeGuardado): InformeGuardado[] {
  return [nuevo, ...informes.filter((i) => claveInforme(i) !== claveInforme(nuevo))];
}

export function hayDiario(diario: Diario, periodo: { desde: LocalDate; hasta: LocalDate }): boolean {
  return entradasDe(diario, periodo).length > 0;
}

/**
 * El aviso de la semana pasada: si tiene diario pero no tiene informe, y no
 * se ha descartado. No genera nada solo: con Claude costaría dinero, y con
 * Ollama ocuparía la GPU sin que nadie lo haya pedido.
 */
export function avisoPendiente(
  hoy: LocalDate,
  diario: Diario,
  informes: InformeGuardado[],
  descartado?: LocalDate,
): Periodo | null {
  const pasada = semanaDe(addDays(semanaDe(hoy).desde, -1));
  if (descartado === pasada.desde) return null;
  if (!hayDiario(diario, pasada) || buscarInforme(informes, pasada)) return null;
  return pasada;
}

/**
 * Los semanales que el mensual puede aprovechar: semanas enteras dentro del
 * mes cuyo diario no ha cambiado desde que se escribió su informe.
 */
export function reutilizablesPara(mes: Periodo, diario: Diario, informes: InformeGuardado[]) {
  return tramosDelMes(mes)
    .filter((t) => t.completa)
    .map((t) => buscarInforme(informes, { tipo: "semana", desde: t.desde, hasta: t.hasta }))
    .filter((i): i is InformeGuardado => i !== undefined && !desactualizado(i, diario))
    .map((i) => ({ desde: i.desde, hasta: i.hasta, narrativa: i.narrativa }));
}

function tocaElPeriodo(e: CalendarEvent, desde: LocalDate, hasta: LocalDate): boolean {
  return (
    toMinutes(e.end) > toMinutes(startOfDay(desde)) && toMinutes(e.start) < toMinutes(startOfDay(addDays(hasta, 1)))
  );
}

/** Solo viaja lo del periodo, y hasta hoy: el servidor no necesita ver nada más. */
export function peticionInforme(
  periodo: Periodo,
  diario: Diario,
  eventos: CalendarEvent[],
  hoy: LocalDate,
  informes: InformeGuardado[],
): InformeRequest {
  const hasta = periodo.hasta < hoy ? periodo.hasta : hoy;
  return {
    tipo: periodo.tipo,
    desde: periodo.desde,
    hoy,
    entradas: entradasDe(diario, { desde: periodo.desde, hasta }),
    eventos: eventos.filter((e) => tocaElPeriodo(e, periodo.desde, hasta)),
    reutilizables: periodo.tipo === "mes" ? reutilizablesPara(periodo, diario, informes) : [],
  };
}

export function nuevoGuardado(
  periodo: Periodo,
  informe: InformeGenerado,
  huellaEnviada: string,
  creado: string,
): InformeGuardado {
  return { tipo: periodo.tipo, desde: periodo.desde, hasta: periodo.hasta, ...informe, creado, huella: huellaEnviada };
}

/** El diario entero en Markdown, para llevárselo: es lo único que no está en ningún otro sitio. */
export function diarioEnMarkdown(diario: Diario): string {
  const dias = Object.keys(diario)
    .filter((d) => diario[d].trim() !== "")
    .sort();
  const cuerpo = dias.map((d) => `## ${longDay(d)} de ${d.slice(0, 4)}\n\n${diario[d].trim()}`).join("\n\n");
  return `# Diario\n\n${cuerpo || "_Todavía no hay nada escrito._"}\n`;
}

export function nombreArchivo(i: { tipo: TipoPeriodo; desde: LocalDate }): string {
  return i.tipo === "semana" ? `informe-semana-${i.desde}.md` : `informe-${i.desde.slice(0, 7)}.md`;
}
