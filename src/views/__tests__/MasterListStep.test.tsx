import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MasterListStep } from '../MasterListStep';

describe('MasterListStep URL items', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges URL-derived items and marks incomplete rows as needs attention', () => {
    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[
          {
            sourceUrl: 'https://example.com/item-a',
            productUrl: 'https://example.com/item-a',
            itemName: 'URL Item',
            supplier: undefined,
            needsReview: true,
            extractionSource: 'error',
            confidence: 0,
          },
        ]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('URL Item')).toBeInTheDocument();
    expect(screen.getByText('Email Item')).toBeInTheDocument();
    expect(screen.getByText(/1 need attention/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /URL \(1\)/i })).toBeInTheDocument();
  });

  it('supports filtering by URL source', async () => {
    const user = userEvent.setup();

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[
          {
            sourceUrl: 'https://example.com/item-a',
            productUrl: 'https://example.com/item-a',
            itemName: 'URL Item',
            supplier: 'Web Vendor',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        ]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Filter by source'), 'url');

    expect(screen.getByText('URL Item')).toBeInTheDocument();
    expect(screen.queryByText('Email Item')).not.toBeInTheDocument();
  });

  it('defaults order method by source and allows changing it', async () => {
    const user = userEvent.setup();

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[
          {
            sourceUrl: 'https://example.com/item-a',
            productUrl: 'https://example.com/item-a',
            itemName: 'URL Item',
            supplier: 'Web Vendor',
            needsReview: false,
            extractionSource: 'html-metadata',
            confidence: 0.8,
          },
        ]}
        scannedBarcodes={[
          {
            id: 'barcode-1',
            barcode: '12345',
            barcodeType: 'UPC',
            scannedAt: new Date().toISOString(),
            source: 'desktop',
            productName: 'Barcode Item',
          },
        ]}
        capturedPhotos={[
          {
            id: 'photo-1',
            imageData: 'data:image/png;base64,abc',
            capturedAt: new Date().toISOString(),
            source: 'desktop',
            suggestedName: 'Photo Item',
          },
        ]}
        csvItems={[
          {
            id: 'csv-1',
            rowIndex: 1,
            name: 'CSV Item',
            isApproved: true,
            isRejected: false,
            rawData: {},
          },
        ]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Order method for Email Item') as HTMLSelectElement).value).toBe('online');
    expect((screen.getByLabelText('Order method for URL Item') as HTMLSelectElement).value).toBe('online');
    expect((screen.getByLabelText('Order method for Barcode Item') as HTMLSelectElement).value).toBe('shopping');
    expect((screen.getByLabelText('Order method for Photo Item') as HTMLSelectElement).value).toBe('production');
    expect((screen.getByLabelText('Order method for CSV Item') as HTMLSelectElement).value).toBe('purchase_order');

    await user.selectOptions(screen.getByLabelText('Order method for Email Item'), 'email');
    expect((screen.getByLabelText('Order method for Email Item') as HTMLSelectElement).value).toBe('email');
  });

  it('sends selected order method in line-level sync payload', async () => {
    const user = userEvent.setup();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ record: { rId: 'item-1' } }),
    });

    render(
      <MasterListStep
        emailItems={[
          {
            id: 'email-1',
            name: 'Email Item',
            supplier: 'Email Vendor',
          },
        ]}
        urlItems={[]}
        scannedBarcodes={[]}
        capturedPhotos={[]}
        csvItems={[]}
        onComplete={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByLabelText('Order method for Email Item'), 'purchase_order');
    await user.click(screen.getByRole('button', { name: 'Sync' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string) as { orderMechanism: string };
    expect(body.orderMechanism).toBe('purchase_order');
  });
});
