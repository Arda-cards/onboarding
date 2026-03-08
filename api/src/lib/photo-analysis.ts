import { publicUrlForObject } from "./image-upload";
import { ApiError } from "../types";

type SupportedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type PhotoAnalysisUnavailableReason = "gemini_unavailable";

export type PhotoAnalysisResult =
  | {
    analyzed: true;
    productName: string | null;
    description: string | null;
    estimatedCategory: string | null;
    brand: string | null;
    confidence: number;
  }
  | {
    analyzed: false;
    reason: PhotoAnalysisUnavailableReason;
    productName: null;
    description: null;
    estimatedCategory: null;
    brand: null;
    confidence: 0;
  };

type GeminiGenerateTextFn = (params: {
  prompt: string;
  base64Data: string;
  mimeType: SupportedImageMimeType;
}) => Promise<string>;

const DEFAULT_MODEL = "gemini-1.5-flash";
const SUPPORTED_IMAGE_MIME_TYPES = new Set<SupportedImageMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

let lastGeminiCallAtMs = 0;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sanitizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

function normalizeImageMimeType(value: string | null): SupportedImageMimeType | null {
  if (!value) return null;
  const mimeType = value.split(";")[0]?.trim().toLowerCase() ?? "";
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType as SupportedImageMimeType)
    ? (mimeType as SupportedImageMimeType)
    : null;
}

function normalizePrefix(prefix: string): string {
  return prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function defaultS3BaseUrls(params: { bucket: string; region: string }): string[] {
  return [
    `https://${params.bucket}.s3.amazonaws.com`,
    `https://${params.bucket}.s3.${params.region}.amazonaws.com`,
  ];
}

function encodedPathPrefix(prefix: string): string {
  const normalized = normalizePrefix(prefix);
  if (!normalized) return "";
  return normalized.split("/").map(encodeURIComponent).join("/");
}

function unavailablePhotoAnalysis(): PhotoAnalysisResult {
  return {
    analyzed: false,
    reason: "gemini_unavailable",
    productName: null,
    description: null,
    estimatedCategory: null,
    brand: null,
    confidence: 0,
  };
}

export function resolvePhotoAnalysisImageUrl(params: {
  imageUrl: string;
  bucket: string;
  region: string;
  publicBaseUrl?: string | null;
  prefix: string;
}): string {
  const rawImageUrl = params.imageUrl.trim();
  if (!rawImageUrl) {
    throw new ApiError(400, "VALIDATION_ERROR", "imageUrl is required");
  }

  const normalizedPrefix = normalizePrefix(params.prefix);
  const allowedUrlPrefix = encodedPathPrefix(normalizedPrefix);

  try {
    const parsed = new URL(rawImageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "imageUrl must be an http(s) onboarding image URL or storage key",
      );
    }

    const publicBaseUrl = params.publicBaseUrl?.trim().replace(/\/+$/, "") ?? null;
    const matchesPublicBaseUrl =
      publicBaseUrl !== null && parsed.toString().startsWith(`${publicBaseUrl}/`);
    const matchesS3BaseUrl = defaultS3BaseUrls(params).some((baseUrl) => {
      if (!parsed.toString().startsWith(`${baseUrl}/`)) return false;
      if (!allowedUrlPrefix) return true;
      return parsed.pathname === `/${allowedUrlPrefix}`
        || parsed.pathname.startsWith(`/${allowedUrlPrefix}/`);
    });

    if (!matchesPublicBaseUrl && !matchesS3BaseUrl) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "imageUrl must reference an onboarding image URL or storage key",
      );
    }

    return parsed.toString();
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  const s3Key = rawImageUrl.replace(/^\/+/, "");
  if (normalizedPrefix && s3Key !== normalizedPrefix && !s3Key.startsWith(`${normalizedPrefix}/`)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "imageUrl must reference an onboarding image URL or storage key",
    );
  }

  return publicUrlForObject({
    bucket: params.bucket,
    region: params.region,
    s3Key,
    publicBaseUrl: params.publicBaseUrl,
  });
}

export function extractFirstJsonObject(text: string): unknown {
  const candidate = text.trim();
  if (!candidate) return null;

  const fenced = /```json\s*([\s\S]*?)```/i.exec(candidate);
  const source = fenced?.[1]?.trim() ?? candidate;

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonText = source.slice(start, end + 1);
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function promptForPhotoAnalysis(): string {
  return [
    "You are helping a business user capture a supplier item from a photo.",
    "Return ONLY a single JSON object with this exact schema:",
    "{",
    '  "productName": string | null,',
    '  "description": string | null,',
    '  "estimatedCategory": string | null,',
    '  "brand": string | null,',
    '  "confidence": number',
    "}",
    "",
    "Rules:",
    "- If you are unsure, use null for strings and set confidence low.",
    "- confidence must be between 0 and 1.",
    "- Do not include extra keys.",
  ].join("\n");
}

async function defaultGeminiGenerateText(params: {
  apiKey: string;
  model?: string;
  prompt: string;
  base64Data: string;
  mimeType: SupportedImageMimeType;
}): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

  const genAi = new GoogleGenerativeAI(params.apiKey);
  const model = genAi.getGenerativeModel({ model: params.model ?? DEFAULT_MODEL });

  const result = await model.generateContent([
    params.prompt,
    {
      inlineData: {
        data: params.base64Data,
        mimeType: params.mimeType,
      },
    },
  ]);

  return result.response.text();
}

async function fetchPhotoAnalysisImage(params: {
  imageUrl: string;
  maxImageBytes: number;
  fetchFn?: typeof fetch;
}): Promise<{ mimeType: SupportedImageMimeType; base64Data: string }> {
  if (!Number.isFinite(params.maxImageBytes) || params.maxImageBytes <= 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid ONBOARDING_IMAGE_MAX_BYTES");
  }

  const fetchFn = params.fetchFn ?? fetch;

  let response: Response;
  try {
    response = await fetchFn(params.imageUrl);
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "imageUrl could not be fetched");
  }

  if (!response.ok) {
    throw new ApiError(400, "VALIDATION_ERROR", "imageUrl could not be fetched");
  }

  const mimeType = normalizeImageMimeType(response.headers.get("content-type"));
  if (!mimeType) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "imageUrl contentType must be one of: image/jpeg, image/png, image/webp",
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > params.maxImageBytes) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `imageUrl is too large (max ${params.maxImageBytes} bytes)`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "imageUrl could not be read");
  }

  if (bytes.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "imageUrl is empty");
  }
  if (bytes.length > params.maxImageBytes) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `imageUrl is too large (max ${params.maxImageBytes} bytes)`,
    );
  }

  return {
    mimeType,
    base64Data: bytes.toString("base64"),
  };
}

function isGeminiRateLimitedError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.statusCode === 429 || err.code === "RATE_LIMITED";
  }
  if (!err || typeof err !== "object") return false;

  const record = err as Record<string, unknown>;
  if (Number(record.status) === 429 || Number(record.statusCode) === 429) {
    return true;
  }

  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  if (code.includes("rate") || code.includes("resource_exhausted")) {
    return true;
  }

  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return message.includes("429")
    || message.includes("rate limit")
    || message.includes("resource exhausted")
    || message.includes("quota");
}

export async function analyzePhoto(params: {
  imageUrl: string;
  geminiApiKey: string | null;
  maxImageBytes: number;
  model?: string;
  minIntervalMs?: number;
  now?: () => number;
  fetchFn?: typeof fetch;
  generateTextFn?: GeminiGenerateTextFn;
}): Promise<PhotoAnalysisResult> {
  if (!params.geminiApiKey && !params.generateTextFn) {
    return unavailablePhotoAnalysis();
  }

  const now = params.now ?? (() => Date.now());
  const minIntervalMs = params.minIntervalMs ?? 750;
  if (minIntervalMs > 0) {
    const elapsed = now() - lastGeminiCallAtMs;
    if (elapsed >= 0 && elapsed < minIntervalMs) {
      throw new ApiError(429, "RATE_LIMITED", "Photo analysis rate limit exceeded");
    }
  }

  const { mimeType, base64Data } = await fetchPhotoAnalysisImage({
    imageUrl: params.imageUrl,
    maxImageBytes: params.maxImageBytes,
    fetchFn: params.fetchFn,
  });

  const prompt = promptForPhotoAnalysis();
  const generateText =
    params.generateTextFn
    ?? ((p: { prompt: string; base64Data: string; mimeType: SupportedImageMimeType }) => {
      if (!params.geminiApiKey) {
        throw new ApiError(503, "INTERNAL_ERROR", "Photo analysis is not configured");
      }
      return defaultGeminiGenerateText({
        apiKey: params.geminiApiKey,
        model: params.model,
        ...p,
      });
    });

  lastGeminiCallAtMs = now();

  let text: string;
  try {
    text = await generateText({ prompt, base64Data, mimeType });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (isGeminiRateLimitedError(err)) {
      throw new ApiError(429, "RATE_LIMITED", "Photo analysis is temporarily rate limited");
    }
    throw new ApiError(502, "INTERNAL_ERROR", "Gemini request failed");
  }

  const json = extractFirstJsonObject(text);
  const obj = (json && typeof json === "object") ? (json as Record<string, unknown>) : {};

  const productName = sanitizeText(obj.productName, 140);
  const description = sanitizeText(obj.description, 500);
  const estimatedCategory = sanitizeText(obj.estimatedCategory, 120);
  const brand = sanitizeText(obj.brand, 120);
  const confidence = clamp01(
    typeof obj.confidence === "number"
      ? obj.confidence
      : typeof obj.confidence === "string"
        ? Number(obj.confidence)
        : 0,
  );

  return {
    analyzed: true,
    productName,
    description,
    estimatedCategory,
    brand,
    confidence,
  };
}
