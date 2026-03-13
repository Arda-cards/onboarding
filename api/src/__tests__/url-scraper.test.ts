import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../types";
import {
  cleanUrlCandidate,
  extractJinaMetadata,
  extractUrlMetadata,
  scrapeUrls,
  scrapeWithJina,
  scrapeWithJsdom,
  scrapeWithPlaywright,
} from "../lib/url-scraper";

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

describe("url scraper", () => {
  it("rejects localhost URLs", () => {
    expect(() => cleanUrlCandidate("http://localhost/test")).toThrow(ApiError);
  });

  it("extracts basic metadata from HTML", () => {
    const html = `
      <html>
        <head>
          <title>Example Product</title>
          <meta property="og:image" content="https://example.com/img.png" />
          <meta name="description" content="A great product" />
          <link rel="canonical" href="https://shop.example.com/p/123" />
        </head>
        <body>
          <h1>Example Product Name</h1>
        </body>
      </html>
    `;

    const item = extractUrlMetadata(html, "https://shop.example.com/p/123?ref=abc");
    expect(item.title).toBeTruthy();
    expect(item.itemName).toBe(item.title);
    expect(item.productUrl).toBe("https://shop.example.com/p/123");
    expect(item.imageUrl).toBe("https://example.com/img.png");
    expect(item.needsReview).toBeTypeOf("boolean");
    expect(item.confidence).toBeGreaterThan(0);
  });

  it("parses Jina reader text into fallback metadata", () => {
    const item = extractJinaMetadata(
      "# Example Product\n\nA great fallback description.\n\nPrice: $12.50",
      "https://shop.example.com/p/123",
    );

    expect(item.title).toBe("Example Product");
    expect(item.description).toContain("fallback description");
    expect(item.price).toBe(12.5);
    expect(item.extractionSource).toBe("jina");
  });

  it("uses the Playwright adapter when rendered HTML is available", async () => {
    const result = await scrapeWithPlaywright(
      "https://example.com/p/1",
      {
        playwrightHtmlFn: async () => ({
          finalUrl: "https://example.com/p/1",
          html: "<html><head><title>Rendered Product</title></head><body><h1>Rendered Product</h1></body></html>",
        }),
      },
      1000,
    );

    expect(result?.extractionSource).toBe("playwright");
    expect(result?.item.title).toBe("Rendered Product");
  });

  it("uses the jsdom adapter to parse fetched HTML", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      htmlResponse("<html><head><title>One</title></head><body><h1>One</h1></body></html>"),
    );

    const result = await scrapeWithJsdom("https://example.com/p/1", { fetchFn }, 1000);
    expect(result.extractionSource).toBe("jsdom");
    expect(result.item.title).toBe("One");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("uses the Jina adapter when asked", async () => {
    const jinaFetchFn = vi.fn().mockResolvedValue(
      new Response("# Jina Product\n\nReadable fallback text.", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await scrapeWithJina("https://example.com/p/1", { jinaFetchFn }, 1000);
    expect(result.extractionSource).toBe("jina");
    expect(result.item.title).toBe("Jina Product");
    expect(jinaFetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back from Playwright to jsdom to Jina", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      htmlResponse("<html><head></head><body>No useful metadata</body></html>"),
    );
    const jinaFetchFn = vi.fn().mockResolvedValue(
      new Response("# Fallback Product\n\nDescription from Jina.", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const result = await scrapeUrls(
      ["https://example.com/p/1"],
      {
        playwrightHtmlFn: async () => null,
        fetchFn,
        jinaFetchFn,
      },
    );

    expect(result.processed).toBe(1);
    expect(result.results[0]?.extractionSource).toBe("jina");
    expect(result.results[0]?.status).toBe("success");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(jinaFetchFn).toHaveBeenCalledTimes(1);
  });

  it("enforces the configured concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;

    const fetchFn = vi.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return htmlResponse("<html><head><title>One</title></head><body><h1>One</h1></body></html>");
    });

    const result = await scrapeUrls(
      [
        "https://example.com/p/1",
        "https://example.com/p/2",
        "https://example.com/p/3",
        "https://example.com/p/4",
      ],
      {
        playwrightHtmlFn: async () => null,
        fetchFn,
        concurrency: 2,
      },
    );

    expect(result.processed).toBe(4);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("returns failed results when a URL scrape times out", async () => {
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = Object.assign(new Error("aborted"), { name: "AbortError" });
          reject(error);
        });
      });
    });

    const result = await scrapeUrls(
      ["https://example.com/p/1"],
      {
        playwrightHtmlFn: async () => null,
        fetchFn,
        timeoutMs: 25,
      },
    );

    expect(result.results[0]?.status).toBe("failed");
    expect(result.results[0]?.message).toBe("Scrape timed out");
  });

  it("enforces 50 URL max", async () => {
    const urls = Array.from({ length: 51 }, (_, index) => `https://example.com/${index}`);
    await expect(scrapeUrls(urls)).rejects.toBeInstanceOf(ApiError);
  });
});
