import {
  ProviderError,
  type AgentSession,
  type LlmProvider,
  type ModelTurn,
  type SessionOptions,
  type ToolResult,
} from "./types";

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  /**
   * Tamaño de contexto que se pide a Ollama. Su valor por defecto es corto y,
   * cuando el prompt no cabe, Ollama no falla: recorta por el principio sin
   * avisar. Lo primero que se pierde son las instrucciones y la tabla de
   * fechas, y el modelo empieza a inventarse días. Con las herramientas y una
   * conversación normal, 8192 va holgado.
   */
  numCtx?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface OllamaToolCall {
  id?: string;
  function: { name: string; arguments: unknown };
}

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaChatResponse {
  message?: OllamaMessage;
  done_reason?: string;
  error?: string;
}

/**
 * Un modelo propio servido con Ollama: sin coste por token y sin que la agenda
 * salga de tu máquina. Usa la API nativa (`/api/chat`), que admite
 * herramientas desde la 0.3.
 */
export class OllamaProvider implements LlmProvider {
  readonly id = "ollama";
  readonly model: string;
  readonly label: string;
  private readonly baseUrl: string;
  private readonly numCtx: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = options.model ?? "qwen2.5:7b";
    this.numCtx = options.numCtx ?? 8192;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.label = `${this.model} (Ollama, self-hosted)`;
  }

  startSession(options: SessionOptions): AgentSession {
    const provider = this;
    const messages: OllamaMessage[] = [
      { role: "system", content: `${options.instructions}\n\n${options.context}` },
      ...options.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const tools = options.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));
    let callCounter = 0;

    return {
      async next(): Promise<ModelTurn> {
        const data = await provider.chat(
          {
            model: provider.model,
            messages,
            tools,
            stream: false,
            options: { temperature: 0.2, num_ctx: provider.numCtx },
          },
          options.signal,
        );
        const message = data.message;
        if (!message) throw new ProviderError("Ollama ha devuelto una respuesta vacía.");

        const toolCalls = (message.tool_calls ?? []).map((call) => ({
          // Ollama no siempre pone id a las llamadas; hace falta uno para
          // emparejar cada resultado con su llamada en la interfaz.
          id: call.id ?? `call_${++callCounter}`,
          name: call.function.name,
          input: parseArguments(call.function.arguments),
        }));
        messages.push({
          role: "assistant",
          content: message.content ?? "",
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        });

        if (data.done_reason === "length") {
          return { text: "", toolCalls: [], stop: "max_tokens" };
        }
        return {
          text: stripThinking(message.content ?? ""),
          toolCalls,
          stop: toolCalls.length > 0 ? "tool_use" : "end",
        };
      },

      addToolResults(results: ToolResult[]) {
        for (const r of results) {
          messages.push({ role: "tool", content: r.content, tool_name: r.name });
        }
      },
    };
  }

  private async chat(body: unknown, signal?: AbortSignal): Promise<OllamaChatResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timeout.aborted) {
        throw new ProviderError(
          `Ollama no ha contestado en ${Math.round(this.timeoutMs / 1000)} s. Con CPU y un modelo grande pasa; prueba uno más pequeño.`,
        );
      }
      throw new ProviderError(`No se puede conectar con Ollama en ${this.baseUrl}. ¿Está arrancado?`);
    }

    const data = (await res.json().catch(() => ({}))) as OllamaChatResponse;
    if (!res.ok) {
      const detail = data.error ?? `HTTP ${res.status}`;
      if (res.status === 404 && /not found/i.test(detail)) {
        throw new ProviderError(`El modelo ${this.model} no está descargado. Ejecuta: ollama pull ${this.model}`);
      }
      if (/does not support tools/i.test(detail)) {
        throw new ProviderError(`${this.model} no admite herramientas. Usa uno que sí, como qwen2.5:7b o llama3.1:8b.`);
      }
      throw new ProviderError(`Ollama ha devuelto un error: ${detail}`);
    }
    return data;
  }
}

/** Según la versión, Ollama da los argumentos como objeto o como JSON en texto. */
function parseArguments(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  try {
    return JSON.parse(args);
  } catch {
    // Se deja pasar tal cual: la validación de la herramienta devolverá el
    // error al modelo para que lo corrija.
    return args;
  }
}

/** Los modelos con razonamiento visible (qwen3, deepseek-r1) lo mezclan con la respuesta. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
