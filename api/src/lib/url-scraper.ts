import { isIP } from "node:net";
import { JSDOM } from "jsdom";
import type { KeyValueStore } from "./gmail-oauth-store";
import { ApiError } from "../types";

const MAX_HTML_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY_LIMIT = 5;
const MAX_REDIRECTS = 5;
const CACHE_TTL_SECONDS = 24 * 60 * 60;

export type UrlExtractionSource = "playwright" | "jsdom" | "jina" | "error";

export interface UrlScrapedItem {
  sourceUrl: string;
  productUrl?: string;
  imageUrl?: string;
  title?: string;
  itemName?: string;
  supplier?: string;
  price?: number;
  currency?: string;
  description?: string;
  vendorSku?: string;
  needsReview: boolean;
  extractionSource: UrlExtractionSource;
  confidence: number;
}

export interface UrlScrapeResult {
  sourceUrl: string;
  normalizedUrl?: string;
  status: "success" | "partial" | "failed";
  message?: string;
  extractionSource: UrlExtractionSource;
  item: UrlScrapedItem;
}

export interface UrlScrapeResponse {
  requested: number;
  processed: number;
  results: UrlScrapeResult[];
  items: UrlScrapedItem[];
  expiresAt?: string;
}

export interface UrlScraperDeps {
  fetchFn?: typeof fetch;
  jinaFetchFn?: typeof fetch;
  kv?: Pick<KeyValueStore, "get" | "set"> | null;
  timeoutMs?: number;
  concurrency?: number;
  now?: () => number;
  playwrightHtmlFn?: (
    url: string,
    timeoutMs: number,
  ) => Promise<{ finalUrl?: string; html: string } | null>;
}

type AdapterSuccess = {
  extractionSource: Exclude<UrlExtractionSource, "error">;
  finalUrl: string;
  item: UrlScrapedItem;
};

type CachedUrlScrapeResult = Omit<UrlScrapeResult, "sourceUrl"> & {
  item: Omit<UrlScrapedItem, "sourceUrl">;
};

function normalizedTimeoutMs(value?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(parsed, 120_000));
}

function normalizedConcurrency(value?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONCURRENCY_LIMIT;
  return Math.max(1, Math.min(Math.floor(parsed), 20));
}

function deadlineFromNow(timeoutMs: number, now: () => number): number {
  return now() + timeoutMs;
}

function msUntil(deadlineMs: number, now: () => number): number {
  return Math.max(0, deadlineMs - now());
}

function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true;
  }
  return false;
}

function assertSafeUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(422, "VALIDATION_ERROR", "Only http/https URLs are supported");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new ApiError(422, "VALIDATION_ERROR", "Localhost URLs are not allowed");
  }

  const ipType = isIP(host);
  if (ipType === 4 && isPrivateIpv4(host)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Private IP URLs are not allowed");
  }
  if (ipType === 6 && isPrivateIpv6(host)) {
    throw new ApiError(422, "VALIDATION_ERROR", "Private IP URLs are not allowed");
  }
}

export function cleanUrlCandidate(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new ApiError(422, "VALIDATION_ERROR", "URL is required");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError(422, "VALIDATION_ERROR", "Invalid URL");
  }

  assertSafeUrl(url);
  url.hash = "";
  return url.toString();
}

function normalizeWhitespace(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function normalizeHeading(value: string | undefined): string | undefined {
  return normalizeWhitespace(value?.replace(/^#+\s*/, "").replace(/^title:\s*/i, ""));
}

function resolveMaybeRelativeUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = firstString(entry);
      if (nested) return nested;
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested = firstString(record.url)
      || firstString(record.contentUrl)
      || firstString(record.name);
    if (nested) return nested;
  }
  return undefined;
}

function normalizeAsNumber(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "string") return undefined;
  const match = input.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= 5 ? trimmed.toUpperCase() : trimmed;
}

function extractPriceFromText(text: string): number | undefined {
  const match = text.match(/(?:\$|USD\s*)\s*(\d{1,6}(?:\.\d{1,2})?)/i);
  if (!match?.[1]) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function inferSupplierFromUrl(url: string): string | undefined {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0] || "";
    if (!root) return undefined;
    return root
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
      .join(" ");
  } catch {
    return undefined;
  }
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeJsonLdNode(node: unknown): unknown[] {
  if (!node) return [];
  if (Array.isArray(node)) {
    return node.flatMap((entry) => normalizeJsonLdNode(entry));
  }
  if (typeof node !== "object") return [];

  const record = node as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) {
    return normalizeJsonLdNode(record["@graph"]);
  }
  return [record];
}

function isProductNode(node: Record<string, unknown>): boolean {
  const typeValue = node["@type"];
  if (typeof typeValue === "string") return typeValue.toLowerCase().includes("product");
  if (Array.isArray(typeValue)) {
    return typeValue.some((entry) => typeof entry === "string" && entry.toLowerCase().includes("product"));
  }
  return false;
}

function readMetaContent(document: any, key: string): string | undefined {
  const selectors = [
    `meta[property="${key}"]`,
    `meta[name="${key}"]`,
  ];

  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute("content");
    const normalized = normalizeWhitespace(content);
    if (normalized) return normalized;
  }
  return undefined;
}

function readCanonicalUrl(document: any, baseUrl: string): string | undefined {
  const href = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
  return resolveMaybeRelativeUrl(normalizeWhitespace(href), baseUrl);
}

function extractJsonLdProduct(document: any, baseUrl: string): Partial<UrlScrapedItem> {
  const scripts = Array.from<{ textContent?: string | null }>(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )
    .map((script) => script.textContent?.trim())
    .filter(Boolean) as string[];

  for (const scriptContent of scripts) {
    const parsed = parseJson<unknown>(scriptContent);
    if (!parsed) continue;

    const nodes = normalizeJsonLdNode(parsed);
    const productNode = nodes.find(
      (node) => node && typeof node === "object" && isProductNode(node as Record<string, unknown>),
    ) as Record<string, unknown> | undefined;
    if (!productNode) continue;

    const offersRaw = productNode.offers;
    const offers = Array.isArray(offersRaw)
      ? (offersRaw[0] as Record<string, unknown> | undefined)
      : (offersRaw as Record<string, unknown> | undefined);

    const brand = productNode.brand;
    const brandName = typeof brand === "string"
      ? brand
      : typeof brand === "object" && brand !== null
        ? firstString((brand as Record<string, unknown>).name)
        : undefined;

    const supplier = brandName
      || firstString(productNode.manufacturer)
      || firstString(productNode.seller)
      || firstString(productNode.vendor);
    const title = normalizeWhitespace(firstString(productNode.name));

    return {
      title,
      itemName: title,
      description: normalizeWhitespace(firstString(productNode.description)),
      vendorSku:
        normalizeWhitespace(firstString(productNode.sku))
        || normalizeWhitespace(firstString(productNode.mpn))
        || normalizeWhitespace(firstString(productNode.productID)),
      supplier: normalizeWhitespace(supplier),
      productUrl: resolveMaybeRelativeUrl(firstString(productNode.url), baseUrl),
      imageUrl: resolveMaybeRelativeUrl(firstString(productNode.image), baseUrl),
      price: normalizeAsNumber(offers?.price),
      currency: normalizeCurrency(offers?.priceCurrency),
    };
  }

  return {};
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader) {
    const parsed = Number(lengthHeader);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new ApiError(422, "VALIDATION_ERROR", "Response too large");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return await response.text();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.length;
    if (total > maxBytes) {
      throw new ApiError(422, "VALIDATION_ERROR", "Response too large");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchText(url: string, fetchFn: typeof fetch, timeoutMs: number, accept: string): Promise<Response> {
  return await fetchFn(url, {
    method: "GET",
    redirect: "follow",
    signal: timeoutSignal(timeoutMs),
    headers: {
      Accept: accept,
      "User-Agent": "onboarding-api/1.0 (url scrape)",
    },
  } as any);
}

async function fetchPage(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<{
  finalUrl: string;
  html: string;
}> {
  const response = await fetchText(
    url,
    fetchFn,
    timeoutMs,
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  );

  const redirectCount = Number(response.headers.get("x-fetch-redirect-count") || "0");
  if (Number.isFinite(redirectCount) && redirectCount > MAX_REDIRECTS) {
    throw new ApiError(422, "VALIDATION_ERROR", "Too many redirects");
  }

  if (!response.ok) {
    throw new ApiError(422, "VALIDATION_ERROR", `Fetch failed (${response.status})`);
  }

  return {
    finalUrl: response.url || url,
    html: await readTextWithLimit(response, MAX_HTML_BYTES),
  };
}

async function fetchJinaText(url: string, fetchFn: typeof fetch, timeoutMs: number): Promise<string> {
  const response = await fetchText(
    `https://r.jina.ai/${url}`,
    fetchFn,
    timeoutMs,
    "text/plain,text/markdown;q=0.9,*/*;q=0.8",
  );

  if (!response.ok) {
    throw new ApiError(422, "VALIDATION_ERROR", `Jina fetch failed (${response.status})`);
  }

  return await readTextWithLimit(response, MAX_HTML_BYTES);
}

function metadataSignalCount(item: Partial<UrlScrapedItem>): number {
  return [
    Boolean(item.title || item.itemName),
    Boolean(item.description),
    Boolean(item.imageUrl),
    Boolean(item.price),
    Boolean(item.supplier),
  ].filter(Boolean).length;
}

function hasUsefulMetadata(item: Partial<UrlScrapedItem>): boolean {
  return Boolean(
    item.title
    || item.itemName
    || item.description
    || item.imageUrl
    || item.price,
  );
}

function resultStatus(item: UrlScrapedItem): UrlScrapeResult["status"] {
  return item.title || item.itemName || item.imageUrl ? "success" : "partial";
}

export function extractUrlMetadata(
  html: string,
  finalUrl: string,
  extractionSource: UrlExtractionSource = "jsdom",
): UrlScrapedItem {
  const dom = new JSDOM(html, { url: finalUrl });
  const { document } = dom.window;

  const jsonLd = extractJsonLdProduct(document, finalUrl);
  const ogTitle = readMetaContent(document, "og:title");
  const ogDescription =
    readMetaContent(document, "og:description")
    || readMetaContent(document, "description");
  const ogImage =
    readMetaContent(document, "og:image")
    || readMetaContent(document, "twitter:image");
  const ogPrice =
    readMetaContent(document, "product:price:amount")
    || readMetaContent(document, "og:price:amount");
  const ogCurrency =
    readMetaContent(document, "product:price:currency")
    || readMetaContent(document, "og:price:currency");
  const pageTitle = normalizeWhitespace(document.querySelector("title")?.textContent);
  const h1 = normalizeWhitespace(document.querySelector("h1")?.textContent);
  const canonical = readCanonicalUrl(document, finalUrl);
  const bodyText = normalizeWhitespace(document.body?.textContent) ?? "";

  const title = jsonLd.title || ogTitle || h1 || pageTitle;
  const productUrl = canonical || jsonLd.productUrl || finalUrl;
  const imageUrl = resolveMaybeRelativeUrl(jsonLd.imageUrl || ogImage, finalUrl);
  const description = jsonLd.description || ogDescription;
  const price = jsonLd.price ?? normalizeAsNumber(ogPrice) ?? extractPriceFromText(bodyText);
  const currency = jsonLd.currency || normalizeCurrency(ogCurrency);
  const supplier = jsonLd.supplier || inferSupplierFromUrl(productUrl);
  const signals = metadataSignalCount({
    title,
    description,
    imageUrl,
    price,
    supplier,
  });
  const confidence = Math.min(1, 0.25 + signals * 0.15);

  return {
    sourceUrl: finalUrl,
    productUrl,
    imageUrl,
    title,
    itemName: title,
    supplier,
    price,
    currency,
    description,
    vendorSku: jsonLd.vendorSku,
    needsReview: confidence < 0.75,
    extractionSource,
    confidence,
  };
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
    .replace(/[*_`>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeScrapeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) {
    if (err.name === "AbortError" || /abort|timed out/i.test(err.message)) {
      return "Scrape timed out";
    }
    return err.message || "Unknown error";
  }
  return "Unknown error";
}

function firstMarkdownImage(text: string): string | undefined {
  const imageMatch = text.match(/!\[[^\]]*]\((https?:\/\/[^\s)]+)\)/i);
  if (imageMatch?.[1]) return imageMatch[1];

  const plainMatch = text.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)/i);
  return plainMatch?.[0];
}

export function extractJinaMetadata(text: string, sourceUrl: string): UrlScrapedItem {
  const trimmed = text.trim();
  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((paragraph) => stripMarkdown(paragraph))
    .filter(Boolean);
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => normalizeHeading(stripMarkdown(line)))
    .filter(Boolean) as string[];

  const title = lines[0];
  const description = paragraphs.find((paragraph) => paragraph !== title);
  const imageUrl = firstMarkdownImage(trimmed);
  const price = extractPriceFromText(trimmed);
  const supplier = inferSupplierFromUrl(sourceUrl);
  const signals = metadataSignalCount({
    title,
    description,
    imageUrl,
    price,
    supplier,
  });
  const confidence = Math.min(1, 0.2 + signals * 0.15);

  return {
    sourceUrl,
    productUrl: sourceUrl,
    imageUrl,
    title,
    itemName: title,
    supplier,
    price,
    description,
    needsReview: confidence < 0.75,
    extractionSource: "jina",
    confidence,
  };
}

async function defaultPlaywrightHtmlFn(
  url: string,
  timeoutMs: number,
): Promise<{ finalUrl?: string; html: string } | null> {
  let playwright: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    playwright = require("playwright");
  } catch {
    return null;
  }

  const chromium = playwright?.chromium;
  if (!chromium?.launch) return null;

  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    const html = await page.content();
    return {
      finalUrl: page.url(),
      html,
    };
  } catch {
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

export async function scrapeWithPlaywright(
  url: string,
  deps: UrlScraperDeps = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AdapterSuccess | null> {
  const playwrightHtmlFn = deps.playwrightHtmlFn ?? defaultPlaywrightHtmlFn;
  const page = await playwrightHtmlFn(url, timeoutMs);
  if (!page?.html) return null;

  const finalUrl = page.finalUrl || url;
  return {
    extractionSource: "playwright",
    finalUrl,
    item: extractUrlMetadata(page.html, finalUrl, "playwright"),
  };
}

export async function scrapeWithJsdom(
  url: string,
  deps: UrlScraperDeps = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AdapterSuccess> {
  const page = await fetchPage(url, deps.fetchFn ?? fetch, timeoutMs);
  return {
    extractionSource: "jsdom",
    finalUrl: page.finalUrl,
    item: extractUrlMetadata(page.html, page.finalUrl, "jsdom"),
  };
}

export async function scrapeWithJina(
  url: string,
  deps: UrlScraperDeps = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<AdapterSuccess> {
  const text = await fetchJinaText(url, deps.jinaFetchFn ?? deps.fetchFn ?? fetch, timeoutMs);
  return {
    extractionSource: "jina",
    finalUrl: url,
    item: extractJinaMetadata(text, url),
  };
}

function cacheKey(normalizedUrl: string): string {
  return `url:scrape:${normalizedUrl}`;
}

async function getCachedResult(
  kv: Pick<KeyValueStore, "get" | "set"> | null | undefined,
  normalizedUrl: string,
  sourceUrl: string,
): Promise<UrlScrapeResult | null> {
  if (!kv) return null;

  try {
    const cached = await kv.get(cacheKey(normalizedUrl));
    if (!cached) return null;

    const parsed = JSON.parse(cached) as CachedUrlScrapeResult;
    return {
      ...parsed,
      sourceUrl,
      item: {
        ...parsed.item,
        sourceUrl,
      },
    };
  } catch {
    return null;
  }
}

async function setCachedResult(
  kv: Pick<KeyValueStore, "get" | "set"> | null | undefined,
  normalizedUrl: string,
  result: UrlScrapeResult,
): Promise<void> {
  if (!kv) return;

  try {
    const payload: CachedUrlScrapeResult = {
      ...result,
      item: {
        ...result.item,
      },
    };
    delete (payload as { sourceUrl?: string }).sourceUrl;
    delete (payload.item as { sourceUrl?: string }).sourceUrl;
    await kv.set(cacheKey(normalizedUrl), JSON.stringify(payload), { EX: CACHE_TTL_SECONDS });
  } catch {
    // Cache is best-effort only.
  }
}

function selectBestAttempt(attempts: AdapterSuccess[]): AdapterSuccess | null {
  if (attempts.length === 0) return null;
  return attempts.reduce((best, current) => {
    return metadataSignalCount(current.item) > metadataSignalCount(best.item) ? current : best;
  });
}

function failedResult(sourceUrl: string, normalizedUrl: string | undefined, message: string): UrlScrapeResult {
  const item: UrlScrapedItem = {
    sourceUrl,
    needsReview: true,
    extractionSource: "error",
    confidence: 0,
  };

  return {
    sourceUrl,
    normalizedUrl,
    status: "failed",
    message,
    extractionSource: "error",
    item,
  };
}

function toResult(sourceUrl: string, normalizedUrl: string, attempt: AdapterSuccess): UrlScrapeResult {
  const item: UrlScrapedItem = {
    ...attempt.item,
    sourceUrl,
    extractionSource: attempt.extractionSource,
  };
  const status = resultStatus(item);

  return {
    sourceUrl,
    normalizedUrl,
    status,
    message: status === "partial" ? "Missing key metadata; review required" : undefined,
    extractionSource: attempt.extractionSource,
    item,
  };
}

async function scrapeOne(sourceUrl: string, deps: UrlScraperDeps): Promise<UrlScrapeResult> {
  let normalizedUrl: string | undefined;

  try {
    normalizedUrl = cleanUrlCandidate(sourceUrl);
    const cached = await getCachedResult(deps.kv, normalizedUrl, sourceUrl);
    if (cached) return cached;

    const now = deps.now ?? (() => Date.now());
    const deadlineMs = deadlineFromNow(normalizedTimeoutMs(deps.timeoutMs), now);
    const attempts: AdapterSuccess[] = [];
    const errors: string[] = [];

    const adapters = [scrapeWithPlaywright, scrapeWithJsdom, scrapeWithJina] as const;
    for (const adapter of adapters) {
      const remainingMs = msUntil(deadlineMs, now);
      if (remainingMs <= 0) {
        errors.push("Scrape timed out");
        break;
      }

      try {
        const attempt = await adapter(normalizedUrl, deps, remainingMs);
        if (!attempt) continue;
        attempts.push(attempt);
        if (hasUsefulMetadata(attempt.item)) {
          const result = toResult(sourceUrl, normalizedUrl, attempt);
          await setCachedResult(deps.kv, normalizedUrl, result);
          return result;
        }
      } catch (err) {
        errors.push(normalizeScrapeError(err));
      }
    }

    const bestAttempt = selectBestAttempt(attempts);
    if (bestAttempt) {
      const result = toResult(sourceUrl, normalizedUrl, bestAttempt);
      await setCachedResult(deps.kv, normalizedUrl, result);
      return result;
    }

    return failedResult(
      sourceUrl,
      normalizedUrl,
      errors.at(-1) || "All scrape providers failed",
    );
  } catch (err) {
    const message = normalizeScrapeError(err);
    return failedResult(sourceUrl, normalizedUrl, message);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function scrapeUrls(urls: string[], deps: UrlScraperDeps = {}): Promise<UrlScrapeResponse> {
  const cleaned = urls
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  const deduped = Array.from(new Set(cleaned));
  if (deduped.length === 0) {
    throw new ApiError(422, "VALIDATION_ERROR", "At least one URL is required");
  }
  if (deduped.length > 50) {
    throw new ApiError(422, "VALIDATION_ERROR", "Maximum 50 URLs are allowed per request");
  }

  const results = await mapLimit(
    deduped,
    normalizedConcurrency(deps.concurrency),
    (url) => scrapeOne(url, deps),
  );
  const items = results.filter((result) => result.status !== "failed").map((result) => result.item);
  const now = deps.now ?? (() => Date.now());

  return {
    requested: urls.length,
    processed: results.length,
    results,
    items,
    expiresAt: new Date(now() + CACHE_TTL_SECONDS * 1000).toISOString(),
  };
}
