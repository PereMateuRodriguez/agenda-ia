"use client";

import type { AgentStep } from "./agent";
import type { CalendarEvent } from "./calendar";
import type { ChatRequest, InformeGenerado, InformeRequest, InformeStreamEvent, StreamEvent } from "./protocol";

export interface ChatOutcome {
  reply: string;
  events: CalendarEvent[];
  changed: boolean;
}

/**
 * Hace la petición y va entregando cada línea de la respuesta según llega.
 * Es NDJSON: un objeto JSON por línea, así que basta con cortar por saltos de
 * línea sin esperar a que termine.
 */
async function postNdjson<T>(url: string, body: unknown, handle: (event: T) => void, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `El servidor ha respondido con un error (${res.status}).`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const line = (text: string) => {
    if (text.trim()) handle(JSON.parse(text) as T);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(line);
  }
  line(buffer);
}

/** Llama a /api/chat y va entregando los pasos según llegan. */
export async function streamChat(
  request: ChatRequest,
  onStep: (step: AgentStep) => void,
  signal?: AbortSignal,
): Promise<ChatOutcome> {
  // Con `as`, para que TypeScript no dé por hecho que sigue en null: se
  // asigna dentro del manejador.
  let outcome = null as ChatOutcome | null;
  await postNdjson<StreamEvent>(
    "/api/chat",
    request,
    (event) => {
      if (event.type === "step") onStep(event.step);
      else if (event.type === "done") outcome = { reply: event.reply, events: event.events, changed: event.changed };
      else throw new Error(event.message);
    },
    signal,
  );
  if (!outcome) throw new Error("La respuesta se ha cortado antes de terminar.");
  return outcome;
}

/** Llama a /api/informe y va contando por dónde va: el mensual tarda varias llamadas. */
export async function streamInforme(
  request: InformeRequest,
  onProgreso: (texto: string) => void,
  signal?: AbortSignal,
): Promise<InformeGenerado> {
  let informe = null as InformeGenerado | null;
  await postNdjson<InformeStreamEvent>(
    "/api/informe",
    request,
    (event) => {
      if (event.type === "progreso") onProgreso(event.texto);
      else if (event.type === "hecho") informe = event.informe;
      else throw new Error(event.message);
    },
    signal,
  );
  if (!informe) throw new Error("La respuesta se ha cortado antes de terminar.");
  return informe;
}
