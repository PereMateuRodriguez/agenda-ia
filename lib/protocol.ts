import { z } from "zod";
import type { AgentStep } from "./agent";
import { eventSchema, MAX_EVENTS, type CalendarEvent } from "./calendar";
import { entradaSchema } from "./diario";
import { isLocalDate, isLocalDateTime, isValidTimeZone } from "./time";

/**
 * El contrato entre la interfaz y /api/chat.
 *
 * El servidor no guarda nada: la agenda viaja entera en cada petición y vuelve
 * modificada en la respuesta. Así no hay base de datos que mantener ni datos
 * de nadie en el servidor, y la demo pública no necesita cuentas. El precio es
 * que la agenda vive en el navegador; para usarla en serio entre dispositivos
 * habría que añadir persistencia (ver el README).
 */
/** Lo que se reenvía de la conversación. Más atrás no aporta y encarece cada vuelta. */
export const MAX_HISTORY = 12;

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "El mensaje está vacío.").max(1000, "El mensaje es demasiado largo."),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(MAX_HISTORY * 2),
  events: z
    .array(eventSchema)
    .max(MAX_EVENTS)
    .refine((events) => new Set(events.map((e) => e.id)).size === events.length, "Hay ids de evento repetidos."),
  now: z.string().refine(isLocalDateTime, "now debe ser AAAA-MM-DDTHH:mm."),
  timeZone: z.string().max(64).refine(isValidTimeZone, "Zona horaria desconocida."),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Una línea de la respuesta (NDJSON): los pasos llegan según ocurren. */
export type StreamEvent =
  | { type: "step"; step: AgentStep }
  | { type: "done"; reply: string; events: CalendarEvent[]; changed: boolean }
  | { type: "error"; message: string };

export interface ProviderStatus {
  provider: string;
  model: string;
  label: string;
}

/**
 * El contrato de /api/informe. Igual que el chat, el servidor no guarda nada:
 * viaja el diario del periodo, sus eventos y, para el mensual, los informes
 * semanales que ya se pueden aprovechar. El final del periodo no se manda: lo
 * calcula el servidor a partir del tipo y del primer día.
 */
export const informeRequestSchema = z.object({
  tipo: z.enum(["semana", "mes"]),
  /** El lunes de la semana o el día 1 del mes. */
  desde: z.string().refine(isLocalDate, "desde debe ser AAAA-MM-DD."),
  /** El día de hoy para quien lo pide: hasta ahí cubre un periodo en curso. */
  hoy: z.string().refine(isLocalDate, "hoy debe ser AAAA-MM-DD."),
  entradas: z.array(entradaSchema).max(31),
  eventos: z.array(eventSchema).max(MAX_EVENTS),
  reutilizables: z
    .array(
      z.object({
        desde: z.string().refine(isLocalDate, "desde debe ser AAAA-MM-DD."),
        hasta: z.string().refine(isLocalDate, "hasta debe ser AAAA-MM-DD."),
        narrativa: z.string().trim().min(1).max(8000),
      }),
    )
    .max(6)
    .default([]),
});

export type InformeRequest = z.infer<typeof informeRequestSchema>;

export interface InformeGenerado {
  /** El informe entero, listo para leer o exportar. */
  markdown: string;
  /** Solo lo que ha redactado el modelo, sin título ni cifras: es lo que el mensual reaprovecha. */
  narrativa: string;
  modelo: string;
}

/** Una línea de la respuesta (NDJSON). El mensual hace varias llamadas y va contando por dónde va. */
export type InformeStreamEvent =
  | { type: "progreso"; texto: string }
  | { type: "hecho"; informe: InformeGenerado }
  | { type: "error"; message: string };
