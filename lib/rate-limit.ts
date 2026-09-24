/**
 * Límite de peticiones en memoria, por ventana deslizante.
 *
 * En memoria porque la app corre en un solo contenedor: con varias réplicas
 * cada una contaría por su cuenta y habría que moverlo a Redis. Para una demo
 * pública en un servidor propio, así basta y no añade ninguna pieza.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /**
   * Apunta una petición si cabe. Si no, dice cuántos segundos faltan.
   *
   * `cost` es cuántas llamadas al modelo vale: un mensaje del chat cuenta como
   * una, y un informe mensual como las que haga. Si no, el tope diario, que
   * está para poner techo a lo que cuesta la demo, dejaría escapar la parte
   * más cara.
   */
  take(key: string, cost = 1): { ok: true } | { ok: false; retryAfterSeconds: number } {
    if (this.limit <= 0) return { ok: true };
    const now = this.clock();
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);

    if (recent.length + cost > this.limit) {
      this.hits.set(key, recent);
      // Si no cabe ni con la ventana vacía, esperar no arregla nada; se dice
      // el tiempo hasta que se vacíe, que es lo más honesto que se puede dar.
      const oldest = recent[0] ?? now;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }
    for (let i = 0; i < cost; i++) recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(since);
    return { ok: true };
  }

  private prune(since: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= since)) this.hits.delete(key);
    }
  }
}
