import RedisPkg from 'ioredis';
import type { Redis as RedisType } from 'ioredis';

// Handle ESM default export
const Redis = RedisPkg as unknown as typeof RedisPkg.default;

const redisUrl = process.env.REDIS_URL;
let redisClient: RedisType | null = null;
let redisReady = false;

if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      // Fast timeouts - don't block the app
      connectTimeout: 5000,
      commandTimeout: 3000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => {
        if (times > 3) {
          console.warn('⚠️ Redis connection failed after 3 retries, giving up');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 1000); // Quick backoff
      },
      lazyConnect: false,
      enableReadyCheck: true,
    });

    redisClient.on('error', (error: Error) => {
      if (!redisReady) {
        console.warn('⚠️ Redis connection error (will use memory fallback):', error.message);
      }
    });

    redisClient.on('ready', () => {
      redisReady = true;
      console.log('✅ Connected to Redis');
    });

    redisClient.on('close', () => {
      redisReady = false;
    });
  } catch (error) {
    console.warn('⚠️ Failed to initialize Redis:', error);
    redisClient = null;
  }
} else {
  console.log('ℹ️ REDIS_URL not set - using in-memory session storage');
}

export function isRedisReady(): boolean {
  return redisReady && redisClient !== null;
}

export default redisClient;

export async function closeRedisClient(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    // Ignore close errors
  }
}
