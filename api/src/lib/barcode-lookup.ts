import { ApiError } from "../types";
import type { KeyValueStore } from "./gmail-oauth-store";

const CACHE_FOUND_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const CACHE_NOT_FOUND_TTL_SECONDS = 60 * 60; // 1 hour

export type BarcodeLookupSource = "barcodelookup" | "upcitemdb";
export type BarcodeLookupResultState =
  | "found"
  | "not_found"
  | "provider_unavailable"
  | "rate_limited";

export interface BarcodeProductInfo {
  name: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  source?: BarcodeLookupSource;
  normalizedBarcode?: string;
}

export interface BarcodeLookupAttempt {
  provider: BarcodeLookupSource;
  status: "found" | "not_found" | "skipped" | "rate_limited" | "error";
  retryAfterSeconds?: number;
}

export interface BarcodeLookupResolution {
  resultState: BarcodeLookupResultState;
  enriched: boolean;
  normalizedBarcode: string | null;
  product: BarcodeProductInfo | null;
  cacheHit: boolean;
  attempts: BarcodeLookupAttempt[];
  retryAfterSeconds?: number;
}

type CachePayload = BarcodeProductInfo | { notFound: true };

export interface BarcodeLookupOptions {
  timeoutMs?: number;
  kv?: KeyValueStore | null;
}

function deadlineFromNow(timeoutMs: number): number {
  const safe = Number.isFinite(timeoutMs) ? Math.max(0, Number(timeoutMs)) : 0;
  return Date.now() + safe;
}

function msUntil(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now());
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Timeout");
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseRetryAfterSeconds(value: string | null | undefined): number | undefined {
  if (!value) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }

  const atMs = Date.parse(value);
  if (!Number.isFinite(atMs)) return undefined;

  return Math.max(0, Math.ceil((atMs - Date.now()) / 1000));
}

function lowerRetryAfter(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined) return current;
  if (current === undefined) return next;
  return Math.min(current, next);
}

function isAllDigits(s: string): boolean {
  return /^[0-9]+$/.test(s);
}

function computeGtinCheckDigit(dataWithoutCheckDigit: string): number {
  // GS1 Mod10 algorithm used by GTIN-8/12/13/14.
  let sum = 0;
  let weight = 3;
  for (let i = dataWithoutCheckDigit.length - 1; i >= 0; i--) {
    const digit = Number(dataWithoutCheckDigit[i]);
    sum += digit * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidGtin(gtin: string): boolean {
  if (!isAllDigits(gtin)) return false;
  if (![8, 12, 13, 14].includes(gtin.length)) return false;
  const expected = computeGtinCheckDigit(gtin.slice(0, -1));
  return expected === Number(gtin[gtin.length - 1]);
}

function expandUpcEToUpcA(upcE: string): string | null {
  // UPC-E is 8 digits: number system (0/1), 6-digit UPC-E payload, check digit.
  if (!isAllDigits(upcE) || upcE.length !== 8) return null;
  const numberSystem = upcE[0];
  if (numberSystem !== "0" && numberSystem !== "1") return null;

  const x1 = upcE[1];
  const x2 = upcE[2];
  const x3 = upcE[3];
  const x4 = upcE[4];
  const x5 = upcE[5];
  const x6 = upcE[6];
  const check = upcE[7];

  let upcA = "";
  if (x6 === "0" || x6 === "1" || x6 === "2") {
    upcA = `${numberSystem}${x1}${x2}${x6}0000${x3}${x4}${x5}${check}`;
  } else if (x6 === "3") {
    upcA = `${numberSystem}${x1}${x2}${x3}00000${x4}${x5}${check}`;
  } else if (x6 === "4") {
    upcA = `${numberSystem}${x1}${x2}${x3}${x4}00000${x5}${check}`;
  } else {
    upcA = `${numberSystem}${x1}${x2}${x3}${x4}${x5}0000${x6}${check}`;
  }

  return upcA.length === 12 ? upcA : null;
}

function normalizeBarcodeForLookup(raw: string): string {
  const trimmed = raw.trim();
  // Some scanners can prefix an AIM symbology identifier like "]C1"
  if (trimmed.startsWith("]") && trimmed.length > 3) {
    return trimmed.slice(3).trim();
  }
  return trimmed;
}

function uniqueKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function getGtinCandidates(rawBarcode: string): string[] {
  const normalized = normalizeBarcodeForLookup(rawBarcode);
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return [];

  const candidates: string[] = [];

  if ([8, 12, 13, 14].includes(digits.length)) {
    candidates.push(digits);
  }

  if (digits.length === 13 && digits.startsWith("0")) {
    candidates.unshift(digits.slice(1)); // Prefer UPC-A form
  } else if (digits.length === 12) {
    candidates.push(`0${digits}`);
  }

  if (digits.length === 14 && digits.startsWith("0")) {
    const gtin13 = digits.slice(1);
    candidates.push(gtin13);
    if (gtin13.startsWith("0")) {
      candidates.push(gtin13.slice(1));
    }
  }

  if (digits.length === 8) {
    const upcA = expandUpcEToUpcA(digits);
    if (upcA) {
      candidates.push(upcA);
      candidates.push(`0${upcA}`);
    }
  }

  const uniq = uniqueKeepOrder(candidates);
  // Prefer valid check digits first.
  return uniq.sort((a, b) => Number(isValidGtin(b)) - Number(isValidGtin(a)));
}

async function getCached(
  kv: KeyValueStore | null | undefined,
  code: string,
  maxWaitMs?: number,
): Promise<CachePayload | null> {
  if (!kv) return null;
  if (Number.isFinite(maxWaitMs) && Number(maxWaitMs) <= 0) return null;
  try {
    const getPromise = kv.get(`barcode:lookup:${code}`);
    const cached = Number.isFinite(maxWaitMs)
      ? await promiseWithTimeout(getPromise, Number(maxWaitMs))
      : await getPromise;
    if (!cached) return null;
    return JSON.parse(cached) as CachePayload;
  } catch {
    return null;
  }
}

async function setCached(
  kv: KeyValueStore | null | undefined,
  code: string,
  payload: CachePayload,
  ttlSeconds: number,
  maxWaitMs?: number,
): Promise<void> {
  if (!kv) return;
  if (Number.isFinite(maxWaitMs) && Number(maxWaitMs) <= 0) return;
  try {
    const setPromise = kv.set(
      `barcode:lookup:${code}`,
      JSON.stringify(payload),
      { EX: ttlSeconds },
    );
    if (Number.isFinite(maxWaitMs)) {
      await promiseWithTimeout(setPromise, Number(maxWaitMs));
    } else {
      await setPromise;
    }
  } catch {
    // Ignore cache failures
  }
}

type LookupResult =
  | { provider: BarcodeLookupSource; status: "found"; product: BarcodeProductInfo }
  | { provider: BarcodeLookupSource; status: "not_found" }
  | { provider: BarcodeLookupSource; status: "skipped" }
  | { provider: BarcodeLookupSource; status: "rate_limited"; retryAfterSeconds?: number }
  | { provider: BarcodeLookupSource; status: "error" };

function responseRetryAfterSeconds(response: Response): number | undefined {
  return parseRetryAfterSeconds(response.headers?.get("retry-after"));
}

function foundProduct(product: BarcodeProductInfo, code: string): BarcodeProductInfo {
  return {
    ...product,
    normalizedBarcode: product.normalizedBarcode || code,
  };
}

async function lookupFromBarcodeLookup(code: string, timeoutMs: number): Promise<LookupResult> {
  const apiKey = process.env.BARCODE_LOOKUP_API_KEY;
  if (!apiKey) {
    return { provider: "barcodelookup", status: "skipped" };
  }

  const url = `https://api.barcodelookup.com/v3/products?barcode=${encodeURIComponent(code)}&key=${encodeURIComponent(apiKey)}`;
  try {
    const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, timeoutMs);
    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        return { provider: "barcodelookup", status: "not_found" };
      }
      if (response.status === 429) {
        return {
          provider: "barcodelookup",
          status: "rate_limited",
          retryAfterSeconds: responseRetryAfterSeconds(response),
        };
      }
      return { provider: "barcodelookup", status: "error" };
    }

    const data = await response.json() as {
      products?: Array<{ title?: string; brand?: string; category?: string; images?: string[] }>;
    };
    const first = data.products?.[0];
    const name = first?.title?.trim();
    if (!name) {
      return { provider: "barcodelookup", status: "not_found" };
    }

    return {
      provider: "barcodelookup",
      status: "found",
      product: {
        name,
        brand: first?.brand?.trim() || undefined,
        category: first?.category?.trim() || undefined,
        imageUrl: first?.images?.[0],
        source: "barcodelookup",
        normalizedBarcode: code,
      },
    };
  } catch {
    return { provider: "barcodelookup", status: "error" };
  }
}

async function lookupFromUpcItemDb(code: string, timeoutMs: number): Promise<LookupResult> {
  const userKey = process.env.UPCITEMDB_USER_KEY;
  const keyType = process.env.UPCITEMDB_KEY_TYPE || "3scale";
  const path = userKey ? "v1" : "trial";

  const url = `https://api.upcitemdb.com/prod/${path}/lookup?upc=${encodeURIComponent(code)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (userKey) {
    headers.user_key = userKey;
    headers.key_type = keyType;
  }

  try {
    const response = await fetchWithTimeout(url, { headers }, timeoutMs);
    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        return { provider: "upcitemdb", status: "not_found" };
      }
      if (response.status === 429) {
        return {
          provider: "upcitemdb",
          status: "rate_limited",
          retryAfterSeconds: responseRetryAfterSeconds(response),
        };
      }
      return { provider: "upcitemdb", status: "error" };
    }

    const data = await response.json() as {
      items?: Array<{ title?: string; brand?: string; images?: string[]; category?: string }>;
    };
    const item = data.items?.[0];
    const name = item?.title?.trim();
    if (!name) {
      return { provider: "upcitemdb", status: "not_found" };
    }

    return {
      provider: "upcitemdb",
      status: "found",
      product: {
        name,
        brand: item?.brand?.trim() || undefined,
        imageUrl: item?.images?.[0],
        category: item?.category?.trim() || undefined,
        source: "upcitemdb",
        normalizedBarcode: code,
      },
    };
  } catch {
    return { provider: "upcitemdb", status: "error" };
  }
}

function resolutionForNotFound(
  normalizedBarcode: string | null,
  cacheHit: boolean,
  attempts: BarcodeLookupAttempt[],
): BarcodeLookupResolution {
  return {
    resultState: "not_found",
    enriched: false,
    normalizedBarcode,
    product: null,
    cacheHit,
    attempts,
  };
}

export async function lookupBarcode(
  rawBarcode: string,
  options: BarcodeLookupOptions = {},
): Promise<BarcodeLookupResolution> {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 5000;
  const deadlineMs = deadlineFromNow(timeoutMs);
  const candidates = getGtinCandidates(rawBarcode);
  if (candidates.length === 0) {
    return resolutionForNotFound(null, false, []);
  }

  const kv = options.kv ?? null;
  let cachedNotFoundCount = 0;
  let cachedNotFoundCode: string | null = null;

  for (const code of candidates) {
    const remainingMs = msUntil(deadlineMs);
    if (remainingMs <= 0) {
      return {
        resultState: "provider_unavailable",
        enriched: false,
        normalizedBarcode: code,
        product: null,
        cacheHit: false,
        attempts: [],
      };
    }

    const cached = await getCached(kv, code, remainingMs);
    if (!cached) continue;
    if ("notFound" in cached) {
      cachedNotFoundCount += 1;
      cachedNotFoundCode ||= code;
      continue;
    }

    const product = foundProduct(cached, code);
    return {
      resultState: "found",
      enriched: true,
      normalizedBarcode: product.normalizedBarcode || code,
      product,
      cacheHit: true,
      attempts: [],
    };
  }

  if (cachedNotFoundCount === candidates.length) {
    return resolutionForNotFound(cachedNotFoundCode, true, []);
  }

  const allAttempts: BarcodeLookupAttempt[] = [];
  let sawError = false;
  let sawRateLimit = false;
  let retryAfterSeconds: number | undefined;

  for (const code of candidates) {
    const candidateAttempts: BarcodeLookupAttempt[] = [];
    let candidateHadIssue = false;

    const providers = [
      lookupFromBarcodeLookup,
      lookupFromUpcItemDb,
    ];

    for (const provider of providers) {
      const remainingMs = msUntil(deadlineMs);
      if (remainingMs <= 0) {
        sawError = true;
        candidateHadIssue = true;
        break;
      }

      const result = await provider(code, remainingMs);
      const attempt: BarcodeLookupAttempt = {
        provider: result.provider,
        status: result.status,
      };
      if (result.status === "rate_limited" && result.retryAfterSeconds !== undefined) {
        attempt.retryAfterSeconds = result.retryAfterSeconds;
      }
      candidateAttempts.push(attempt);

      if (result.status === "found") {
        const product = foundProduct(result.product, code);
        allAttempts.push(...candidateAttempts);
        await setCached(kv, code, product, CACHE_FOUND_TTL_SECONDS, msUntil(deadlineMs));
        return {
          resultState: "found",
          enriched: true,
          normalizedBarcode: product.normalizedBarcode || code,
          product,
          cacheHit: false,
          attempts: allAttempts,
        };
      }

      if (result.status === "rate_limited") {
        candidateHadIssue = true;
        sawRateLimit = true;
        retryAfterSeconds = lowerRetryAfter(retryAfterSeconds, result.retryAfterSeconds);
      } else if (result.status === "error") {
        candidateHadIssue = true;
        sawError = true;
      }
    }

    allAttempts.push(...candidateAttempts);

    if (!candidateHadIssue) {
      await setCached(kv, code, { notFound: true }, CACHE_NOT_FOUND_TTL_SECONDS, msUntil(deadlineMs));
    }
  }

  const normalizedBarcode = candidates[0] ?? null;
  if (sawRateLimit) {
    return {
      resultState: "rate_limited",
      enriched: false,
      normalizedBarcode,
      product: null,
      cacheHit: false,
      attempts: allAttempts,
      retryAfterSeconds,
    };
  }

  if (sawError) {
    return {
      resultState: "provider_unavailable",
      enriched: false,
      normalizedBarcode,
      product: null,
      cacheHit: false,
      attempts: allAttempts,
    };
  }

  return resolutionForNotFound(normalizedBarcode, false, allAttempts);
}

export async function lookupProductByBarcode(
  rawBarcode: string,
  options: BarcodeLookupOptions = {},
): Promise<BarcodeProductInfo | null> {
  const lookup = await lookupBarcode(rawBarcode, options);
  return lookup.resultState === "found" ? lookup.product : null;
}

export function validateBarcodeLookupCode(
  input: unknown,
  params: { fieldName?: string; statusCode?: number } = {},
): string {
  const fieldName = params.fieldName || "code";
  const statusCode = params.statusCode ?? 400;

  if (typeof input !== "string") {
    throw new ApiError(statusCode, "VALIDATION_ERROR", `${fieldName} is required`);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new ApiError(statusCode, "VALIDATION_ERROR", `${fieldName} is required`);
  }

  if (trimmed.length > 64) {
    throw new ApiError(statusCode, "VALIDATION_ERROR", `${fieldName} is too long`);
  }

  const digits = normalizeBarcodeForLookup(trimmed).replace(/\D/g, "");
  if (!digits) {
    throw new ApiError(
      statusCode,
      "VALIDATION_ERROR",
      `${fieldName} must contain UPC/EAN/GTIN digits`,
    );
  }

  if (![8, 12, 13, 14].includes(digits.length)) {
    throw new ApiError(
      statusCode,
      "VALIDATION_ERROR",
      `${fieldName} must be a valid UPC/EAN/GTIN`,
    );
  }

  return trimmed;
}
