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

  it("una petición cara cuenta por todas las llamadas que hace", () => {
    let now = 0;
    const limiter = new RateLimiter(5, 60_000, () => now);
    expect(limiter.take("ip", 4).ok).toBe(true);
    // No cabe entera: se rechaza sin gastar lo que queda.
    expect(limiter.take("ip", 2)).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(limiter.take("ip").ok).toBe(true);
    expect(limiter.take("ip").ok).toBe(false);
    now = 60_001;
    expect(limiter.take("ip", 5).ok).toBe(true);
  });

  it("un límite de 0 lo desactiva", () => {
    const limiter = new RateLimiter(0, 60_000);
    for (let i = 0; i < 100; i++) expect(limiter.take("x").ok).toBe(true);
  });
});
