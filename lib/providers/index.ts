import { AnthropicProvider, type Effort } from "./anthropic";
import { OllamaProvider } from "./ollama";
import { ProviderError, type LlmProvider } from "./types";

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ProviderError(`${name} debe ser un entero positivo.`);
  return n;
}

/**
 * El proveedor se elige por entorno y no desde la interfaz: quien despliega
 * decide dónde se procesa la agenda, no quien la visita.
 */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): LlmProvider {
  // Una variable vacía cuenta como no puesta: docker compose las pasa así
  // cuando no están en el .env, y "" no es una URL ni un modelo.
  const get = (name: string) => env[name]?.trim() || undefined;
  const which = (get("LLM_PROVIDER") ?? "ollama").toLowerCase();

  if (which === "ollama") {
    return new OllamaProvider({
      baseUrl: get("OLLAMA_URL"),
      model: get("OLLAMA_MODEL"),
      numCtx: positiveInt(get("OLLAMA_NUM_CTX"), "OLLAMA_NUM_CTX"),
      timeoutMs: positiveInt(get("OLLAMA_TIMEOUT_MS"), "OLLAMA_TIMEOUT_MS"),
    });
  }

  if (which === "anthropic") {
    const effort = get("ANTHROPIC_EFFORT") as Effort | undefined;
    if (effort && !EFFORTS.includes(effort)) {
      throw new ProviderError(`ANTHROPIC_EFFORT debe ser uno de: ${EFFORTS.join(", ")}.`);
    }
    return new AnthropicProvider({
      model: get("ANTHROPIC_MODEL"),
      effort,
      apiKey: get("ANTHROPIC_API_KEY"),
    });
  }

  throw new ProviderError(`LLM_PROVIDER="${which}" no existe. Usa "ollama" o "anthropic".`);
}

let cached: LlmProvider | undefined;

export function getProvider(): LlmProvider {
  cached ??= providerFromEnv();
  return cached;
}
