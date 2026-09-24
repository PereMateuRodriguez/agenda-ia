import { jsonError } from "./http";
import { RateLimiter } from "./rate-limit";

function intFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 && process.env[name] !== "" ? n : fallback;
}

/*
 * Dos límites, compartidos por el chat y los informes. El de cada visitante
 * evita que una sola persona acapare el modelo. El diario, global, pone techo
 * a lo que puede costar la demo pública en el peor caso, con Claude, o a
 * cuánto rato puede estar la GPU ocupada, con Ollama. Un 0 desactiva
 * cualquiera de los dos.
 *
 * Tienen que ser los mismos objetos para las dos rutas: con un par de límites
 * por ruta, los informes serían una puerta sin techo al lado del chat.
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

/**
 * Apunta la petición en los dos límites. Devuelve la respuesta 429 si alguno
 * no la deja pasar, o null si puede seguir. `cost` son las llamadas al modelo
 * que va a hacer.
 */
export function checkLimits(request: Request, cost = 1): Response | null {
  for (const [limiter, key, message] of [
    [perVisitor, visitorKey(request), "Demasiados mensajes seguidos. Espera un poco."],
    [daily, "global", "La demo ha llegado a su límite de hoy. Vuelve mañana."],
  ] as const) {
    const verdict = limiter.take(key, cost);
    if (!verdict.ok) {
      return jsonError(message, 429, { "retry-after": String(verdict.retryAfterSeconds) });
    }
  }
  return null;
}
