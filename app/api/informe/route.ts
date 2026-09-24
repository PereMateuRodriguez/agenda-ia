import { jsonError, ndjson, readJson } from "@/lib/http";
import { generarInforme, planificar } from "@/lib/informe";
import { checkLimits } from "@/lib/limits";
import { informeRequestSchema, type InformeStreamEvent } from "@/lib/protocol";
import { getProvider } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/**
 * Redacta el informe semanal o mensual del diario. Como el chat, no guarda
 * nada: el diario llega en la petición y el informe vuelve en la respuesta.
 *
 * Primero se valida y se decide el trabajo, y solo entonces se cuenta contra
 * los límites, por el número de llamadas al modelo que va a hacer: una
 * petición mal formada no gasta nada.
 */
export async function POST(request: Request) {
  const read = await readJson(request);
  if (!read.ok) return read.response;

  const parsed = informeRequestSchema.safeParse(read.body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Petición inválida.", 400);
  }

  const planned = planificar(parsed.data);
  if (!planned.ok) return jsonError(planned.error, 400);
  const { plan } = planned;

  const limited = checkLimits(request, plan.llamadas);
  if (limited) return limited;

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    return jsonError(err instanceof ProviderError ? err.message : "Proveedor mal configurado.", 500);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: InformeStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };
      try {
        const informe = await generarInforme({
          provider,
          plan,
          signal: request.signal,
          onProgreso: (texto) => send({ type: "progreso", texto }),
        });
        send({ type: "hecho", informe });
      } catch (err) {
        if (!request.signal.aborted) {
          if (!(err instanceof ProviderError)) console.error("[api/informe]", err);
          send({
            type: "error",
            message:
              err instanceof ProviderError ? err.message : "Algo ha fallado al redactar el informe. Prueba otra vez.",
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
