import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("deja pasar hasta el límite y dice cuánto esperar", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.take("ip").ok).toBe(true);
    now = 10_000;
    expect(limiter.take("ip").ok).toBe(true);
    expect(limiter.take("ip")).toEqual({ ok: false, retryAfterSeconds: 50 });
    expect(limiter.take("otra").ok).toBe(true);
    now = 60_001;
    expect(limiter.take("ip").ok).toBe(true);
  });

  it("un límite de 0 lo desactiva", () => {
    const limiter = new RateLimiter(0, 60_000);
    for (let i = 0; i < 100; i++) expect(limiter.take("x").ok).toBe(true);
  });
});
