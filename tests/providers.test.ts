import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { providerFromEnv } from "@/lib/providers";
import { AnthropicProvider } from "@/lib/providers/anthropic";
import { OllamaProvider } from "@/lib/providers/ollama";
import { ProviderError, type SessionOptions } from "@/lib/providers/types";

const options: SessionOptions = {
  instructions: "INSTRUCCIONES",
  context: "CONTEXTO",
  messages: [{ role: "user", content: "¿Qué tengo mañana?" }],
  tools: [
    {
      name: "list_events",
      description: "Lista eventos",
      inputSchema: { type: "object", properties: { from_date: { type: "string" } }, required: ["from_date"] },
    },
  ],
};

describe("AnthropicProvider", () => {
  function fakeClient(responses: unknown[]) {
    const create = vi.fn();
    for (const r of responses) create.mockResolvedValueOnce(r);
    return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
  }

  it("pide herramientas y devuelve el contenido entero en el turno siguiente", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const toolUse = { type: "tool_use", id: "toolu_1", name: "list_events", input: { from_date: "2026-09-25" } };
    const { client, create } = fakeClient([
      { stop_reason: "tool_use", content: [thinking, toolUse] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Mañana tienes el dentista." }] },
    ]);
    const session = new AnthropicProvider({ client }).startSession(options);

    const first = await session.next();
    expect(first).toEqual({
      text: "",
      stop: "tool_use",
      toolCalls: [{ id: "toolu_1", name: "list_events", input: { from_date: "2026-09-25" } }],
    });

    session.addToolResults([{ id: "toolu_1", name: "list_events", content: "{}", isError: false }]);
    const second = await session.next();
    expect(second).toEqual({ text: "Mañana tienes el dentista.", toolCalls: [], stop: "end" });

    const request = create.mock.calls[1][0];
    expect(request.model).toBe("claude-opus-5");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.fallbacks).toBe("default");
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request.system).toEqual([
      { type: "text", text: "INSTRUCCIONES", cache_control: { type: "ephemeral" } },
      { type: "text", text: "CONTEXTO" },
    ]);
    expect(request.tools[0]).toEqual({
      name: "list_events",
      description: "Lista eventos",
      input_schema: options.tools[0].inputSchema,
    });
    // El bloque de razonamiento vuelve sin tocar, y los resultados van en un
    // único mensaje del usuario. (El array es el mismo objeto que sigue
    // creciendo, así que se miran los tres primeros.)
    expect(request.messages.slice(0, 3)).toEqual([
      { role: "user", content: "¿Qué tengo mañana?" },
      { role: "assistant", content: [thinking, toolUse] },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "{}", is_error: false }],
      },
    ]);
  });

  it("sin herramientas no manda el campo tools", async () => {
    const { client, create } = fakeClient([{ stop_reason: "end_turn", content: [{ type: "text", text: "Informe." }] }]);
    const session = new AnthropicProvider({ client }).startSession({ ...options, tools: [] });
    expect(await session.next()).toEqual({ text: "Informe.", toolCalls: [], stop: "end" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("tools");
  });

  it("mira el motivo de parada antes que el contenido", async () => {
    const { client } = fakeClient([
      { stop_reason: "refusal", content: [] },
      { stop_reason: "max_tokens", content: [{ type: "tool_use", id: "t", name: "list_events", input: {} }] },
    ]);
    const session = new AnthropicProvider({ client }).startSession(options);
    expect((await session.next()).stop).toBe("refusal");
    expect(await session.next()).toEqual({ text: "", toolCalls: [], stop: "max_tokens" });
  });

  it("traduce los errores de la API a mensajes para el usuario", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers()));
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    const session = new AnthropicProvider({ client }).startSession(options);
    await expect(session.next()).rejects.toThrow(ProviderError);
    await expect(session.next()).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("OllamaProvider", () => {
  function fakeFetch(bodies: { status?: number; body: unknown }[]) {
    const fn = vi.fn();
    for (const b of bodies) {
      fn.mockResolvedValueOnce(new Response(JSON.stringify(b.body), { status: b.status ?? 200 }));
    }
    return fn;
  }

  it("habla la API nativa de Ollama con herramientas", async () => {
    const fetch = fakeFetch([
      {
        body: {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ function: { name: "list_events", arguments: { from_date: "2026-09-25" } } }],
          },
          done_reason: "stop",
        },
      },
      { body: { message: { role: "assistant", content: "<think>mmm</think>Mañana, dentista." }, done_reason: "stop" } },
    ]);
    const provider = new OllamaProvider({ baseUrl: "http://gpu:11434/", model: "qwen2.5:7b", fetch });
    const session = provider.startSession(options);

    const first = await session.next();
    expect(first.toolCalls).toEqual([{ id: "call_1", name: "list_events", input: { from_date: "2026-09-25" } }]);
    session.addToolResults([{ id: "call_1", name: "list_events", content: "{}", isError: false }]);
    const second = await session.next();
    expect(second).toEqual({ text: "Mañana, dentista.", toolCalls: [], stop: "end" });

    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("http://gpu:11434/api/chat");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "qwen2.5:7b", stream: false, options: { num_ctx: 8192 } });
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "list_events", description: "Lista eventos", parameters: options.tools[0].inputSchema },
    });
    expect(body.messages[0]).toEqual({ role: "system", content: "INSTRUCCIONES\n\nCONTEXTO" });
    expect(body.messages.at(-1)).toEqual({ role: "tool", content: "{}", tool_name: "list_events" });
  });

  it("sin herramientas no manda el campo tools", async () => {
    const fetch = fakeFetch([{ body: { message: { role: "assistant", content: "Informe." }, done_reason: "stop" } }]);
    const session = new OllamaProvider({ fetch }).startSession({ ...options, tools: [] });
    expect(await session.next()).toEqual({ text: "Informe.", toolCalls: [], stop: "end" });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("tools");
  });

  it("acepta argumentos en texto JSON", async () => {
    const fetch = fakeFetch([
      {
        body: {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "x", function: { name: "list_events", arguments: '{"from_date":"2026-09-25"}' } }],
          },
        },
      },
    ]);
    const turn = await new OllamaProvider({ fetch }).startSession(options).next();
    expect(turn.toolCalls).toEqual([{ id: "x", name: "list_events", input: { from_date: "2026-09-25" } }]);
  });

  it("explica qué hacer si falta el modelo o no admite herramientas", async () => {
    const missing = new OllamaProvider({
      model: "qwen2.5:7b",
      fetch: fakeFetch([{ status: 404, body: { error: 'model "qwen2.5:7b" not found, try pulling it first' } }]),
    });
    await expect(missing.startSession(options).next()).rejects.toThrow("ollama pull qwen2.5:7b");

    const noTools = new OllamaProvider({
      model: "gemma2",
      fetch: fakeFetch([{ status: 400, body: { error: "registry.ollama.ai/library/gemma2 does not support tools" } }]),
    });
    await expect(noTools.startSession(options).next()).rejects.toThrow(/no admite herramientas/);
  });

  it("si Ollama no está arrancado lo dice", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const provider = new OllamaProvider({ baseUrl: "http://localhost:11434", fetch });
    await expect(provider.startSession(options).next()).rejects.toThrow(/¿Está arrancado\?/);
  });
});

describe("providerFromEnv", () => {
  it("usa Ollama por defecto", () => {
    const p = providerFromEnv({});
    expect(p.id).toBe("ollama");
    expect(p.model).toBe("qwen2.5:7b");
  });

  it("configura Anthropic", () => {
    const p = providerFromEnv({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "clave-de-prueba",
      ANTHROPIC_MODEL: "claude-sonnet-5",
    });
    expect(p.id).toBe("anthropic");
    expect(p.model).toBe("claude-sonnet-5");
  });

  it("trata las variables vacías como no puestas, que es como llegan desde docker compose", () => {
    const ollama = providerFromEnv({ LLM_PROVIDER: "", OLLAMA_URL: "", OLLAMA_MODEL: " ", OLLAMA_NUM_CTX: "" });
    expect(ollama.id).toBe("ollama");
    expect(ollama.model).toBe("qwen2.5:7b");
    const claude = providerFromEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_MODEL: "", ANTHROPIC_EFFORT: "" });
    expect(claude.model).toBe("claude-opus-5");
  });

  it("rechaza configuraciones que no existen", () => {
    expect(() => providerFromEnv({ LLM_PROVIDER: "openai" })).toThrow(/no existe/);
    expect(() => providerFromEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_EFFORT: "turbo" })).toThrow(/ANTHROPIC_EFFORT/);
    expect(() => providerFromEnv({ OLLAMA_NUM_CTX: "mucho" })).toThrow(/OLLAMA_NUM_CTX/);
  });
});
