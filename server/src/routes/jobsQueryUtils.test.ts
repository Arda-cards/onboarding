import { describe, expect, it } from 'vitest';
import {
  buildSupplierJobQuery,
  expandPrioritySupplierDomains,
  getSupplierLookbackMonths,
  sanitizeSupplierDomains,
} from './jobsQueryUtils.js';

describe('jobsQueryUtils', () => {
  it('sanitizes supplier domains with dedupe and validation', () => {
    const domains = sanitizeSupplierDomains([
      ' ULINE.com ',
      'uline.com',
      'invalid domain',
      '',
      'foo',
      'mcmaster.com',
    ]);

    expect(domains).toEqual(['uline.com', 'mcmaster.com']);
  });

  it('expands priority domains with aliases', () => {
    expect(expandPrioritySupplierDomains(['mcmaster.com'])).toEqual([
      'mcmaster.com',
      'mcmaster-carr.com',
    ]);
    expect(expandPrioritySupplierDomains(['mcmaster-carr.com', 'uline.com'])).toEqual([
      'mcmaster.com',
      'mcmaster-carr.com',
      'uline.com',
    ]);
  });

  it('builds priority strict query with broader keywords and 12 month lookback', () => {
    const now = new Date('2026-02-17T12:00:00.000Z');
    const query = buildSupplierJobQuery({
      supplierDomains: ['mcmaster.com', 'uline.com'],
      jobType: 'priority',
      mode: 'strict',
      now,
    });

    expect(query).toContain('from:mcmaster.com OR from:uline.com');
    expect(query).toContain('acknowledgment');
    expect(query).toContain('acknowledgement');
    expect(query).toContain('"purchase order"');
    expect(query).toContain('after:2025/02/17');
    expect(query).toContain('subject:(');
  });

  it('builds priority fallback query without subject filter', () => {
    const now = new Date('2026-02-17T12:00:00.000Z');
    const query = buildSupplierJobQuery({
      supplierDomains: ['mcmaster.com'],
      jobType: 'priority',
      mode: 'fallback',
      now,
    });

    expect(query).toContain('from:mcmaster.com');
    expect(query).toContain('after:2025/02/17');
    expect(query).not.toContain('subject:(');
  });

  it('keeps non-priority lookback at 6 months', () => {
    const now = new Date('2026-02-17T12:00:00.000Z');
    const query = buildSupplierJobQuery({
      supplierDomains: ['fastenal.com'],
      jobType: 'other',
      mode: 'strict',
      now,
    });

    expect(getSupplierLookbackMonths('other')).toBe(6);
    expect(query).toContain('after:2025/08/17');
  });
});
