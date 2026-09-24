import { Calendar, type CalendarEvent } from "./calendar";
import { buildContext, INSTRUCTIONS } from "./prompt";
import { MAX_HISTORY } from "./protocol";
import type { ChatMessage, LlmProvider } from "./providers/types";
import type { LocalDateTime } from "./time";
import { executeTool, TOOL_SPECS } from "./tools";

export type AgentStep =
  | {
      type: "tool";
      id: string;
      name: string;
      input: unknown;
      ok: boolean;
      /** Qué ha hecho, en una línea legible. */
      summary: string;
    }
  /** Lo que el modelo dice mientras trabaja, antes de la respuesta final. */
  | { type: "note"; text: string };

export interface AgentInput {
  provider: LlmProvider;
  events: CalendarEvent[];
  history: ChatMessage[];
  message: string;
  now: LocalDateTime;
  timeZone: string;
  signal?: AbortSignal;
  /** Vueltas máximas del bucle: cada una es una llamada al modelo. */
  maxTurns?: number;
  onStep?: (step: AgentStep) => void;
  newId?: () => string;
}

export interface AgentResult {
  reply: string;
  events: CalendarEvent[];
  changed: boolean;
  steps: AgentStep[];
}

/**
 * El bucle del agente: se llama al modelo, se ejecutan las herramientas que
 * pida sobre el calendario de esta petición y se le devuelven los resultados,
 * hasta que conteste sin pedir nada más.
 *
 * El modelo no toca nada fuera de ese calendario en memoria: no hay red, ni
 * disco, ni otros usuarios a su alcance. Lo peor que puede hacer una
 * instrucción colada en el título de un evento es desordenar la agenda de
 * quien la ha escrito, y eso se deshace desde la interfaz.
 */
export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const calendar = new Calendar(input.events, input.newId);
  const steps: AgentStep[] = [];
  let changed = false;

  const emit = (step: AgentStep) => {
    steps.push(step);
    input.onStep?.(step);
  };
  const finish = (reply: string): AgentResult => ({
    reply,
    events: calendar.all(),
    changed,
    steps,
  });

  const session = input.provider.startSession({
    instructions: INSTRUCTIONS,
    context: buildContext(input.now, input.timeZone),
    messages: [...trimHistory(input.history), { role: "user", content: input.message }],
    tools: TOOL_SPECS,
    signal: input.signal,
  });

  const maxTurns = input.maxTurns ?? 8;
  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await session.next();

    if (result.stop === "refusal") {
      return finish("No puedo ayudarte con eso. Si es algo de la agenda, prueba a pedirlo de otra forma.");
    }
    if (result.stop === "max_tokens") {
      return finish("La respuesta se ha cortado antes de terminar. Prueba con una petición más corta.");
    }
    if (result.toolCalls.length === 0) {
      return finish(result.text || "Hecho.");
    }

    if (result.text) emit({ type: "note", text: result.text });

    const results = result.toolCalls.map((call) => {
      const outcome = executeTool(call.name, call.input, { calendar, now: input.now });
      changed ||= outcome.changed;
      emit({
        type: "tool",
        id: call.id,
        name: call.name,
        input: call.input,
        ok: !outcome.isError,
        summary: outcome.summary,
      });
      return { id: call.id, name: call.name, content: outcome.content, isError: outcome.isError };
    });
    session.addToolResults(results);
  }

  return finish(
    "He dado demasiadas vueltas sin llegar a una respuesta. Revisa la agenda por si he dejado algo a medias y prueba a pedirlo en pasos más pequeños.",
  );
}

/**
 * Los últimos mensajes, empezando por uno del usuario: las APIs de chat
 * esperan que la conversación arranque por ahí.
 */
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const recent = history.slice(-MAX_HISTORY);
  const firstUser = recent.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}
