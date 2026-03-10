import { describe, expect, it, vi } from 'vitest';
import { getLivenessReport, getReadinessReport } from './health.js';

describe('health service', () => {
  it('returns ok for liveness checks', () => {
    expect(getLivenessReport().status).toBe('ok');
  });

  it('returns ok when db, redis, and gemini are available', async () => {
    const report = await getReadinessReport({
      checkDb: vi.fn().mockResolvedValue(undefined),
      redisClient: {
        ping: vi.fn().mockResolvedValue('PONG'),
      },
      requireRedis: true,
      geminiApiKey: 'test-key',
    });

    expect(report).toMatchObject({
      status: 'ok',
      components: {
        db: 'ok',
        redis: 'ok',
        gemini: 'ok',
      },
    });
  });

  it('returns down when a required dependency is unavailable', async () => {
    const report = await getReadinessReport({
      checkDb: vi.fn().mockRejectedValue(new Error('db offline')),
      redisClient: null,
      requireRedis: true,
      geminiApiKey: 'test-key',
    });

    expect(report).toMatchObject({
      status: 'down',
      components: {
        db: 'down',
        redis: 'down',
        gemini: 'ok',
      },
    });
  });

  it('returns degraded when only optional components are disabled', async () => {
    const report = await getReadinessReport({
      checkDb: vi.fn().mockResolvedValue(undefined),
      redisClient: null,
      requireRedis: false,
      geminiApiKey: null,
    });

    expect(report).toMatchObject({
      status: 'degraded',
      components: {
        db: 'ok',
        redis: 'disabled',
        gemini: 'disabled',
      },
    });
  });

  it('returns degraded when optional redis is unavailable', async () => {
    const report = await getReadinessReport({
      checkDb: vi.fn().mockResolvedValue(undefined),
      redisClient: {
        ping: vi.fn().mockRejectedValue(new Error('redis offline')),
      },
      requireRedis: false,
      geminiApiKey: 'test-key',
    });

    expect(report).toMatchObject({
      status: 'degraded',
      components: {
        db: 'ok',
        redis: 'down',
        gemini: 'ok',
      },
    });
  });
});
