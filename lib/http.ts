/**
 * Lo que comparten las rutas de la API: el tope de tamaño, la lectura del
 * cuerpo y la forma de contestar un error.
 */

export const MAX_BODY_BYTES = 512 * 1024;

export function jsonError(message: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error: message }, { status, headers });
}

/**
 * Lee el cuerpo como JSON sin fiarse de lo que declara: el tamaño se mira
 * antes de leer, por la cabecera, y otra vez después, por si mentía.
 */
export async function readJson(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, response: jsonError("La petición es demasiado grande.", 413) };

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, response: jsonError("La petición es demasiado grande.", 413) };

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: jsonError("El cuerpo no es JSON válido.", 400) };
  }
}

/** Respuesta NDJSON: una línea por evento, según ocurren. */
export function ndjson(stream: ReadableStream<Uint8Array>): Response {
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
