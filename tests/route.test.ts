import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/lib/protocol";
import { call, ScriptedProvider } from "./scripted-provider";

let provider: ScriptedProvider;
vi.mock("@/lib/providers", () => ({ getProvider: () => provider }));

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/chat/route");
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function readStream(res: Response): Promise<StreamEvent[]> {
  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as StreamEvent);
}

const valid = {
  message: "Apunta el gimnasio mañana a las 8",
  history: [],
  events: [],
  now: "2026-09-24T10:30",
  timeZone: "Europe/Madrid",
};

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RATE_LIMIT_PER_10MIN = "";
    process.env.DAILY_LIMIT = "";
    process.env.TRUSTED_IP_HEADER = "";
  });

  it("devuelve los pasos y luego la agenda nueva, línea a línea", async () => {
    provider = new ScriptedProvider([
      {
        text: "",
        stop: "tool_use",
        toolCalls: [call("create_event", { title: "Gimnasio", start: "2026-09-25T08:00" })],
      },
      { text: "Hecho: gimnasio mañana a las 8:00.", stop: "end", toolCalls: [] },
    ]);
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/ndjson/);

    const events = await readStream(res);
    expect(events[0]).toMatchObject({ type: "step", step: { type: "tool", name: "create_event", ok: true } });
    const done = events[1];
    expect(done.type).toBe("done");
    if (done.type !== "done") return;
    expect(done.reply).toBe("Hecho: gimnasio mañana a las 8:00.");
    expect(done.changed).toBe(true);
    expect(done.events).toMatchObject([{ title: "Gimnasio", start: "2026-09-25T08:00", end: "2026-09-25T09:00" }]);
  });

  it("rechaza peticiones mal formadas antes de llamar al modelo", async () => {
    provider = new ScriptedProvider([]);
    expect((await post("no es json")).status).toBe(400);
    expect((await post({ ...valid, message: "  " })).status).toBe(400);
    expect((await post({ ...valid, now: "mañana" })).status).toBe(400);
    expect((await post({ ...valid, timeZone: "Marte/Olympus" })).status).toBe(400);
    const dup = { id: "a", title: "X", start: "2026-09-25T08:00", end: "2026-09-25T09:00" };
    const res = await post({ ...valid, events: [dup, dup] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/repetidos/);
    expect(provider.sessions).toHaveLength(0);
  });

  it("limita por visitante con la cabecera de confianza", async () => {
    process.env.RATE_LIMIT_PER_10MIN = "1";
    process.env.TRUSTED_IP_HEADER = "cf-connecting-ip";
    provider = new ScriptedProvider(
      Array.from({ length: 5 }, () => ({ text: "Ok", stop: "end" as const, toolCalls: [] })),
    );
    expect((await post(valid, { "cf-connecting-ip": "203.0.113.10" })).status).toBe(200);
    const limited = await post(valid, { "cf-connecting-ip": "203.0.113.10" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await post(valid, { "cf-connecting-ip": "203.0.113.20" })).status).toBe(200);
  });

  it("el tope diario es global", async () => {
    process.env.DAILY_LIMIT = "1";
    provider = new ScriptedProvider(
      Array.from({ length: 5 }, () => ({ text: "Ok", stop: "end" as const, toolCalls: [] })),
    );
    expect((await post(valid)).status).toBe(200);
    const res = await post(valid);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/límite de hoy/);
  });

  it("un fallo del proveedor llega como evento de error legible", async () => {
    const { ProviderError } = await import("@/lib/providers/types");
    provider = new ScriptedProvider([]);
    provider.startSession = () => ({
      next: async () => {
        throw new ProviderError("No se puede conectar con Ollama en http://localhost:11434. ¿Está arrancado?");
      },
      addToolResults: () => {},
    });
    const events = await readStream(await post(valid));
    expect(events).toEqual([
      { type: "error", message: "No se puede conectar con Ollama en http://localhost:11434. ¿Está arrancado?" },
    ]);
  });
});
