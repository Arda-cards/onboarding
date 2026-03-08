import { Router, type Request, type Response } from "express";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "../lib/logger";
import type { Config } from "../config";
import { ApiError, type AuthContext } from "../types";
import type { CapturedPhoto, ScannedBarcode } from "../lib/onboarding-session-store";
import { OnboardingSessionStore } from "../lib/onboarding-session-store";
import { GmailOAuthStore, type KeyValueStore } from "../lib/gmail-oauth-store";
import { buildGmailAuthUrl, refreshAccessToken } from "../lib/google-oauth";
import { createImageUploadUrl, uploadImageDataUrl } from "../lib/image-upload";
import {
  lookupBarcode,
  type BarcodeLookupResolution,
  validateBarcodeLookupCode,
} from "../lib/barcode-lookup";
import { scrapeUrls } from "../lib/url-scraper";
import { analyzePhoto, resolvePhotoAnalysisImageUrl } from "../lib/photo-analysis";

const TOKEN_EXPIRED_MESSAGE =
  "Session expired. Please reopen the link from the desktop session.";
const TOKEN_INVALID_MESSAGE =
  "Invalid session token. Please reopen the link from the desktop session.";

function requireGmailConfig(config: Config): { clientId: string; clientSecret: string } {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new ApiError(503, "INTERNAL_ERROR", "Gmail OAuth is not configured");
  }
  return { clientId: config.googleClientId, clientSecret: config.googleClientSecret };
}

function isAccessTokenFresh(expiresAtMs: number | null): boolean {
  if (!expiresAtMs) return false;
  const skewMs = 60_000;
  return Date.now() + skewMs < expiresAtMs;
}

function tokenParam(req: { query: unknown }): string | null {
  const query = req.query as Record<string, unknown> | undefined;
  const value = query?.token;
  return typeof value === "string" && value.length > 0 ? value : null;
}

type MaybeAuthRequest = Request & { auth?: AuthContext; requestId?: string };

function requireAuth(req: MaybeAuthRequest): AuthContext {
  const auth = req.auth;
  if (!auth) {
    throw new ApiError(
      401,
      "AUTH_MISSING_TOKEN",
      "Authorization Bearer token and X-ID-Token headers are required",
    );
  }
  return auth;
}

async function requireSessionAccess(params: {
  req: MaybeAuthRequest;
  store: OnboardingSessionStore;
  sessionId: string;
}): Promise<{ createdAt: string }> {
  const token = tokenParam(params.req);
  if (token) {
    const result = await params.store.validateToken(params.sessionId, token);
    if (result === "expired") {
      throw new ApiError(401, "SESSION_EXPIRED", TOKEN_EXPIRED_MESSAGE);
    }
    if (result === "invalid") {
      throw new ApiError(403, "INVALID_SESSION_TOKEN", TOKEN_INVALID_MESSAGE);
    }
    const meta = await params.store.getMeta(params.sessionId);
    if (!meta) {
      throw new ApiError(401, "SESSION_EXPIRED", TOKEN_EXPIRED_MESSAGE);
    }
    return { createdAt: meta.createdAt };
  }

  const auth = requireAuth(params.req);
  const meta = await params.store.getMeta(params.sessionId);
  if (!meta) {
    throw new ApiError(404, "NOT_FOUND", "Session not found");
  }
  if (meta.userId !== auth.sub || meta.tenantId !== auth.tenantId) {
    throw new ApiError(404, "NOT_FOUND", "Session not found");
  }
  return { createdAt: meta.createdAt };
}

function barcodeLookupPayload(lookup: BarcodeLookupResolution) {
  return {
    enriched: lookup.enriched,
    resultState: lookup.resultState,
    normalizedBarcode: lookup.normalizedBarcode,
    product: lookup.product,
  };
}

function imageHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function runBarcodeLookup(params: {
  auth: AuthContext;
  code: string;
  kv: KeyValueStore;
  logger: Logger;
}): Promise<BarcodeLookupResolution> {
  const startedAtMs = Date.now();
  const lookup = await lookupBarcode(params.code, {
    kv: params.kv,
    timeoutMs: 5000,
  });

  params.logger.info(
    {
      tenantId: params.auth.tenantId,
      userId: params.auth.sub,
      normalizedBarcode: lookup.normalizedBarcode,
      resultState: lookup.resultState,
      cacheHit: lookup.cacheHit,
      provider: lookup.product?.source || null,
      retryAfterSeconds: lookup.retryAfterSeconds,
      attempts: lookup.attempts,
      durationMs: Date.now() - startedAtMs,
    },
    "Barcode lookup completed",
  );

  return lookup;
}

async function runUrlScrape(params: {
  auth: AuthContext;
  urls: string[];
  kv: KeyValueStore;
  logger: Logger;
  concurrency: number;
  timeoutMs: number;
}) {
  const startedAtMs = Date.now();
  const response = await scrapeUrls(params.urls, {
    kv: params.kv,
    concurrency: params.concurrency,
    timeoutMs: params.timeoutMs,
  });

  params.logger.info(
    {
      tenantId: params.auth.tenantId,
      userId: params.auth.sub,
      requested: response.requested,
      processed: response.processed,
      successCount: response.results.filter((result) => result.status === "success").length,
      partialCount: response.results.filter((result) => result.status === "partial").length,
      failedCount: response.results.filter((result) => result.status === "failed").length,
      results: response.results.map((result) => ({
        sourceUrl: result.sourceUrl,
        status: result.status,
        extractionSource: result.extractionSource,
      })),
      durationMs: Date.now() - startedAtMs,
    },
    "URL scrape completed",
  );

  return response;
}

export function createOnboardingRoutes(deps: {
  logger: Logger;
  sessionStore: OnboardingSessionStore;
  config: Config;
  gmailStore: GmailOAuthStore;
  s3: S3Client;
  kv: KeyValueStore;
}) {
  const router = Router();

  router.get("/health", (_req, res: Response) => {
    res.json({ status: "ok" });
  });

  router.post("/gmail/oauth/start", async (req, res) => {
    const auth = requireAuth(req as MaybeAuthRequest);

    const gmail = requireGmailConfig(deps.config);
    const { stateId } = await deps.gmailStore.createOauthState({
      tenantId: auth.tenantId,
      userId: auth.sub,
      returnTo: req.body?.returnTo,
    });

    const redirectUri = `${deps.config.onboardingApiOrigin}/api/onboarding/gmail/oauth/callback`;
    const authUrl = buildGmailAuthUrl({
      clientId: gmail.clientId,
      clientSecret: gmail.clientSecret,
      redirectUri,
      state: stateId,
    });

    res.json({ authUrl });
  });

  router.get("/gmail/status", async (req, res) => {
    const auth = requireAuth(req as MaybeAuthRequest);

    const configured = Boolean(
      deps.config.googleClientId
      && deps.config.googleClientSecret
      && deps.config.onboardingTokenEncryptionKey,
    );
    if (!configured) {
      res.json({ configured: false, connected: false });
      return;
    }

    const tokens = await deps.gmailStore.getTokens({
      tenantId: auth.tenantId,
      userId: auth.sub,
    });
    if (!tokens) {
      res.json({ configured: true, connected: false });
      return;
    }

    if (tokens.accessToken && isAccessTokenFresh(tokens.expiryDateMs)) {
      res.json({
        configured: true,
        connected: true,
        tokenExpiresAtMs: tokens.expiryDateMs,
      });
      return;
    }

    try {
      const gmail = requireGmailConfig(deps.config);
      const refreshed = await refreshAccessToken({
        refreshToken: tokens.refreshToken,
        clientId: gmail.clientId,
        clientSecret: gmail.clientSecret,
      });

      await deps.gmailStore.setTokens({
        tenantId: auth.tenantId,
        userId: auth.sub,
        refreshToken: tokens.refreshToken,
        accessToken: refreshed.accessToken,
        expiryDateMs: refreshed.expiryDateMs,
      });

      res.json({
        configured: true,
        connected: true,
        tokenExpiresAtMs: refreshed.expiryDateMs,
      });
    } catch {
      res.json({ configured: true, connected: false });
    }
  });

  router.post("/sessions", async (req, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);
    const { sub, tenantId } = auth;
    const created = await deps.sessionStore.createSession({
      tenantId,
      userId: sub,
    });
    deps.logger.info(
      { sessionId: created.sessionId, tenantId, userId: sub },
      "Onboarding session created",
    );
    res.json({
      sessionId: created.sessionId,
      mobileBarcodeUrl: created.mobileBarcodeUrl,
      mobilePhotoUrl: created.mobilePhotoUrl,
    });
  });

  router.get("/sessions/:sessionId", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    const auth = requireAuth(req as MaybeAuthRequest);
    const meta = await deps.sessionStore.getMeta(sessionId);
    if (!meta) {
      throw new ApiError(404, "NOT_FOUND", "Session not found");
    }
    if (meta.userId !== auth.sub || meta.tenantId !== auth.tenantId) {
      throw new ApiError(404, "NOT_FOUND", "Session not found");
    }
    deps.logger.info(
      { sessionId, tenantId: meta.tenantId, userId: meta.userId },
      "Onboarding session read",
    );
    res.json({
      sessionId: meta.sessionId,
      tenantId: meta.tenantId,
      userId: meta.userId,
      createdAt: meta.createdAt,
      lastActivity: meta.lastActivity,
      expiresAtMs: meta.expiresAtMs,
    });
  });

  router.post("/session/images/upload-url", async (req, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);

    const body = (req.body ?? null) as { fileName?: unknown; contentType?: unknown } | null;
    const fileName = typeof body?.fileName === "string" ? body?.fileName : "";
    const contentType = typeof body?.contentType === "string" ? body?.contentType : "";

    const result = await createImageUploadUrl({
      s3: deps.s3,
      bucket: deps.config.onboardingImageUploadBucket,
      prefix: deps.config.onboardingImageUploadPrefix,
      expiresInSeconds: deps.config.onboardingImageUploadUrlExpiresInSeconds,
      tenantId: auth.tenantId,
      userId: auth.sub,
      fileName,
      contentType,
    });

    res.json(result);
  });

  router.post("/images/upload", async (req, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);

    const body = (req.body ?? null) as { imageData?: unknown } | null;
    const imageData = typeof body?.imageData === "string" ? body.imageData : "";
    if (!imageData) {
      throw new ApiError(422, "VALIDATION_ERROR", "imageData is required");
    }

    const result = await uploadImageDataUrl({
      s3: deps.s3 as any,
      bucket: deps.config.onboardingImageUploadBucket,
      prefix: deps.config.onboardingImageUploadPrefix,
      maxBytes: deps.config.onboardingImageMaxBytes,
      region: deps.config.awsRegion,
      publicBaseUrl: deps.config.onboardingImagePublicBaseUrl,
      tenantId: auth.tenantId,
      userId: auth.sub,
      imageData,
    });

    deps.logger.info(
      {
        tenantId: auth.tenantId,
        userId: auth.sub,
        s3Key: result.s3Key,
        bytes: result.bytes,
        contentType: result.contentType,
      },
      "Image uploaded",
    );

    res.json({ imageUrl: result.imageUrl });
  });

  router.get("/barcode/lookup", async (req, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);
    const code = validateBarcodeLookupCode(req.query?.code, {
      fieldName: "code",
      statusCode: 400,
    });
    const lookup = await runBarcodeLookup({
      auth,
      code,
      kv: deps.kv,
      logger: deps.logger,
    });

    if (lookup.resultState === "rate_limited") {
      throw new ApiError(429, "RATE_LIMITED", "Barcode lookup rate limit exceeded");
    }
    if (lookup.resultState === "not_found") {
      throw new ApiError(404, "NOT_FOUND", "Barcode not found");
    }

    res.json(barcodeLookupPayload(lookup));
  });

  router.post("/barcode/lookup", async (req, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);

    const body = (req.body ?? null) as { barcode?: unknown } | null;
    const barcode = validateBarcodeLookupCode(body?.barcode, {
      fieldName: "barcode",
      statusCode: 400,
    });
    const lookup = await runBarcodeLookup({
      auth,
      code: barcode,
      kv: deps.kv,
      logger: deps.logger,
    });

    if (lookup.resultState === "rate_limited") {
      throw new ApiError(429, "RATE_LIMITED", "Barcode lookup rate limit exceeded");
    }

    res.json(barcodeLookupPayload(lookup));
  });

  const urlScrapeHandler = async (req: Request, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);

    const body = (req.body ?? null) as { urls?: unknown } | null;
    const urls = body?.urls;
    if (!Array.isArray(urls)) {
      throw new ApiError(422, "VALIDATION_ERROR", "urls must be an array of strings");
    }

    const response = await runUrlScrape({
      auth,
      urls: urls as string[],
      kv: deps.kv,
      logger: deps.logger,
      concurrency: deps.config.urlScrapeConcurrency,
      timeoutMs: deps.config.urlScrapeTimeoutMs,
    });

    res.json(response);
  };

  router.post("/url/scrape", urlScrapeHandler);
  router.post("/urls/scrape", urlScrapeHandler);

  const analyzePhotoHandler = async (req: Request, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);
    const startedAtMs = Date.now();
    const requestId = (req as MaybeAuthRequest).requestId ?? "unknown";
    let resolvedImageUrl: string | null = null;

    try {
      const body = (req.body ?? null) as { imageUrl?: unknown } | null;
      const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";

      resolvedImageUrl = resolvePhotoAnalysisImageUrl({
        imageUrl,
        bucket: deps.config.onboardingImageUploadBucket,
        region: deps.config.awsRegion,
        publicBaseUrl: deps.config.onboardingImagePublicBaseUrl,
        prefix: deps.config.onboardingImageUploadPrefix,
      });

      const analysis = await analyzePhoto({
        imageUrl: resolvedImageUrl,
        geminiApiKey: deps.config.geminiApiKey,
        maxImageBytes: deps.config.onboardingImageMaxBytes,
      });

      deps.logger.info(
        {
          requestId,
          tenantId: auth.tenantId,
          userId: auth.sub,
          imageHost: imageHost(resolvedImageUrl),
          analyzed: analysis.analyzed,
          reason: analysis.analyzed ? null : analysis.reason,
          durationMs: Date.now() - startedAtMs,
        },
        "Photo analysis completed",
      );

      res.json(analysis);
    } catch (err) {
      deps.logger.warn(
        {
          requestId,
          tenantId: auth.tenantId,
          userId: auth.sub,
          imageHost: imageHost(resolvedImageUrl),
          statusCode: err instanceof ApiError ? err.statusCode : 500,
          code: err instanceof ApiError ? err.code : "INTERNAL_ERROR",
          durationMs: Date.now() - startedAtMs,
        },
        "Photo analysis failed",
      );
      throw err;
    }
  };

  router.post("/photo/analyze", analyzePhotoHandler);
  router.post("/photos/analyze", analyzePhotoHandler);

  router.get("/scan-sessions/:sessionId/barcodes", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    const access = await requireSessionAccess({
      req: req as MaybeAuthRequest,
      store: deps.sessionStore,
      sessionId,
    });

    const barcodes = await deps.sessionStore.listBarcodes(sessionId);
    res.json({
      barcodes,
      sessionCreatedAt: access.createdAt,
      totalCount: barcodes.length,
    });
  });

  router.post("/scan-sessions/:sessionId/barcodes", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    await requireSessionAccess({
      req: req as MaybeAuthRequest,
      store: deps.sessionStore,
      sessionId,
    });

    const body = (req.body ?? null) as { barcode?: unknown } | null;
    const barcode = body?.barcode as ScannedBarcode | undefined;
    if (!barcode?.barcode || typeof barcode.barcode !== "string") {
      throw new ApiError(422, "VALIDATION_ERROR", "barcode is required");
    }

    const result = await deps.sessionStore.addBarcode(sessionId, barcode);
    deps.logger.info(
      { sessionId, barcode: result.barcode.barcode, duplicate: result.duplicate },
      "Barcode written to session",
    );
    res.json({
      success: true,
      duplicate: result.duplicate || undefined,
      barcode: result.barcode,
    });
  });

  router.put(
    "/scan-sessions/:sessionId/barcodes/:barcodeId",
    async (req, res: Response) => {
      const { sessionId, barcodeId } = req.params;
      await requireSessionAccess({
        req: req as MaybeAuthRequest,
        store: deps.sessionStore,
        sessionId,
      });

      const patch = (req.body ?? null) as Partial<ScannedBarcode> | null;
      const next = await deps.sessionStore.updateBarcode(sessionId, barcodeId, patch ?? {});
      res.json({ success: true, barcode: next });
    },
  );

  router.get("/photo-sessions/:sessionId/photos", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    const access = await requireSessionAccess({
      req: req as MaybeAuthRequest,
      store: deps.sessionStore,
      sessionId,
    });

    const photos = await deps.sessionStore.listPhotos(sessionId);
    res.json({
      photos,
      sessionCreatedAt: access.createdAt,
      totalCount: photos.length,
    });
  });

  router.post("/photo-sessions/:sessionId/photos", async (req, res: Response) => {
    const sessionId = req.params.sessionId;
    await requireSessionAccess({
      req: req as MaybeAuthRequest,
      store: deps.sessionStore,
      sessionId,
    });

    const body = (req.body ?? null) as { photo?: unknown } | null;
    const photo = body?.photo as CapturedPhoto | undefined;
    if (!photo?.imageData || typeof photo.imageData !== "string") {
      throw new ApiError(422, "VALIDATION_ERROR", "photo.imageData is required");
    }

    const saved = await deps.sessionStore.addPhoto(sessionId, photo);
    deps.logger.info(
      { sessionId, photoId: saved.id, source: saved.source },
      "Photo written to session",
    );
    res.json({ success: true, photo: saved });
  });

  router.get(
    "/photo-sessions/:sessionId/photos/:photoId",
    async (req, res: Response) => {
      const { sessionId, photoId } = req.params;
      await requireSessionAccess({
        req: req as MaybeAuthRequest,
        store: deps.sessionStore,
        sessionId,
      });

      const photo = await deps.sessionStore.getPhoto(sessionId, photoId);
      res.json({ photo });
    },
  );

  router.put(
    "/photo-sessions/:sessionId/photos/:photoId/metadata",
    async (req, res: Response) => {
      const { sessionId, photoId } = req.params;
      await requireSessionAccess({
        req: req as MaybeAuthRequest,
        store: deps.sessionStore,
        sessionId,
      });

      const patch = (req.body ?? null) as Partial<CapturedPhoto> | null;
      const next = await deps.sessionStore.updatePhotoMetadata(sessionId, photoId, patch ?? {});
      res.json({ success: true, photo: next });
    },
  );

  router.post("/complete", (req, res: Response) => {
    const auth = requireAuth(req as MaybeAuthRequest);
    deps.logger.info(
      { tenantId: auth.tenantId, userId: auth.sub },
      "Onboarding marked complete",
    );
    res.json({ ok: true });
  });

  return router;
}
