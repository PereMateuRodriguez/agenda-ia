"use client";

import type { AgentStep } from "./agent";
import type { CalendarEvent } from "./calendar";
import type { ChatRequest, StreamEvent } from "./protocol";

export interface ChatOutcome {
  reply: string;
  events: CalendarEvent[];
  changed: boolean;
}

/**
 * Llama a /api/chat y va entregando los pasos según llegan. La respuesta es
 * NDJSON: un objeto JSON por línea, así que basta con cortar por saltos de
 * línea sin esperar a que termine.
 */
export async function streamChat(
  request: ChatRequest,
  onStep: (step: AgentStep) => void,
  signal?: AbortSignal,
): Promise<ChatOutcome> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `El servidor ha respondido con un error (${res.status}).`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  // Con `as`, para que TypeScript no dé por hecho que sigue en null: se
  // asigna dentro de `handle`.
  let outcome = null as ChatOutcome | null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === "step") onStep(event.step);
    else if (event.type === "done") outcome = { reply: event.reply, events: event.events, changed: event.changed };
    else throw new Error(event.message);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);

  if (!outcome) throw new Error("La respuesta se ha cortado antes de terminar.");
  return outcome;
}
