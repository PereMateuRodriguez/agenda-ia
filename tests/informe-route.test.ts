import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InformeStreamEvent } from "@/lib/protocol";
import type { ModelTurn } from "@/lib/providers/types";
import { ScriptedProvider } from "./scripted-provider";

let provider: ScriptedProvider;
vi.mock("@/lib/providers", () => ({ getProvider: () => provider }));

const ok: ModelTurn = { text: "## Resumen\nBien.", stop: "end", toolCalls: [] };

async function post(ruta: "informe" | "chat", body: unknown) {
  const { POST } = ruta === "informe" ? await import("@/app/api/informe/route") : await import("@/app/api/chat/route");
  return POST(
    new Request(`http://localhost/api/${ruta}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function readStream(res: Response): Promise<InformeStreamEvent[]> {
  return (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as InformeStreamEvent);
}

const semanal = {
  tipo: "semana",
  desde: "2026-09-21",
  hoy: "2026-09-28",
  entradas: [{ fecha: "2026-09-22", texto: "Reunión con el cliente." }],
  eventos: [],
};

// Cuatro llamadas: tres semanas con diario y el informe final.
const mensual = {
  tipo: "mes",
  desde: "2026-09-01",
  hoy: "2026-10-02",
  entradas: [
    { fecha: "2026-09-02", texto: "a" },
    { fecha: "2026-09-08", texto: "b" },
    { fecha: "2026-09-15", texto: "c" },
  ],
  eventos: [],
};

describe("POST /api/informe", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.RATE_LIMIT_PER_10MIN = "";
    process.env.DAILY_LIMIT = "";
    process.env.TRUSTED_IP_HEADER = "";
  });

  it("cuenta por dónde va y termina con el informe", async () => {
    provider = new ScriptedProvider([ok]);
    const res = await post("informe", semanal);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/ndjson/);

    const eventos = await readStream(res);
    expect(eventos[0]).toEqual({ type: "progreso", texto: "Redactando el informe de la semana…" });
    const hecho = eventos[1];
    expect(hecho.type).toBe("hecho");
    if (hecho.type !== "hecho") return;
    expect(hecho.informe.markdown).toMatch(/^# Informe de la semana del 21 al 27 de septiembre de 2026/);
    expect(hecho.informe.narrativa).toBe("## Resumen\nBien.");
  });

  it("rechaza lo que no cuadra antes de llamar al modelo", async () => {
    provider = new ScriptedProvider([]);
    expect((await post("informe", { ...semanal, desde: "2026-09-22" })).status).toBe(400);
    expect((await post("informe", { ...semanal, entradas: [] })).status).toBe(400);
    expect((await post("informe", { ...semanal, tipo: "año" })).status).toBe(400);
    const largo = await post("informe", { ...semanal, entradas: [{ fecha: "2026-09-22", texto: "x".repeat(2001) }] });
    expect(largo.status).toBe(400);
    expect(provider.sessions).toHaveLength(0);
  });

  it("un mensual cuenta para el límite por todas las llamadas que hace", async () => {
    process.env.RATE_LIMIT_PER_10MIN = "3";
    provider = new ScriptedProvider([]);
    const res = await post("informe", mensual);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(provider.sessions).toHaveLength(0);
  });

  it("el tope diario es el mismo para el chat y para los informes", async () => {
    process.env.DAILY_LIMIT = "2";
    provider = new ScriptedProvider(Array.from({ length: 5 }, () => ok));
    const chat = {
      message: "¿Qué tengo mañana?",
      history: [],
      events: [],
      now: "2026-09-28T10:00",
      timeZone: "Europe/Madrid",
    };
    expect((await post("chat", chat)).status).toBe(200);
    expect((await post("informe", semanal)).status).toBe(200);

    const agotado = await post("informe", semanal);
    expect(agotado.status).toBe(429);
    expect((await agotado.json()).error).toMatch(/límite de hoy/);
    expect((await post("chat", chat)).status).toBe(429);
  });

  it("un fallo del modelo llega como evento de error legible", async () => {
    provider = new ScriptedProvider([{ text: "", stop: "refusal", toolCalls: [] }]);
    const eventos = await readStream(await post("informe", semanal));
    expect(eventos.at(-1)).toEqual({
      type: "error",
      message: "El modelo no ha querido redactar el informe. Prueba otra vez.",
    });
  });
});
