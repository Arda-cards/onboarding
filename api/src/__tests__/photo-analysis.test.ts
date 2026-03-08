import { describe, it, expect } from "vitest";
import { ApiError } from "../types";
import {
  analyzePhoto,
  extractFirstJsonObject,
  resolvePhotoAnalysisImageUrl,
} from "../lib/photo-analysis";

describe("photo analysis helpers", () => {
  it("resolves onboarding image keys to public URLs", () => {
    expect(
      resolvePhotoAnalysisImageUrl({
        imageUrl: "onboarding/t1/u1/example.png",
        bucket: "bucket",
        region: "us-east-1",
        publicBaseUrl: null,
        prefix: "onboarding",
      }),
    ).toBe("https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.png");
  });

  it("rejects non-onboarding image URLs", () => {
    expect(() =>
      resolvePhotoAnalysisImageUrl({
        imageUrl: "https://example.com/photo.png",
        bucket: "bucket",
        region: "us-east-1",
        publicBaseUrl: null,
        prefix: "onboarding",
      }),
    ).toThrow(ApiError);
  });

  it("extracts JSON objects from fenced output", () => {
    const json = extractFirstJsonObject("```json\n{\"a\":1}\n```");
    expect(json).toEqual({ a: 1 });
  });
});

describe("analyzePhoto", () => {
  it("returns gemini_unavailable when GEMINI_API_KEY is missing", async () => {
    const fetchFn = async () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      analyzePhoto({
        imageUrl: "https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.png",
        geminiApiKey: null,
        maxImageBytes: 1024,
        minIntervalMs: 0,
        fetchFn,
      }),
    ).resolves.toEqual({
      analyzed: false,
      reason: "gemini_unavailable",
      productName: null,
      description: null,
      estimatedCategory: null,
      brand: null,
      confidence: 0,
    });
  });

  it("sanitizes model output to stable fields", async () => {
    const analysis = await analyzePhoto({
      imageUrl: "https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.png",
      geminiApiKey: "test-key",
      maxImageBytes: 1024,
      minIntervalMs: 0,
      fetchFn: async () =>
        ({
          ok: true,
          headers: {
            get(name: string) {
              if (name.toLowerCase() === "content-type") return "image/png";
              return null;
            },
          },
          arrayBuffer: async () => Buffer.from("png-bytes"),
        } as Response),
      generateTextFn: async () =>
        "```json\n{\n  \"productName\": \"  Foo\\nBar  \",\n  \"description\": \"  Tasty snack  \",\n  \"estimatedCategory\": \" Pantry \",\n  \"brand\": 123,\n  \"confidence\": \"0.7\",\n  \"extra\": true\n}\n```",
    });

    expect(analysis).toEqual({
      analyzed: true,
      productName: "Foo Bar",
      description: "Tasty snack",
      estimatedCategory: "Pantry",
      brand: null,
      confidence: 0.7,
    });
  });

  it("rate-limits repeated calls when configured", async () => {
    const generateTextFn = async () =>
      "{\"productName\":null,\"description\":null,\"estimatedCategory\":null,\"brand\":null,\"confidence\":0}";
    const fetchFn = async () =>
      ({
        ok: true,
        headers: {
          get(name: string) {
            if (name.toLowerCase() === "content-type") return "image/png";
            return null;
          },
        },
        arrayBuffer: async () => Buffer.from("png-bytes"),
      } as Response);

    await analyzePhoto({
      imageUrl: "https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.png",
      geminiApiKey: "k",
      maxImageBytes: 1024,
      now: () => 1000,
      minIntervalMs: 1000,
      fetchFn,
      generateTextFn,
    });

    await expect(
      analyzePhoto({
        imageUrl: "https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.png",
        geminiApiKey: "k",
        maxImageBytes: 1024,
        now: () => 1500,
        minIntervalMs: 1000,
        fetchFn,
        generateTextFn,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        statusCode: 429,
        code: "RATE_LIMITED",
      } satisfies Partial<ApiError>),
    );
  });

  it("rejects unsupported fetched image formats", async () => {
    await expect(
      analyzePhoto({
        imageUrl: "https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.gif",
        geminiApiKey: "k",
        maxImageBytes: 1024,
        minIntervalMs: 0,
        fetchFn: async () =>
          ({
            ok: true,
            headers: {
              get(name: string) {
                if (name.toLowerCase() === "content-type") return "image/gif";
                return null;
              },
            },
            arrayBuffer: async () => Buffer.from("gif-bytes"),
          } as Response),
        generateTextFn: async () => "{}",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        statusCode: 400,
        code: "VALIDATION_ERROR",
      } satisfies Partial<ApiError>),
    );
  });

  it("maps Gemini rate limiting errors to RATE_LIMITED", async () => {
    await expect(
      analyzePhoto({
        imageUrl: "https://bucket.s3.amazonaws.com/onboarding/t1/u1/example.png",
        geminiApiKey: "k",
        maxImageBytes: 1024,
        minIntervalMs: 0,
        fetchFn: async () =>
          ({
            ok: true,
            headers: {
              get(name: string) {
                if (name.toLowerCase() === "content-type") return "image/png";
                return null;
              },
            },
            arrayBuffer: async () => Buffer.from("png-bytes"),
          } as Response),
        generateTextFn: async () => {
          throw new Error("429 RESOURCE_EXHAUSTED");
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        statusCode: 429,
        code: "RATE_LIMITED",
      } satisfies Partial<ApiError>),
    );
  });
});
