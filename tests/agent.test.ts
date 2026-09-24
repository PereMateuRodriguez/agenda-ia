import { describe, expect, it } from "vitest";
import { runAgent, trimHistory, type AgentStep } from "@/lib/agent";
import type { CalendarEvent } from "@/lib/calendar";
import { call, ScriptedProvider } from "./scripted-provider";

const NOW = "2026-09-24T10:30";
const events: CalendarEvent[] = [{ id: "a", title: "Dentista", start: "2026-09-25T17:00", end: "2026-09-25T18:00" }];

function run(provider: ScriptedProvider, message: string, extra: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const steps: AgentStep[] = [];
  let n = 0;
  const promise = runAgent({
    provider,
    events,
    history: [],
    message,
    now: NOW,
    timeZone: "Europe/Madrid",
    newId: () => `ev_${++n}`,
    onStep: (s) => steps.push(s),
    ...extra,
  });
  return { promise, steps };
}

describe("runAgent", () => {
  it("ejecuta las herramientas que pide el modelo y devuelve la agenda nueva", async () => {
    const provider = new ScriptedProvider([
      {
        text: "",
        stop: "tool_use",
        toolCalls: [call("search_events", { query: "dentista" })],
      },
      {
        text: "",
        stop: "tool_use",
        toolCalls: [call("update_event", { id: "a", start: "2026-09-28T17:00" })],
      },
      { text: "Hecho: dentista el lunes 28 a las 17:00.", stop: "end", toolCalls: [] },
    ]);

    const { promise, steps } = run(provider, "Pasa el dentista al lunes");
    const result = await promise;

    expect(result.reply).toBe("Hecho: dentista el lunes 28 a las 17:00.");
    expect(result.changed).toBe(true);
    expect(result.events).toEqual([{ id: "a", title: "Dentista", start: "2026-09-28T17:00", end: "2026-09-28T18:00" }]);
    expect(steps.map((s) => s.type === "tool" && s.summary)).toEqual([
      "Buscado «dentista» (1 resultado)",
      "Modificado «Dentista» · vie 25/09 17:00–18:00 → lun 28/09 17:00–18:00",
    ]);

    // El modelo recibe el resultado de cada llamada, emparejado por id.
    const [session] = provider.sessions;
    expect(session.results[0][0]).toMatchObject({ id: "search_events_1", name: "search_events", isError: false });
    expect(JSON.parse(session.results[0][0].content).events[0].id).toBe("a");
  });

  it("le pasa las instrucciones, el contexto con la fecha y el mensaje al final", async () => {
    const provider = new ScriptedProvider([{ text: "Nada.", stop: "end", toolCalls: [] }]);
    await run(provider, "¿Qué tengo?", {
      history: [
        { role: "assistant", content: "¡Hola!" },
        { role: "user", content: "hola" },
        { role: "assistant", content: "¿En qué te ayudo?" },
      ],
    }).promise;

    const { options } = provider.sessions[0];
    expect(options.instructions).toMatch(/asistente de una agenda/);
    expect(options.context).toContain("2026-09-24  (HOY)");
    expect(options.tools.map((t) => t.name)).toContain("create_event");
    // Se quita el saludo inicial del asistente: la conversación debe empezar por el usuario.
    expect(options.messages).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿En qué te ayudo?" },
      { role: "user", content: "¿Qué tengo?" },
    ]);
  });

  it("un error de herramienta vuelve al modelo y no cambia la agenda", async () => {
    const provider = new ScriptedProvider([
      { text: "", stop: "tool_use", toolCalls: [call("delete_event", { id: "zzz" })] },
      { text: "No encuentro ese evento.", stop: "end", toolCalls: [] },
    ]);
    const { promise, steps } = run(provider, "Borra la reunión");
    const result = await promise;

    expect(result.changed).toBe(false);
    expect(result.events).toEqual(events);
    expect(steps[0]).toMatchObject({ type: "tool", ok: false });
    expect(provider.sessions[0].results[0][0].isError).toBe(true);
  });

  it("varias llamadas en el mismo turno se devuelven juntas", async () => {
    const provider = new ScriptedProvider([
      {
        text: "Voy a apuntar las dos.",
        stop: "tool_use",
        toolCalls: [
          call("create_event", { title: "Gimnasio", start: "2026-09-28T08:00" }, "c1"),
          call("create_event", { title: "Gimnasio", start: "2026-09-30T08:00" }, "c2"),
        ],
      },
      { text: "Apuntado.", stop: "end", toolCalls: [] },
    ]);
    const { promise, steps } = run(provider, "Gimnasio el lunes y el miércoles a las 8");
    const result = await promise;

    expect(provider.sessions[0].results).toHaveLength(1);
    expect(provider.sessions[0].results[0].map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(result.events).toHaveLength(3);
    expect(steps[0]).toEqual({ type: "note", text: "Voy a apuntar las dos." });
  });

  it("se para si el modelo no termina nunca", async () => {
    const loop = { text: "", stop: "tool_use" as const, toolCalls: [call("list_events", { from_date: "2026-09-24" })] };
    const provider = new ScriptedProvider(Array.from({ length: 10 }, () => loop));
    const result = await run(provider, "?", { maxTurns: 3 }).promise;
    expect(result.reply).toMatch(/demasiadas vueltas/);
    expect(provider.sessions[0].results).toHaveLength(3);
  });

  it("un rechazo del modelo no ejecuta nada", async () => {
    const provider = new ScriptedProvider([{ text: "", stop: "refusal", toolCalls: [] }]);
    const result = await run(provider, "…").promise;
    expect(result.reply).toMatch(/No puedo ayudarte/);
    expect(result.changed).toBe(false);
  });

  it("una respuesta cortada no ejecuta herramientas a medias", async () => {
    const provider = new ScriptedProvider([{ text: "", stop: "max_tokens", toolCalls: [] }]);
    const result = await run(provider, "…").promise;
    expect(result.reply).toMatch(/cortado/);
  });
});

describe("trimHistory", () => {
  it("se queda con los últimos mensajes empezando por el usuario", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: String(i),
    }));
    const trimmed = trimHistory(history);
    expect(trimmed[0]).toEqual({ role: "user", content: "8" });
    expect(trimmed).toHaveLength(12);
  });

  it("sin mensajes del usuario no manda nada", () => {
    expect(trimHistory([{ role: "assistant", content: "hola" }])).toEqual([]);
  });
});
