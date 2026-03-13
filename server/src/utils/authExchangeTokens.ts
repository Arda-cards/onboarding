import { randomBytes } from 'node:crypto';
import redisClient from './redisClient.js';

const authTokens = new Map<string, { userId: string; expiresAtMs: number }>();
const AUTH_TOKEN_TTL_MS = 5 * 60_000;
const AUTH_TOKEN_TTL_SECONDS = AUTH_TOKEN_TTL_MS / 1000;
const AUTH_TOKEN_REDIS_PREFIX = 'auth:exchange:';

export async function generateAuthToken(userId: string): Promise<string> {
  purgeExpiredAuthTokens();

  const token = randomBytes(32).toString('hex');
  authTokens.set(token, { userId, expiresAtMs: Date.now() + AUTH_TOKEN_TTL_MS });

  if (redisClient) {
    try {
      await redisClient.set(
        `${AUTH_TOKEN_REDIS_PREFIX}${token}`,
        userId,
        'EX',
        AUTH_TOKEN_TTL_SECONDS,
      );
    } catch (error) {
      console.warn('Failed to store auth exchange token in Redis:', error);
    }
  }

  return token;
}

export async function consumeAuthToken(token: string): Promise<string | null> {
  purgeExpiredAuthTokens();

  if (redisClient) {
    try {
      const key = `${AUTH_TOKEN_REDIS_PREFIX}${token}`;
      const lua = `
        local v = redis.call('GET', KEYS[1])
        if v then
          redis.call('DEL', KEYS[1])
        end
        return v
      `;
      const value = await redisClient.eval(lua, 1, key);
      const decoded =
        typeof value === 'string'
          ? value
          : Buffer.isBuffer(value)
            ? value.toString('utf8')
            : '';
      if (decoded.length > 0) {
        authTokens.delete(token);
        return decoded;
      }
    } catch (error) {
      console.warn('Failed to consume auth exchange token from Redis:', error);
    }
  }

  const data = authTokens.get(token);
  if (!data) return null;

  authTokens.delete(token);
  return data.expiresAtMs > Date.now() ? data.userId : null;
}

export function purgeExpiredAuthTokens(nowMs = Date.now()): void {
  for (const [token, record] of authTokens.entries()) {
    if (record.expiresAtMs <= nowMs) {
      authTokens.delete(token);
    }
  }
}

export const authExchangeTokenConfig = {
  ttlMs: AUTH_TOKEN_TTL_MS,
  ttlSeconds: AUTH_TOKEN_TTL_SECONDS,
} as const;

export const __authExchangeTokenTesting = {
  reset(): void {
    authTokens.clear();
  },
  size(): number {
    return authTokens.size;
  },
};
