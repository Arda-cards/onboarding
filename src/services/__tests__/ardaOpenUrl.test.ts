import { describe, expect, it } from 'vitest';
import { buildArdaOpenUrl, getLastSuccessfulSyncTenant } from '../api';

describe('Arda open URL builder', () => {
  it('replaces {tenantId} when tenant exists', () => {
    expect(
      buildArdaOpenUrl('tenant-123', {
        appUrl: 'https://live.app.arda.cards',
        appUrlTemplate: 'https://live.app.arda.cards/?tenantId={tenantId}',
      }),
    ).toBe('https://live.app.arda.cards/?tenantId=tenant-123');
  });

  it('falls back to app URL when tenant is missing', () => {
    expect(
      buildArdaOpenUrl(null, {
        appUrl: 'https://live.app.arda.cards',
        appUrlTemplate: 'https://live.app.arda.cards/?tenantId={tenantId}',
      }),
    ).toBe('https://live.app.arda.cards');
  });

  it('falls back to app URL when template has no tenant placeholder', () => {
    expect(
      buildArdaOpenUrl('tenant-123', {
        appUrl: 'https://live.app.arda.cards',
        appUrlTemplate: 'https://live.app.arda.cards/dashboard',
      }),
    ).toBe('https://live.app.arda.cards');
  });
});

describe('last successful sync tenant parser', () => {
  it('selects the most recent successful event with tenantId', () => {
    const tenant = getLastSuccessfulSyncTenant({
      recent: [
        {
          id: '2',
          operation: 'item_create',
          success: true,
          requested: 1,
          successful: 1,
          failed: 0,
          timestamp: '2026-02-20T10:00:00.000Z',
          tenantId: 'tenant-new',
          email: 'new@example.com',
        },
        {
          id: '1',
          operation: 'item_create',
          success: true,
          requested: 1,
          successful: 1,
          failed: 0,
          timestamp: '2026-02-20T09:00:00.000Z',
          tenantId: 'tenant-old',
          email: 'old@example.com',
        },
      ],
    });

    expect(tenant).toEqual({
      tenantId: 'tenant-new',
      email: 'new@example.com',
      timestamp: '2026-02-20T10:00:00.000Z',
    });
  });

  it('ignores failed or tenant-less events', () => {
    const tenant = getLastSuccessfulSyncTenant({
      recent: [
        {
          id: '3',
          operation: 'item_create',
          success: false,
          requested: 1,
          successful: 0,
          failed: 1,
          timestamp: '2026-02-20T10:00:00.000Z',
          tenantId: 'tenant-failed',
        },
        {
          id: '2',
          operation: 'item_create',
          success: true,
          requested: 1,
          successful: 1,
          failed: 0,
          timestamp: '2026-02-20T09:00:00.000Z',
        },
      ],
    });

    expect(tenant).toBeNull();
  });
});
