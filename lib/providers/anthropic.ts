import Anthropic from "@anthropic-ai/sdk";
import {
  ProviderError,
  type AgentSession,
  type LlmProvider,
  type ModelTurn,
  type SessionOptions,
  type ToolResult,
} from "./types";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicOptions {
  model?: string;
  /**
   * Cuánto piensa el modelo antes de actuar. `medium` va sobrado para una
   * agenda y responde bastante más rápido que el `high` por defecto; subirlo
   * solo compensa si se ve que falla con fechas enrevesadas.
   */
  effort?: Effort;
  /** Si falta, el SDK busca la credencial por su cuenta (ANTHROPIC_API_KEY…). */
  apiKey?: string;
  client?: Anthropic;
}

/**
 * Claude por la API de Anthropic. La clave la lee el SDK de ANTHROPIC_API_KEY.
 *
 * Va por `client.beta.messages` por un único motivo: `fallbacks: "default"`.
 * Si el clasificador de seguridad del modelo declina una petición legítima, la
 * API la repite sola con el modelo de respaldo que toque, en la misma llamada,
 * en vez de devolver un rechazo. En una agenda es raro que pase, pero la
 * alternativa sería contestar «no puedo ayudarte» a quien pide mover una cita.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  readonly model: string;
  readonly label: string;
  private readonly effort: Effort;
  private readonly client: Anthropic;

  constructor(options: AnthropicOptions = {}) {
    this.model = options.model ?? "claude-opus-5";
    this.effort = options.effort ?? "medium";
    this.label = `${this.model} (Anthropic)`;
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  startSession(options: SessionOptions): AgentSession {
    const { client, model, effort } = this;
    const tools: Anthropic.Beta.BetaTool[] = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    // Lo fijo va primero y con su marca de caché; la fecha de hoy, detrás.
    // Si la fecha fuera delante, cambiaría cada minuto e invalidaría todo.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: options.instructions, cache_control: { type: "ephemeral" } },
      { type: "text", text: options.context },
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return {
      async next(): Promise<ModelTurn> {
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await client.beta.messages.create(
            {
              model,
              max_tokens: 16000,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              output_config: { effort },
              // Caché automática para la cola de la conversación: dentro de un
              // mismo bucle cada vuelta reutiliza todo lo anterior.
              cache_control: { type: "ephemeral" },
              system,
              // Sin herramientas —un informe solo redacta— el campo no se manda:
              // una lista vacía no es lo mismo que no ofrecer ninguna.
              ...(tools.length > 0 ? { tools } : {}),
              messages,
            },
            { signal: options.signal },
          );
        } catch (err) {
          throw toProviderError(err);
        }

        // Antes de leer el contenido: un rechazo puede traerlo vacío o a medias.
        if (response.stop_reason === "refusal") {
          return { text: "", toolCalls: [], stop: "refusal" };
        }
        if (response.stop_reason === "max_tokens") {
          return { text: "", toolCalls: [], stop: "max_tokens" };
        }

        // Se devuelve el contenido entero, no solo el texto: los bloques de
        // razonamiento tienen que volver sin tocar en el siguiente turno.
        messages.push({ role: "assistant", content: response.content });

        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const toolCalls = response.content
          .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));

        return { text, toolCalls, stop: toolCalls.length > 0 ? "tool_use" : "end" };
      },

      addToolResults(results: ToolResult[]) {
        // Todos los resultados en un solo mensaje: repartirlos en varios le
        // enseña al modelo a dejar de pedir herramientas en paralelo.
        messages.push({
          role: "user",
          content: results.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.id,
            content: r.content,
            is_error: r.isError,
          })),
        });
      },
    };
  }
}

function toProviderError(err: unknown): Error {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new ProviderError("La clave de Anthropic no es válida. Revisa ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError("Anthropic está limitando las peticiones. Prueba en un minuto.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ProviderError(`Anthropic ha rechazado la petición: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("No se puede conectar con la API de Anthropic.");
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(`Error de la API de Anthropic (${err.status ?? "sin código"}).`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
