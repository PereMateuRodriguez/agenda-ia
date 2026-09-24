import { runAgent } from "@/lib/agent";
import { jsonError, ndjson, readJson } from "@/lib/http";
import { checkLimits } from "@/lib/limits";
import { chatRequestSchema, type StreamEvent } from "@/lib/protocol";
import { getProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const read = await readJson(request);
  if (!read.ok) return read.response;

  const parsed = chatRequestSchema.safeParse(read.body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Petición inválida.", 400);
  }

  const limited = checkLimits(request);
  if (limited) return limited;

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

  return ndjson(stream);
}
