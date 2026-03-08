import express from 'express';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  amazonLimiter,
  barcodeLookupLimiter,
  geminiLimiter,
} from './rateLimiter.js';

async function startServer(
  middleware: express.RequestHandler,
): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(middleware);
  app.get('/test', (_req, res) => {
    res.json({ ok: true });
  });
  app.post('/test', (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function issueRequests(
  baseUrl: string,
  count: number,
  init?: RequestInit,
): Promise<Response[]> {
  return Promise.all(
    Array.from({ length: count }, () => fetch(`${baseUrl}/test`, init)),
  );
}

describe('rate limiters', () => {
  let server: Server | null = null;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await closeServer(server);
    server = null;
  });

  it('limits Gemini-backed endpoints after 10 requests per minute', async () => {
    const started = await startServer(geminiLimiter);
    server = started.server;

    const responses = await issueRequests(started.baseUrl, 10, { method: 'POST' });
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const limited = await fetch(`${started.baseUrl}/test`, { method: 'POST' });
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      error: 'Too many AI analysis requests. Please try again shortly.',
    });
  }, 20_000);

  it('limits Amazon enrichment endpoints after 10 requests per minute', async () => {
    const started = await startServer(amazonLimiter);
    server = started.server;

    const responses = await issueRequests(started.baseUrl, 10);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const limited = await fetch(`${started.baseUrl}/test`);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      error: 'Too many Amazon enrichment requests. Please try again shortly.',
    });
  }, 20_000);

  it('limits barcode lookups after 30 requests per minute', async () => {
    const started = await startServer(barcodeLookupLimiter);
    server = started.server;

    const responses = await issueRequests(started.baseUrl, 30);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const limited = await fetch(`${started.baseUrl}/test`);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      error: 'Too many barcode lookup requests. Please try again shortly.',
    });
  }, 20_000);
});
