import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { ApiError } from "../types";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function extForContentType(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "onboarding";
}

function encodeS3KeyForUrl(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function publicUrlForObject(params: {
  bucket: string;
  region: string;
  s3Key: string;
  publicBaseUrl?: string | null;
}): string {
  const encodedKey = encodeS3KeyForUrl(params.s3Key);

  if (params.publicBaseUrl && params.publicBaseUrl.trim().length > 0) {
    const base = params.publicBaseUrl.replace(/\/+$/, "");
    return `${base}/${encodedKey}`;
  }

  // Note: This assumes the object is publicly readable (or served via CloudFront with a public base URL).
  if (params.region === "us-east-1") {
    return `https://${params.bucket}.s3.amazonaws.com/${encodedKey}`;
  }
  return `https://${params.bucket}.s3.${params.region}.amazonaws.com/${encodedKey}`;
}

function parseBase64DataUrl(imageData: string): {
  contentType: string;
  base64: string;
} {
  const trimmed = imageData.trim();
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(trimmed);
  if (!match) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData must be a base64 data URL");
  }
  const contentType = match[1] ?? "";
  const base64 = match[2] ?? "";
  return { contentType, base64 };
}

export interface CreateImageUploadUrlParams {
  s3: S3Client;
  bucket: string;
  prefix: string;
  expiresInSeconds: number;
  maxBytes: number;
  region: string;
  publicBaseUrl?: string | null;
  tenantId: string;
  sessionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface ImageUploadUrlResult {
  uploadUrl: string;
  objectKey: string;
  imageUrl: string;
  expiresInSeconds: number;
}

export interface CreateImageDownloadUrlParams {
  s3: S3Client;
  bucket: string;
  prefix: string;
  expiresInSeconds: number;
  tenantId: string;
  objectKey: string;
}

export interface ImageDownloadUrlResult {
  downloadUrl: string;
  objectKey: string;
  expiresInSeconds: number;
}

function validateContentType(contentType: string): string {
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "contentType must be one of: image/jpeg, image/png, image/webp",
    );
  }
  return contentType;
}

function validateBucket(bucket: string) {
  if (!bucket || bucket.trim().length === 0) {
    throw new ApiError(503, "INTERNAL_ERROR", "Image upload is temporarily unavailable. Please retry.");
  }
}

function validateSizeBytes(sizeBytes: number, maxBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "sizeBytes must be a positive integer");
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid ONBOARDING_IMAGE_MAX_BYTES");
  }
  if (sizeBytes > maxBytes) {
    throw new ApiError(413, "VALIDATION_ERROR", `File too large (max ${maxBytes} bytes)`);
  }
}

function validateSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new ApiError(400, "VALIDATION_ERROR", "sessionId is required");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new ApiError(400, "VALIDATION_ERROR", "sessionId is invalid");
  }
  return trimmed;
}

export async function createImageUploadUrl(
  params: CreateImageUploadUrlParams,
): Promise<ImageUploadUrlResult> {
  const fileName = params.fileName.trim();
  if (!fileName) {
    throw new ApiError(400, "VALIDATION_ERROR", "fileName is required");
  }
  if (fileName.length > 250) {
    throw new ApiError(400, "VALIDATION_ERROR", "fileName is too long");
  }

  const contentType = validateContentType(params.contentType);
  validateBucket(params.bucket);
  validateSizeBytes(params.sizeBytes, params.maxBytes);
  const sessionId = validateSessionId(params.sessionId);

  const expiresInSeconds = Math.max(1, Math.min(params.expiresInSeconds, 3600));
  const prefix = normalizePrefix(params.prefix);
  const ext = extForContentType(contentType);

  const objectKey = `${prefix}/${params.tenantId}/${sessionId}/${randomUUID()}.${ext}`;

  const cmd = new PutObjectCommand({
    Bucket: params.bucket,
    Key: objectKey,
    ContentType: contentType,
    Metadata: {
      tenant: params.tenantId,
      session: sessionId,
      filename: fileName.slice(0, 200),
    },
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(params.s3 as any, cmd, {
      expiresIn: expiresInSeconds,
    });
  } catch {
    throw new ApiError(503, "INTERNAL_ERROR", "Image upload is temporarily unavailable. Please retry.");
  }

  const imageUrl = publicUrlForObject({
    bucket: params.bucket,
    region: params.region,
    s3Key: objectKey,
    publicBaseUrl: params.publicBaseUrl,
  });

  return { uploadUrl, objectKey, imageUrl, expiresInSeconds };
}

export function validateObjectKeyForTenant(params: {
  objectKey: string;
  tenantId: string;
  prefix: string;
}): string {
  const objectKey = decodeURIComponent(params.objectKey).replace(/^\/+/, "");
  const prefix = normalizePrefix(params.prefix);
  const expectedPrefix = `${prefix}/${params.tenantId}/`;
  if (!objectKey.startsWith(expectedPrefix)) {
    throw new ApiError(404, "NOT_FOUND", "Upload not found");
  }
  return objectKey;
}

export async function createImageDownloadUrl(
  params: CreateImageDownloadUrlParams,
): Promise<ImageDownloadUrlResult> {
  validateBucket(params.bucket);
  const objectKey = validateObjectKeyForTenant({
    objectKey: params.objectKey,
    tenantId: params.tenantId,
    prefix: params.prefix,
  });
  const expiresInSeconds = Math.max(1, Math.min(params.expiresInSeconds, 3600));

  const cmd = new GetObjectCommand({
    Bucket: params.bucket,
    Key: objectKey,
  });

  let downloadUrl: string;
  try {
    downloadUrl = await getSignedUrl(params.s3 as any, cmd, {
      expiresIn: expiresInSeconds,
    });
  } catch {
    throw new ApiError(503, "INTERNAL_ERROR", "Image upload is temporarily unavailable. Please retry.");
  }

  return { downloadUrl, objectKey, expiresInSeconds };
}

export interface S3Like {
  send: (command: PutObjectCommand) => Promise<unknown>;
}

export interface UploadImageDataUrlParams {
  s3: S3Like;
  bucket: string;
  prefix: string;
  maxBytes: number;
  region: string;
  publicBaseUrl?: string | null;
  tenantId: string;
  userId: string;
  imageData: string;
}

export interface UploadImageDataUrlResult {
  imageUrl: string;
  s3Key: string;
  contentType: string;
  bytes: number;
}

export async function uploadImageDataUrl(
  params: UploadImageDataUrlParams,
): Promise<UploadImageDataUrlResult> {
  if (!params.bucket || params.bucket.trim().length === 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Image upload bucket is not configured");
  }

  const maxBytes = params.maxBytes;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid ONBOARDING_IMAGE_MAX_BYTES");
  }

  const { contentType, base64 } = parseBase64DataUrl(params.imageData);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "imageData contentType must be one of: image/jpeg, image/png, image/webp",
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData base64 is invalid");
  }

  if (bytes.length === 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "imageData is empty");
  }
  if (bytes.length > maxBytes) {
    throw new ApiError(413, "VALIDATION_ERROR", `Image too large (max ${maxBytes} bytes)`);
  }

  const prefix = normalizePrefix(params.prefix);
  const ext = extForContentType(contentType);
  const s3Key = `${prefix}/${params.tenantId}/${params.userId}/${randomUUID()}.${ext}`;

  const cmd = new PutObjectCommand({
    Bucket: params.bucket,
    Key: s3Key,
    Body: bytes,
    ContentType: contentType,
    Metadata: {
      tenant: params.tenantId,
      user: params.userId,
    },
  });

  try {
    await params.s3.send(cmd);
  } catch {
    throw new ApiError(502, "INTERNAL_ERROR", "Image upload failed. Please try again.");
  }

  const imageUrl = publicUrlForObject({
    bucket: params.bucket,
    region: params.region,
    s3Key,
    publicBaseUrl: params.publicBaseUrl,
  });

  return { imageUrl, s3Key, contentType, bytes: bytes.length };
}
