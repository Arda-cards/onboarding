import type { Redis as RedisClient } from 'ioredis';
import { query } from '../db/index.js';
import { requireRedis } from '../config.js';

export type HealthComponentStatus = 'ok' | 'down' | 'disabled';
export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthReport {
  status: HealthStatus;
  checkedAt: string;
  components: {
    db: HealthComponentStatus;
    redis: HealthComponentStatus;
    gemini: HealthComponentStatus;
  };
}

export interface ReadinessDeps {
  checkDb?: () => Promise<unknown>;
  redisClient?: Pick<RedisClient, 'ping'> | null;
  requireRedis?: boolean;
  geminiApiKey?: string | null;
}

export function getLivenessReport(): Pick<HealthReport, 'status' | 'checkedAt'> {
  return {
    status: 'ok',
    checkedAt: new Date().toISOString(),
  };
}

export async function getReadinessReport(
  deps: ReadinessDeps = {},
): Promise<HealthReport> {
  const checkDb = deps.checkDb ?? (() => query('SELECT 1'));
  const redis = deps.redisClient;
  const redisRequired = deps.requireRedis ?? requireRedis;
  const geminiConfigured = Boolean(deps.geminiApiKey ?? process.env.GEMINI_API_KEY);

  let dbStatus: HealthComponentStatus = 'ok';
  let redisStatus: HealthComponentStatus = redisRequired ? 'down' : 'disabled';

  try {
    await checkDb();
  } catch {
    dbStatus = 'down';
  }

  if (redis) {
    try {
      const pong = await redis.ping();
      redisStatus = pong === 'PONG' ? 'ok' : 'down';
    } catch {
      redisStatus = 'down';
    }
  }

  const geminiStatus: HealthComponentStatus = geminiConfigured ? 'ok' : 'disabled';

  const status: HealthStatus =
    dbStatus === 'down' || (redisRequired && redisStatus === 'down')
      ? 'down'
      : geminiStatus === 'disabled'
        || redisStatus === 'disabled'
        || (!redisRequired && redisStatus === 'down')
        ? 'degraded'
        : 'ok';

  return {
    status,
    checkedAt: new Date().toISOString(),
    components: {
      db: dbStatus,
      redis: redisStatus,
      gemini: geminiStatus,
    },
  };
}
