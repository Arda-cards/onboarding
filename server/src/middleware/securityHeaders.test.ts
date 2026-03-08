import express from 'express';
import { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicyDirectives,
  createSecurityHeadersMiddleware,
} from './securityHeaders.js';

describe('securityHeaders', () => {
  let server: Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.BACKEND_URL = 'https://api.example.com';

    const app = express();
    app.use(createSecurityHeadersMiddleware());
    app.get('/health', (_req, res) => {
      res.json({ ok: true });
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    delete process.env.FRONTEND_URL;
    delete process.env.BACKEND_URL;

    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = null;
    }
  });

  it('builds a non-empty CSP with trusted frontend/backend origins', () => {
    expect(buildContentSecurityPolicyDirectives()).toMatchObject({
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    });
    expect(buildContentSecurityPolicyDirectives().connectSrc).toContain('https://app.example.com');
    expect(buildContentSecurityPolicyDirectives().connectSrc).toContain('https://api.example.com');
  });

  it('emits a Content-Security-Policy header', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const csp = response.headers.get('content-security-policy');

    expect(response.status).toBe(200);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
