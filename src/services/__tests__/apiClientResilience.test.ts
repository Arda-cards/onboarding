import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  gmailApi,
  resetApiClientStateForTests,
} from '../api';

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

describe('API client resilience', () => {
  beforeEach(() => {
    resetApiClientStateForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetApiClientStateForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries transient failures after Retry-After and injects a correlation id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(
          { error: 'Try again' },
          {
            status: 503,
            headers: { 'Retry-After': '1' },
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { connected: true, gmailEmail: 'user@example.com' },
          { status: 200 },
        ),
      );

    const promise = gmailApi.getStatus();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({
      connected: true,
      gmailEmail: 'user@example.com',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-Request-ID')).toMatch(/\S+/);
  });

  it('opens the circuit after repeated transient failures and serves cached GET data', async () => {
    const cachedPayload = {
      connected: true,
      gmailEmail: 'cached@example.com',
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(jsonResponse(cachedPayload, { status: 200 }));

    await expect(gmailApi.getStatus()).resolves.toEqual(cachedPayload);

    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'Temporarily unavailable' }, { status: 503 }),
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const promise = expect(gmailApi.getStatus()).rejects.toBeInstanceOf(ApiRequestError);
      await vi.runAllTimersAsync();
      await promise;
    }

    const thresholdPromise = expect(gmailApi.getStatus()).resolves.toEqual(cachedPayload);
    await vi.runAllTimersAsync();
    await thresholdPromise;

    const fetchCallsBeforeOpenCircuit = fetchMock.mock.calls.length;
    await expect(gmailApi.getStatus()).resolves.toEqual(cachedPayload);
    expect(fetchMock).toHaveBeenCalledTimes(fetchCallsBeforeOpenCircuit);
  });
});
