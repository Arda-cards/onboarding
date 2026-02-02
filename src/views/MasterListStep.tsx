import { useState, useMemo, useCallback, useDeferredValue } from 'react';
import { Icons } from '../components/Icons';
import { ScannedBarcode, CapturedPhoto } from './OnboardingFlow';
import { CSVItem, CSVItemColor } from './csvUploadUtils';
import { productApi } from '../services/api';

function trimOrUndefined(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return v ? v : undefined;
}

function parseOptionalNumber(value: string): number | undefined {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function _formatPrice(value: number | undefined): string {
  if (typeof value !== 'number') return '';
  return `$${value.toFixed(2)}`;
}

// Simple email item from onboarding
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  sku?: string;
  imageUrl?: string;
  productUrl?: string;
  lastPrice?: number;
  quantity?: number;
  location?: string;
  recommendedMin?: number;
  recommendedOrderQty?: number;
}

// Master list item - unified from all sources
export interface MasterListItem {
  id: string;
  source: 'email' | 'barcode' | 'photo' | 'csv';
  // Core fields
  name: string;
  description?: string;
  supplier?: string;
  location?: string;
  // Identifiers
  barcode?: string;
  sku?: string;
  asin?: string;
  // Quantities
  minQty?: number;
  orderQty?: number;
  currentQty?: number;
  // Pricing
  unitPrice?: number;
  // Media / Links
  imageUrl?: string;
  productUrl?: string;
  color?: CSVItemColor;
  // Status
  isEditing?: boolean;
  isVerified: boolean;
  needsAttention: boolean;
  validationErrors?: string[];
}

interface MasterListStepProps {
  emailItems: EmailItem[];
  scannedBarcodes: ScannedBarcode[];
  capturedPhotos: CapturedPhoto[];
  csvItems: CSVItem[];
  onComplete: (items: MasterListItem[]) => void;
}

export const MasterListStep: React.FC<MasterListStepProps> = ({
  emailItems,
  scannedBarcodes,
  capturedPhotos,
  csvItems,
  onComplete,
}) => {
  // Build initial master list from all sources
  const initialItems = useMemo(() => {
    const items: MasterListItem[] = [];
    
    // Add email items
    emailItems.forEach(item => {
      items.push({
        id: item.id,
        source: 'email',
        name: item.name,
        supplier: item.supplier,
        location: item.location,
        asin: item.asin,
        sku: item.sku,
        minQty: item.recommendedMin,
        orderQty: item.recommendedOrderQty,
        unitPrice: item.lastPrice,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        isVerified: false,
        needsAttention: !item.name || item.name.includes('Unknown'),
      });
    });
    
    // Add scanned barcodes (that aren't duplicates of email items)
    scannedBarcodes.forEach(barcode => {
      // Check if already matched to an email item
      const existingByBarcode = items.find(i => i.barcode === barcode.barcode);
      if (!existingByBarcode) {
        items.push({
          id: `barcode-${barcode.id}`,
          source: 'barcode',
          name: barcode.productName || `Unknown (${barcode.barcode})`,
          barcode: barcode.barcode,
          imageUrl: barcode.imageUrl,
          isVerified: false,
          needsAttention: !barcode.productName,
        });
      }
    });
    
    // Add photo-captured items
    capturedPhotos.forEach(photo => {
      if (photo.suggestedName) {
        items.push({
          id: `photo-${photo.id}`,
          source: 'photo',
          name: photo.suggestedName,
          supplier: photo.suggestedSupplier,
          imageUrl: photo.imageData,
          isVerified: false,
          needsAttention: false,
        });
      }
    });
    
    // Add CSV items
    csvItems.forEach(csvItem => {
      items.push({
        id: csvItem.id,
        source: 'csv',
        name: csvItem.name,
        supplier: csvItem.supplier,
        location: csvItem.location,
        barcode: csvItem.barcode,
        sku: csvItem.sku,
        minQty: csvItem.minQty,
        orderQty: csvItem.orderQty,
        unitPrice: csvItem.unitPrice,
        imageUrl: csvItem.imageUrl,
        productUrl: csvItem.productUrl,
        color: csvItem.color,
        isVerified: false,
        needsAttention: false,
      });
    });
    
    return items;
  }, [emailItems, scannedBarcodes, capturedPhotos, csvItems]);

  const [items, setItems] = useState<MasterListItem[]>(initialItems);
  const [filter, setFilter] = useState<'all' | 'needs_attention' | 'verified'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email' | 'barcode' | 'photo' | 'csv'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [enrichingIds, setEnrichingIds] = useState<Set<string>>(new Set());
  const [enrichErrorById, setEnrichErrorById] = useState<Record<string, string>>({});

  const updateItemFields = (id: string, updates: Partial<MasterListItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const next: MasterListItem = { ...item, ...updates };
      if (typeof updates.name === 'string') {
        const trimmed = updates.name.trim();
        next.needsAttention = !trimmed || trimmed.toLowerCase().includes('unknown');
      }
      if (updates.isVerified === true) {
        next.needsAttention = false;
      }
      return next;
    }));
  };

  // Remove item from list
  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  // Verify all items
  const verifyAll = () => {
    setItems(prev => prev.map(item => ({ ...item, isVerified: true, needsAttention: false })));
  };

  const enrichFromProductUrl = useCallback(async (item: MasterListItem) => {
    const url = item.productUrl || (item.asin ? `https://www.amazon.com/dp/${item.asin}` : undefined);
    if (!url) return;

    setEnrichingIds(prev => new Set(prev).add(item.id));
    setEnrichErrorById(prev => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });

    try {
      const result = await productApi.enrichUrl(url);
      const data = result.data || {};
      setItems(prev => prev.map(existing => {
        if (existing.id !== item.id) return existing;

        const next: MasterListItem = { ...existing };

        if (data.productUrl) next.productUrl = data.productUrl;
        if (data.imageUrl) next.imageUrl = data.imageUrl;
        if (typeof data.unitPrice === 'number') next.unitPrice = data.unitPrice;
        
        // Pull ASIN and SKU from Amazon API response
        if (data.asin) next.asin = data.asin;
        if (data.sku) next.sku = data.sku;

        // If we learned a pack size / unit count, use it as a reasonable default orderQty
        if (typeof data.unitCount === 'number' && data.unitCount > 0) {
          if (!next.orderQty || next.orderQty <= 1) {
            next.orderQty = data.unitCount;
          }
          if (!next.minQty || next.minQty <= 0) {
            next.minQty = Math.max(1, Math.ceil(data.unitCount / 2));
          }
        }

        // Only override name when it's clearly missing/placeholder
        if (data.name && (!next.name || next.name.includes('Unknown'))) {
          next.name = data.name;
        }

        return next;
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enrich from URL';
      setEnrichErrorById(prev => ({ ...prev, [item.id]: message }));
    } finally {
      setEnrichingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, []);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filter === 'needs_attention' && !item.needsAttention) return false;
      if (filter === 'verified' && !item.isVerified) return false;
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (deferredSearch) {
        const query = deferredSearch.toLowerCase();
        return (
          item.name.toLowerCase().includes(query) ||
          item.sku?.toLowerCase().includes(query) ||
          item.barcode?.toLowerCase().includes(query) ||
          item.asin?.toLowerCase().includes(query) ||
          item.supplier?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [items, filter, sourceFilter, deferredSearch]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    verified: items.filter(i => i.isVerified).length,
    needsAttention: items.filter(i => i.needsAttention).length,
    bySource: {
      email: items.filter(i => i.source === 'email').length,
      barcode: items.filter(i => i.source === 'barcode').length,
      photo: items.filter(i => i.source === 'photo').length,
      csv: items.filter(i => i.source === 'csv').length,
    },
  }), [items]);

  // Source icon
  const getSourceIcon = useCallback((source: MasterListItem['source']) => {
    switch (source) {
      case 'email': return <Icons.Mail className="w-3.5 h-3.5" />;
      case 'barcode': return <Icons.Barcode className="w-3.5 h-3.5" />;
      case 'photo': return <Icons.Camera className="w-3.5 h-3.5" />;
      case 'csv': return <Icons.FileSpreadsheet className="w-3.5 h-3.5" />;
    }
  }, []);

  // Handle completion
  const handleComplete = useCallback(() => {
    onComplete(items);
  }, [items, onComplete]);

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-arda-text-secondary">
          {stats.total} items • {stats.verified} verified
        </div>
        <button
          type="button"
          onClick={verifyAll}
          className="btn-arda-outline text-sm"
        >
          <Icons.CheckCircle2 className="w-4 h-4 mr-1.5" />
          Verify all
        </button>
      </div>

      {/* Compact Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-white/70 rounded-lg border border-arda-border p-1">
          {(['all', 'needs_attention', 'verified'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                filter === f
                  ? 'bg-arda-accent text-white'
                  : 'text-arda-text-secondary hover:bg-arda-bg-tertiary',
              ].join(' ')}
            >
              {f === 'needs_attention' ? `Attention (${stats.needsAttention})` : f === 'verified' ? `Verified (${stats.verified})` : 'All'}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-1 bg-white/70 rounded-lg border border-arda-border p-1">
          {(['all', 'email', 'barcode', 'photo', 'csv'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={[
                'px-2 py-1 rounded-md text-xs transition-colors flex items-center gap-1',
                sourceFilter === s
                  ? 'bg-orange-50 text-arda-accent'
                  : 'text-arda-text-muted hover:bg-arda-bg-tertiary',
              ].join(' ')}
              title={s === 'all' ? 'All Sources' : s}
            >
              {s === 'all' ? 'All' : (
                <>
                  {s === 'email' && <Icons.Mail className="w-3 h-3" />}
                  {s === 'barcode' && <Icons.Barcode className="w-3 h-3" />}
                  {s === 'photo' && <Icons.Camera className="w-3 h-3" />}
                  {s === 'csv' && <Icons.FileSpreadsheet className="w-3 h-3" />}
                  <span className="text-xs">{stats.bySource[s]}</span>
                </>
              )}
            </button>
          ))}
        </div>
        
        <div className="flex-1" />
        
        <div className="relative">
          <Icons.Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-arda-text-muted" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-arda pl-8 pr-3 py-1.5 text-sm bg-white w-48"
          />
        </div>
      </div>

      {/* Items Grid */}
      <div className="space-y-2">
        {filteredItems.map(item => (
          <div
            key={item.id}
            className={[
              'card-arda p-3 transition-all',
              item.needsAttention ? 'ring-1 ring-orange-300 bg-orange-50/50' : '',
              item.isVerified ? 'ring-1 ring-green-300 bg-green-50/30' : '',
            ].join(' ')}
          >
            <div className="flex gap-3">
              {/* Left: Image + Actions Stack */}
              <div className="flex flex-col items-center gap-2 flex-shrink-0">
                {/* Product Image */}
                <div className="w-16 h-16 rounded-xl bg-arda-bg-tertiary border border-arda-border overflow-hidden flex items-center justify-center">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Icons.Package className="w-6 h-6 text-arda-text-muted" />
                  )}
                </div>
                
                {/* Action Icons */}
                <div className="flex items-center gap-0.5">
                  {(item.productUrl || item.asin) && (
                    <button
                      type="button"
                      onClick={() => enrichFromProductUrl(item)}
                      className="p-1.5 text-arda-text-muted hover:text-arda-accent hover:bg-orange-50 rounded-lg transition-colors disabled:opacity-50"
                      title={enrichingIds.has(item.id) ? 'Enriching…' : 'Auto-fill from Amazon'}
                      disabled={enrichingIds.has(item.id)}
                    >
                      {enrichingIds.has(item.id) ? (
                        <Icons.Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Icons.Sparkles className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  {item.productUrl && (
                    <a
                      href={item.productUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-arda-text-muted hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Open product page"
                    >
                      <Icons.ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="p-1.5 text-arda-text-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove"
                  >
                    <Icons.Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* Middle: Main Content */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* Name Row */}
                <div className="flex items-start gap-2">
                  <span className="p-1 rounded bg-arda-bg-tertiary text-arda-accent flex-shrink-0" title={item.source}>
                    {getSourceIcon(item.source)}
                  </span>
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItemFields(item.id, { name: e.target.value })}
                    className="flex-1 bg-transparent border-0 border-b border-transparent hover:border-arda-border focus:border-arda-accent px-1 py-0.5 text-sm font-semibold text-arda-text-primary focus:outline-none focus:ring-0"
                    placeholder="Item name"
                  />
                  {item.needsAttention && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex-shrink-0">
                      Review
                    </span>
                  )}
                </div>
                
                {/* Fields Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {/* Supplier */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted block mb-0.5">Supplier</label>
                    <input
                      type="text"
                      value={item.supplier ?? ''}
                      onChange={(e) => updateItemFields(item.id, { supplier: trimOrUndefined(e.target.value) })}
                      className="w-full bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-arda-text-primary focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  {/* Location */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted block mb-0.5">Location</label>
                    <input
                      type="text"
                      value={item.location ?? ''}
                      onChange={(e) => updateItemFields(item.id, { location: trimOrUndefined(e.target.value) })}
                      className="w-full bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-arda-text-primary focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  {/* SKU */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted block mb-0.5">SKU</label>
                    <input
                      type="text"
                      value={item.sku ?? ''}
                      onChange={(e) => updateItemFields(item.id, { sku: trimOrUndefined(e.target.value) })}
                      className="w-full bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-arda-text-primary font-mono focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  {/* ASIN */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted block mb-0.5">ASIN</label>
                    <input
                      type="text"
                      value={item.asin ?? ''}
                      onChange={(e) => updateItemFields(item.id, { asin: trimOrUndefined(e.target.value) })}
                      className="w-full bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-arda-text-primary font-mono focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  {/* Barcode */}
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted block mb-0.5">Barcode</label>
                    <input
                      type="text"
                      value={item.barcode ?? ''}
                      onChange={(e) => updateItemFields(item.id, { barcode: trimOrUndefined(e.target.value) })}
                      className="w-full bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-arda-text-primary font-mono focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  {/* Color */}
                  {item.color && (
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-arda-text-muted block mb-0.5">Color</label>
                      <div className="flex items-center gap-1.5 bg-white/70 border border-arda-border rounded-md px-2 py-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-arda-accent" />
                        <span className="text-xs text-arda-text-primary">{item.color}</span>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Quantities Row - Separate columns */}
                <div className="flex items-center gap-3 pt-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted">Min</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={item.minQty ?? ''}
                      onChange={(e) => updateItemFields(item.id, { minQty: parseOptionalNumber(e.target.value) })}
                      className="w-14 bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-center text-arda-text-primary focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted">Order</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={item.orderQty ?? ''}
                      onChange={(e) => updateItemFields(item.id, { orderQty: parseOptionalNumber(e.target.value) })}
                      className="w-14 bg-white/70 border border-arda-border rounded-md px-2 py-1 text-xs text-center text-arda-text-primary focus:ring-1 focus:ring-arda-accent"
                      placeholder="—"
                    />
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] uppercase tracking-wide text-arda-text-muted">Price</label>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-arda-text-muted">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        value={item.unitPrice ?? ''}
                        onChange={(e) => updateItemFields(item.id, { unitPrice: parseOptionalNumber(e.target.value) })}
                        className="w-20 bg-white/70 border border-arda-border rounded-md pl-5 pr-2 py-1 text-xs text-arda-text-primary focus:ring-1 focus:ring-arda-accent"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  
                  <div className="flex-1" />
                  
                  {/* Verified checkbox */}
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.isVerified}
                      onChange={(e) => updateItemFields(item.id, { isVerified: e.target.checked })}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-xs text-arda-text-secondary">Verified</span>
                  </label>
                </div>
                
                {/* Error message */}
                {enrichErrorById[item.id] && (
                  <div className="text-xs text-red-600 flex items-center gap-1">
                    <Icons.AlertCircle className="w-3 h-3" />
                    {enrichErrorById[item.id]}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredItems.length === 0 && (
        <div className="card-arda p-12 text-center">
          <Icons.Package className="w-12 h-12 mx-auto text-arda-text-muted mb-4 opacity-60" />
          <h3 className="text-lg font-medium text-arda-text-primary mb-2">No Items</h3>
          <p className="text-arda-text-secondary">
            {items.length === 0
              ? 'Complete the previous steps to add items to your master list.'
              : 'No items match your current filters.'}
          </p>
        </div>
      )}

      {/* Bottom CTA */}
      <div className="sticky bottom-24 z-20">
        <div className="bg-white/90 backdrop-blur border border-arda-border rounded-xl shadow-lg p-3 flex items-center justify-between gap-4">
          <div className="text-sm text-arda-text-secondary">
            {items.length} item{items.length === 1 ? '' : 's'} ready to import
          </div>
          <button
            type="button"
            onClick={handleComplete}
            disabled={items.length === 0}
            className={[
              'flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all',
              items.length > 0
                ? 'bg-green-600 text-white hover:bg-green-700 shadow-md'
                : 'bg-arda-border text-arda-text-muted cursor-not-allowed',
            ].join(' ')}
          >
            <Icons.ArrowRight className="w-4 h-4" />
            Add to Arda
          </button>
        </div>
      </div>
    </div>
  );
};
