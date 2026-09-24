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
  /**
   * El guion avanza a lo largo de todas las sesiones, no se reinicia en cada
   * una: un informe mensual abre una sesión por tramo y otra para el final, y
   * cada una tiene que recibir su propia respuesta.
   */
  private cursor = 0;

  constructor(private readonly turns: ModelTurn[]) {}

  startSession(options: SessionOptions): AgentSession {
    const record = { options, results: [] as ToolResult[][] };
    this.sessions.push(record);
    const next = () => this.turns[this.cursor++];
    return {
      async next() {
        const turn = next();
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
