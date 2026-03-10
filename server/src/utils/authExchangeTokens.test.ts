import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __authExchangeTokenTesting,
  authExchangeTokenConfig,
  consumeAuthToken,
  generateAuthToken,
  purgeExpiredAuthTokens,
} from './authExchangeTokens.js';

describe('authExchangeTokens', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-07T12:00:00.000Z'));
    __authExchangeTokenTesting.reset();
  });

  afterEach(() => {
    __authExchangeTokenTesting.reset();
    vi.useRealTimers();
  });

  it('generates long random tokens and consumes them once', async () => {
    const token = await generateAuthToken('user-123');

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(__authExchangeTokenTesting.size()).toBe(1);

    await expect(consumeAuthToken(token)).resolves.toBe('user-123');
    await expect(consumeAuthToken(token)).resolves.toBeNull();
    expect(__authExchangeTokenTesting.size()).toBe(0);
  });

  it('purges expired tokens after the configured ttl', async () => {
    await generateAuthToken('user-123');

    vi.setSystemTime(Date.now() + authExchangeTokenConfig.ttlMs + 1);
    purgeExpiredAuthTokens();

    expect(__authExchangeTokenTesting.size()).toBe(0);
  });
});
