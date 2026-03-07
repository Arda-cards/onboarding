import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { OnboardingSessionStore } from "../lib/onboarding-session-store";
import type { Config } from "../config";
import type { KeyValueStore } from "../lib/gmail-oauth-store";

class FakeRedis {
  private strings = new Map<string, { value: string; expiresAtMs?: number }>();
  private hashes = new Map<
    string,
    { fields: Map<string, string>; expiresAtMs?: number }
  >();

  private isExpired(expiresAtMs?: number) {
    return typeof expiresAtMs === "number" && Date.now() >= expiresAtMs;
  }

  private pruneKey(key: string) {
    const s = this.strings.get(key);
    if (s && this.isExpired(s.expiresAtMs)) this.strings.delete(key);
    const h = this.hashes.get(key);
    if (h && this.isExpired(h.expiresAtMs)) this.hashes.delete(key);
  }

  async get(key: string): Promise<string | null> {
    this.pruneKey(key);
    return this.strings.get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<string | null> {
    const expiresAtMs =
      options?.EX && options.EX > 0 ? Date.now() + options.EX * 1000 : undefined;
    this.strings.set(key, { value, expiresAtMs });
    return "OK";
  }

  async del(key: string): Promise<number> {
    const hadString = this.strings.delete(key);
    const hadHash = this.hashes.delete(key);
    return Number(hadString || hadHash);
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
    const h = this.hashes.get(key);
    return h?.fields.get(field) ?? null;
  }

  async hSet(key: string, field: string, value: string): Promise<number> {
    this.pruneKey(key);
    const h = this.hashes.get(key) ?? { fields: new Map<string, string>() };
    const existed = h.fields.has(field);
    h.fields.set(field, value);
    this.hashes.set(key, h);
    return existed ? 0 : 1;
  }

  async hLen(key: string): Promise<number> {
    this.pruneKey(key);
    return this.hashes.get(key)?.fields.size ?? 0;
  }
}

class FakeKv implements KeyValueStore {
  private map = new Map<string, { value: string; expiresAtMs?: number }>();

  private isExpired(expiresAtMs?: number) {
    return typeof expiresAtMs === "number" && Date.now() >= expiresAtMs;
  }

  async get(key: string): Promise<string | null> {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (this.isExpired(hit.expiresAtMs)) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number },
  ): Promise<string | null> {
    const expiresAtMs =
      options?.EX && options.EX > 0 ? Date.now() + options.EX * 1000 : undefined;
    this.map.set(key, { value, expiresAtMs });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return Number(this.map.delete(key));
  }
}

function tokenFromMobileUrl(url: string): string {
  const parsed = new URL(url);
  const token = parsed.searchParams.get("token");
  if (!token) throw new Error("missing token");
  return token;
}

function makeConfig(): Config {
  return {
    cognitoUserPoolId: "us-east-1_TEST",
    cognitoClientId: "client",
    awsRegion: "us-east-1",
    redisUrl: "redis://localhost:6379/0",
    onboardingApiOrigin: "https://api.example.com",
    onboardingFrontendOrigin: "https://example.com",
    onboardingSessionTtlSeconds: 60,
    onboardingTokenEncryptionKey: null,
    googleClientId: null,
    googleClientSecret: null,
    geminiApiKey: null,
    onboardingImageUploadBucket: "bucket",
    onboardingImageUploadPrefix: "onboarding",
    onboardingImageUploadUrlExpiresInSeconds: 900,
    onboardingImageMaxBytes: 5242880,
    onboardingImagePublicBaseUrl: null,
    port: 3002,
    logLevel: "silent",
    nodeEnv: "test",
  };
}

describe("onboarding routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-25T12:00:00.000Z"));
  });

  it("supports mobile token flow for barcode session writes/reads", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const sessionRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.sessionId).toMatch(/^[a-f0-9]{32}$/);
    expect(sessionRes.body.mobileBarcodeUrl).toContain(`/onboarding/scan/${sessionRes.body.sessionId}?token=`);

    const token = tokenFromMobileUrl(sessionRes.body.mobileBarcodeUrl);
    const sessionId = sessionRes.body.sessionId as string;

    const addRes = await request(app)
      .post(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`)
      .send({
        barcode: {
          id: "b1",
          barcode: "123456789012",
          barcodeType: "UPC-A",
          scannedAt: new Date().toISOString(),
          source: "mobile",
        },
      });

    expect(addRes.status).toBe(200);
    expect(addRes.body).toMatchObject({
      success: true,
      barcode: { barcode: "123456789012" },
    });

    const listRes = await request(app)
      .get(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.totalCount).toBe(1);
    expect(listRes.body.barcodes).toHaveLength(1);
  });

  it("returns stable error shape for invalid mobile token", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const sessionRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const sessionId = sessionRes.body.sessionId as string;
    const res = await request(app)
      .get(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=bad-token`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: { code: "INVALID_SESSION_TOKEN", message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it("returns stable error shape for expired mobile token", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 1,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const sessionRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const token = tokenFromMobileUrl(sessionRes.body.mobileBarcodeUrl);
    const sessionId = sessionRes.body.sessionId as string;

    vi.advanceTimersByTime(2000);

    const res = await request(app)
      .get(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: { code: "SESSION_EXPIRED", message: expect.any(String), requestId: expect.any(String) },
    });
  });

  it("GET /sessions/:id returns session metadata for authenticated owner", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    // Create a session.
    const createRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    expect(createRes.status).toBe(200);
    const sessionId = createRes.body.sessionId as string;

    // Read back session metadata.
    const readRes = await request(app)
      .get(`/api/onboarding/sessions/${encodeURIComponent(sessionId)}`)
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id");

    expect(readRes.status).toBe(200);
    expect(readRes.body).toMatchObject({
      sessionId,
      tenantId: "t1",
      userId: "u1",
      createdAt: expect.any(String),
      lastActivity: expect.any(String),
      expiresAtMs: expect.any(Number),
    });
    // tokenHashHex must NOT be exposed.
    expect(readRes.body.tokenHashHex).toBeUndefined();
  });

  it("GET /sessions/:id still requires Cognito auth even if a mobile token is present", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const createRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const sessionId = createRes.body.sessionId as string;
    const token = tokenFromMobileUrl(createRes.body.mobileBarcodeUrl as string);

    const readRes = await request(app)
      .get(`/api/onboarding/sessions/${encodeURIComponent(sessionId)}?token=${encodeURIComponent(token)}`);

    expect(readRes.status).toBe(401);
    expect(readRes.body).toMatchObject({ error: { code: "AUTH_MISSING_TOKEN" } });
  });

  it("GET /sessions/:id returns 404 for a session owned by a different user", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    // Session is created by u1/t1 but token verifier will return u2/t2.
    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const createRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const sessionId = createRes.body.sessionId as string;

    // Switch to a different user for the read.
    idTokenVerifier.verify.mockResolvedValue({ sub: "u2", email: "u2@example.com", "custom:tenant": "t2" });

    const readRes = await request(app)
      .get(`/api/onboarding/sessions/${encodeURIComponent(sessionId)}`)
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id");

    expect(readRes.status).toBe(404);
    expect(readRes.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns RATE_LIMITED when a barcode session exceeds its per-session limit", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
      maxBarcodesPerSession: 1,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const createRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const sessionId = createRes.body.sessionId as string;
    const token = tokenFromMobileUrl(createRes.body.mobileBarcodeUrl as string);

    await request(app)
      .post(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`)
      .send({ barcode: { barcode: "111111111111" } })
      .expect(200);

    const limitedRes = await request(app)
      .post(`/api/onboarding/scan-sessions/${encodeURIComponent(sessionId)}/barcodes?token=${encodeURIComponent(token)}`)
      .send({ barcode: { barcode: "222222222222" } });

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers["retry-after"]).toBe("10");
    expect(limitedRes.body).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("returns 404 when a requested photo does not exist", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    const createRes = await request(app)
      .post("/api/onboarding/sessions")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({});

    const sessionId = createRes.body.sessionId as string;
    const token = tokenFromMobileUrl(createRes.body.mobilePhotoUrl as string);

    const res = await request(app)
      .get(`/api/onboarding/photo-sessions/${encodeURIComponent(sessionId)}/photos/missing?token=${encodeURIComponent(token)}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns stable error shape { error.code, error.message, error.requestId } for unauthenticated requests", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn() };
    const idTokenVerifier = { verify: vi.fn() };

    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: {} as any,
    });

    // Each of these endpoints requires Cognito auth; hitting without headers yields 401.
    const endpoints: Array<{ method: "get" | "post" | "patch"; path: string }> = [
      { method: "post", path: "/api/onboarding/sessions" },
      { method: "get",  path: "/api/onboarding/sessions/nonexistent" },
      { method: "post", path: "/api/onboarding/complete" },
      { method: "get",  path: "/api/onboarding/barcode/lookup?code=123" },
      { method: "post", path: "/api/onboarding/images/upload" },
    ];

    for (const { method, path } of endpoints) {
      const res = await (request(app)[method] as (url: string) => any)(path);
      expect(res.status, `${method.toUpperCase()} ${path} should be 401`).toBe(401);
      expect(
        res.body,
        `${method.toUpperCase()} ${path} must have stable error shape`,
      ).toMatchObject({
        error: {
          code: expect.stringMatching(/^[A-Z][A-Z0-9_]+$/),
          message: expect.any(String),
          requestId: expect.any(String),
        },
      });
      // details must not leak internal information when absent
      if (res.body.error.details !== undefined) {
        expect(typeof res.body.error.details === "object").toBe(true);
      }
    }
  });

  it("uploads images server-side with stable success response", async () => {
    const redis = new FakeRedis();
    const config = makeConfig();
    const store = new OnboardingSessionStore(redis as any, {
      ttlSeconds: 60,
      frontendOrigin: config.onboardingFrontendOrigin,
    });

    const accessTokenVerifier = { verify: vi.fn().mockResolvedValue({ sub: "u1", token_use: "access" }) };
    const idTokenVerifier = {
      verify: vi.fn().mockResolvedValue({ sub: "u1", email: "u1@example.com", "custom:tenant": "t1" }),
    };

    const s3 = { send: vi.fn().mockResolvedValue({}) };
    const app = createApp({
      auth: { accessTokenVerifier, idTokenVerifier, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      config,
      kv: new FakeKv(),
      sessionStore: store,
      s3: s3 as any,
    });

    const imageData = `data:image/png;base64,${Buffer.from("hello").toString("base64")}`;
    const res = await request(app)
      .post("/api/onboarding/images/upload")
      .set("Authorization", "Bearer test-access")
      .set("X-ID-Token", "test-id")
      .send({ imageData });

    expect(res.status).toBe(200);
    expect(res.body.imageUrl).toMatch(
      /^https:\/\/bucket\.s3\.amazonaws\.com\/onboarding\/t1\/u1\/[0-9a-f-]{36}\.png$/,
    );
    expect(s3.send).toHaveBeenCalledTimes(1);
  });
});
