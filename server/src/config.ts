import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().optional(),
  FRONTEND_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(10).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ARDA_TENANT_ID: z.string().optional(),
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().optional(),
  RATE_LIMIT_MAX: z.coerce.number().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration', parsed.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const port = env.PORT || 3001;
export const corsOrigin = env.FRONTEND_URL || 'http://localhost:5173';

export const rateLimitConfig = {
  windowMs: env.RATE_LIMIT_WINDOW_MS ?? 60_000, // default 1 minute
  max: env.RATE_LIMIT_MAX ?? 120, // 120 req/min per IP
};
