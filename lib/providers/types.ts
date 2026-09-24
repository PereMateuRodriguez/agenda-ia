/**
 * Lo mínimo que el agente necesita de un modelo: que conteste o que pida
 * herramientas. El bucle vive en `lib/agent.ts` y es el mismo para Ollama y
 * para Claude; cada proveedor solo traduce a su API.
 *
 * La conversación de una petición la guarda la sesión del proveedor, en su
 * formato nativo, en vez de un formato común. Así no se pierde nada que la API
 * necesite de vuelta: los bloques de razonamiento de Claude, por ejemplo, hay
 * que devolverlos tal cual en el siguiente turno de un bucle con herramientas.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema del objeto de entrada. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface ModelTurn {
  /** Texto para el usuario. Puede venir junto a llamadas a herramientas. */
  text: string;
  toolCalls: ToolCall[];
  /**
   * `refusal`: el modelo declina la petición. `max_tokens`: se ha cortado a
   * mitad; no se ejecuta nada de ese turno porque una llamada a medias puede
   * parecer válida.
   */
  stop: "end" | "tool_use" | "refusal" | "max_tokens";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionOptions {
  /** Instrucciones fijas: no cambian entre peticiones y se pueden cachear. */
  instructions: string;
  /** Contexto de esta petición: la fecha de hoy y la tabla de días. */
  context: string;
  /** Conversación previa en texto, terminada en el mensaje nuevo del usuario. */
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export interface AgentSession {
  next(): Promise<ModelTurn>;
  addToolResults(results: ToolResult[]): void;
}

export interface LlmProvider {
  /** "ollama" o "anthropic". */
  readonly id: string;
  /** Para enseñarlo en la interfaz: qué modelo está respondiendo. */
  readonly label: string;
  readonly model: string;
  startSession(options: SessionOptions): AgentSession;
}

/** El proveedor no está disponible o ha fallado: se enseña tal cual al usuario. */
export class ProviderError extends Error {}
