import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lookupBarcode, lookupProductByBarcode } from "../lib/barcode-lookup";
import type { KeyValueStore } from "../lib/gmail-oauth-store";

const TEST_BARCODE = "4006381333931";

class MemoryKv implements KeyValueStore {
  private store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _options?: { EX?: number }) {
    this.store.set(key, value);
    return "OK";
  }

  async del(key: string) {
    const existed = this.store.delete(key);
    return existed ? 1 : 0;
  }

  keys() {
    return [...this.store.keys()];
  }
}

function mockFetchOnce(params: {
  ok: boolean;
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}) {
  const headers = new Map(
    Object.entries(params.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

  (globalThis.fetch as any).mockResolvedValueOnce({
    ok: params.ok,
    status: params.status,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    json: vi.fn().mockResolvedValue(params.json),
  });
}

describe("barcode lookup", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.BARCODE_LOOKUP_API_KEY;
    delete process.env.UPCITEMDB_USER_KEY;
    delete process.env.UPCITEMDB_KEY_TYPE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("caches found products and reports cache hits on repeat lookups", async () => {
    const kv = new MemoryKv();
    process.env.BARCODE_LOOKUP_API_KEY = "test-key";

    mockFetchOnce({
      ok: true,
      status: 200,
      json: {
        products: [
          {
            title: "Test Product",
            brand: "BrandCo",
            category: "Snacks",
            images: ["https://example.com/a.jpg"],
          },
        ],
      },
    });

    const first = await lookupBarcode(TEST_BARCODE, { kv, timeoutMs: 5000 });
    expect(first).toMatchObject({
      resultState: "found",
      enriched: true,
      cacheHit: false,
      normalizedBarcode: TEST_BARCODE,
      product: {
        name: "Test Product",
        source: "barcodelookup",
      },
    });
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);

    (globalThis.fetch as any).mockClear();
    const second = await lookupBarcode(TEST_BARCODE, { kv, timeoutMs: 5000 });
    expect(second).toMatchObject({
      resultState: "found",
      enriched: true,
      cacheHit: true,
      normalizedBarcode: TEST_BARCODE,
      product: {
        name: "Test Product",
      },
    });
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });

  it("falls back from BarcodeLookup to UPCitemdb", async () => {
    process.env.BARCODE_LOOKUP_API_KEY = "test-key";

    mockFetchOnce({ ok: false, status: 404, json: {} });
    mockFetchOnce({
      ok: true,
      status: 200,
      json: {
        items: [
          {
            title: "Fallback Product",
            brand: "UPC Co",
            images: ["https://example.com/upc.jpg"],
            category: "Beverages",
          },
        ],
      },
    });

    const result = await lookupBarcode(TEST_BARCODE, { timeoutMs: 5000 });
    expect(result).toMatchObject({
      resultState: "found",
      enriched: true,
      normalizedBarcode: TEST_BARCODE,
      product: {
        name: "Fallback Product",
        source: "upcitemdb",
      },
    });
    expect(result.attempts).toEqual([
      { provider: "barcodelookup", status: "not_found" },
      { provider: "upcitemdb", status: "found" },
    ]);
  });

  it("returns provider_unavailable when providers error and avoids caching notFound", async () => {
    const kv = new MemoryKv();
    process.env.BARCODE_LOOKUP_API_KEY = "test-key";

    mockFetchOnce({ ok: false, status: 500, json: {} });
    mockFetchOnce({ ok: false, status: 503, json: {} });

    const result = await lookupBarcode(TEST_BARCODE, { kv, timeoutMs: 5000 });
    expect(result).toMatchObject({
      resultState: "provider_unavailable",
      enriched: false,
      normalizedBarcode: TEST_BARCODE,
      product: null,
      cacheHit: false,
    });
    expect(result.attempts).toEqual([
      { provider: "barcodelookup", status: "error" },
      { provider: "upcitemdb", status: "error" },
    ]);
    expect(kv.keys().filter((key) => key.startsWith("barcode:lookup:"))).toHaveLength(0);
    await expect(lookupProductByBarcode(TEST_BARCODE, { kv, timeoutMs: 5000 })).resolves.toBeNull();
  });

  it("returns rate_limited and preserves retry-after metadata", async () => {
    process.env.BARCODE_LOOKUP_API_KEY = "test-key";

    mockFetchOnce({
      ok: false,
      status: 429,
      json: {},
      headers: { "retry-after": "30" },
    });
    mockFetchOnce({
      ok: false,
      status: 429,
      json: {},
      headers: { "retry-after": "15" },
    });

    const result = await lookupBarcode(TEST_BARCODE, { timeoutMs: 5000 });
    expect(result).toMatchObject({
      resultState: "rate_limited",
      enriched: false,
      normalizedBarcode: TEST_BARCODE,
      product: null,
      retryAfterSeconds: 15,
    });
    expect(result.attempts).toEqual([
      { provider: "barcodelookup", status: "rate_limited", retryAfterSeconds: 30 },
      { provider: "upcitemdb", status: "rate_limited", retryAfterSeconds: 15 },
    ]);
  });

  it("caches clean notFound results to avoid repeated provider calls", async () => {
    const kv = new MemoryKv();
    process.env.BARCODE_LOOKUP_API_KEY = "test-key";

    mockFetchOnce({ ok: false, status: 404, json: {} });
    mockFetchOnce({ ok: false, status: 404, json: {} });

    const first = await lookupBarcode(TEST_BARCODE, { kv, timeoutMs: 5000 });
    expect(first).toMatchObject({
      resultState: "not_found",
      enriched: false,
      normalizedBarcode: TEST_BARCODE,
      product: null,
      cacheHit: false,
    });

    (globalThis.fetch as any).mockClear();
    const second = await lookupBarcode(TEST_BARCODE, { kv, timeoutMs: 5000 });
    expect(second).toMatchObject({
      resultState: "not_found",
      enriched: false,
      normalizedBarcode: TEST_BARCODE,
      product: null,
      cacheHit: true,
    });
    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
  });
});
