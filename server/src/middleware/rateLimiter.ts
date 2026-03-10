import rateLimit from 'express-rate-limit';
import { rateLimitConfig } from '../config.js';

export const defaultLimiter = rateLimit({
  windowMs: rateLimitConfig.windowMs,
  max: rateLimitConfig.max,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts. Please try again later.',
});

export const scrapeLimiter = rateLimit({
  windowMs: rateLimitConfig.windowMs,
  max: Math.min(rateLimitConfig.max, 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many scrape requests. Please try again later.',
});

export const geminiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI analysis requests. Please try again shortly.' },
});

export const amazonLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Amazon enrichment requests. Please try again shortly.' },
});

export const barcodeLookupLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many barcode lookup requests. Please try again shortly.' },
});
