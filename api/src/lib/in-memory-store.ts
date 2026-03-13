/**
 * In-memory implementation of the RedisLike interface used by OnboardingSessionStore.
 *
 * Intended for development/test when REDIS_URL is not available.
 * Does NOT survive process restarts — use real Redis in production.
 */
import type { RedisLike } from "./onboarding-session-store";

interface StringEntry {
  value: string;
  expiresAtMs?: number;
}

interface HashEntry {
  fields: Map<string, string>;
  expiresAtMs?: number;
}

export class InMemoryStore implements RedisLike {
  private strings = new Map<string, StringEntry>();
  private hashes = new Map<string, HashEntry>();

  private isExpired(expiresAtMs?: number): boolean {
    return typeof expiresAtMs === "number" && Date.now() >= expiresAtMs;
  }

  private pruneKey(key: string): void {
    const s = this.strings.get(key);
    if (s && this.isExpired(s.expiresAtMs)) this.strings.delete(key);
    const h = this.hashes.get(key);
    if (h && this.isExpired(h.expiresAtMs)) this.hashes.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.pruneKey(key);
    return this.strings.get(key)?.value ?? null;
  }

  async set(key: string, value: string, options?: { EX?: number }): Promise<string | null> {
    const expiresAtMs =
      options?.EX && options.EX > 0 ? Date.now() + options.EX * 1000 : undefined;
    this.strings.set(key, { value, expiresAtMs });
    return "OK";
  }

  async expire(key: string, seconds: number): Promise<number | boolean> {
    this.pruneKey(key);
    const expiresAtMs = seconds > 0 ? Date.now() + seconds * 1000 : undefined;

    const s = this.strings.get(key);
    if (s) {
      s.expiresAtMs = expiresAtMs;
      return 1;
    }
    const h = this.hashes.get(key);
    if (h) {
      h.expiresAtMs = expiresAtMs;
      return 1;
    }
    return 0;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    this.pruneKey(key);
    const h = this.hashes.get(key);
    if (!h) return {};
    const out: Record<string, string> = {};
    for (const [field, value] of h.fields.entries()) out[field] = value;
    return out;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    this.pruneKey(key);
    return this.hashes.get(key)?.fields.get(field) ?? null;
  }

  async hSet(key: string, field: string, value: string): Promise<number> {
    this.pruneKey(key);
    let h = this.hashes.get(key);
    if (!h) {
      h = { fields: new Map<string, string>() };
      this.hashes.set(key, h);
    }
    const existed = h.fields.has(field);
    h.fields.set(field, value);
    return existed ? 0 : 1;
  }

  async hLen(key: string): Promise<number> {
    this.pruneKey(key);
    return this.hashes.get(key)?.fields.size ?? 0;
  }
}
