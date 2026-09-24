import type { AgentSession, LlmProvider, ModelTurn, SessionOptions, ToolResult } from "@/lib/providers/types";

/**
 * Un "modelo" con las respuestas escritas de antemano, para probar el bucle
 * del agente sin red ni LLM. Guarda lo que recibe para poder comprobarlo.
 */
export class ScriptedProvider implements LlmProvider {
  readonly id = "scripted";
  readonly model = "guion";
  readonly label = "guion de pruebas";
  sessions: { options: SessionOptions; results: ToolResult[][] }[] = [];

  constructor(private readonly turns: ModelTurn[]) {}

  startSession(options: SessionOptions): AgentSession {
    const record = { options, results: [] as ToolResult[][] };
    this.sessions.push(record);
    let i = 0;
    const turns = this.turns;
    return {
      async next() {
        const turn = turns[i++];
        if (!turn) throw new Error("El guion se ha quedado sin turnos");
        return turn;
      },
      addToolResults(results) {
        record.results.push(results);
      },
    };
  }
}

export function call(name: string, input: unknown, id = `${name}_1`) {
  return { id, name, input };
}
