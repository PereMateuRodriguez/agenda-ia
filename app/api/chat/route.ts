import { runAgent } from "@/lib/agent";
import { chatRequestSchema, type StreamEvent } from "@/lib/protocol";
import { getProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";
import { RateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

function intFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 && process.env[name] !== "" ? n : fallback;
}

/*
 * Dos límites. El de cada visitante evita que una sola persona acapare el
 * modelo. El diario, global, pone techo a lo que puede costar la demo pública
 * en el peor caso, con Claude, o a cuánto rato puede estar la GPU ocupada, con
 * Ollama. Un 0 desactiva cualquiera de los dos.
 */
const perVisitor = new RateLimiter(intFromEnv("RATE_LIMIT_PER_10MIN", 30), 10 * 60 * 1000);
const daily = new RateLimiter(intFromEnv("DAILY_LIMIT", 1000), 24 * 60 * 60 * 1000);

/**
 * Sin una cabecera de confianza, todas las visitas cuentan como una sola: la
 * IP que ve la app es la del proxy, y fiarse de X-Forwarded-For sin saber
 * quién la pone es regalarle el límite a cualquiera que la escriba a mano.
 * Detrás de Cloudflare, TRUSTED_IP_HEADER=cf-connecting-ip.
 */
function visitorKey(request: Request): string {
  const header = process.env.TRUSTED_IP_HEADER;
  return (header && request.headers.get(header)?.split(",")[0]?.trim()) || "anonimo";
}

function jsonError(message: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error: message }, { status, headers });
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return jsonError("La petición es demasiado grande.", 413);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError("La petición es demasiado grande.", 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError("El cuerpo no es JSON válido.", 400);
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Petición inválida.", 400);
  }

  for (const [limiter, key, message] of [
    [perVisitor, visitorKey(request), "Demasiados mensajes seguidos. Espera un poco."],
    [daily, "global", "La demo ha llegado a su límite de hoy. Vuelve mañana."],
  ] as const) {
    const verdict = limiter.take(key);
    if (!verdict.ok) {
      return jsonError(message, 429, { "retry-after": String(verdict.retryAfterSeconds) });
    }
  }

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    return jsonError(err instanceof ProviderError ? err.message : "Proveedor mal configurado.", 500);
  }

  const { message, history, events, now, timeZone } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Si quien preguntaba ha cerrado la pestaña, el stream ya no acepta
      // nada; no es un error del agente y no debe cortarlo a medias.
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };
      try {
        const result = await runAgent({
          provider,
          events,
          history,
          message,
          now,
          timeZone,
          signal: request.signal,
          onStep: (step) => send({ type: "step", step }),
        });
        send({ type: "done", reply: result.reply, events: result.events, changed: result.changed });
      } catch (err) {
        if (!request.signal.aborted) {
          if (!(err instanceof ProviderError)) console.error("[api/chat]", err);
          send({
            type: "error",
            message:
              err instanceof ProviderError ? err.message : "Algo ha fallado al hablar con el modelo. Prueba otra vez.",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Que ningún proxy intermedio se guarde la respuesta hasta el final:
      // los pasos tienen que llegar según ocurren.
      "x-accel-buffering": "no",
    },
  });
}
