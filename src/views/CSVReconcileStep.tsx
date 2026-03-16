import { useState, useEffect, useMemo, useRef } from 'react';
import { Icons } from '../components/Icons';
import { InventoryItem } from '../types';
import { ScannedBarcode, CapturedPhoto, ReconciliationItem } from './OnboardingFlow';

interface CSVReconcileStepProps {
  emailItems: InventoryItem[];
  scannedBarcodes: ScannedBarcode[];
  capturedPhotos: CapturedPhoto[];
  onComplete: (items: ReconciliationItem[]) => void;
  onBack: () => void;
}

// CSV column mapping options
interface ColumnMapping {
  name?: string;
  sku?: string;
  barcode?: string;
  supplier?: string;
  location?: string;
  minQty?: string;
  orderQty?: string;
  unitPrice?: string;
}

export const CSVReconcileStep: React.FC<CSVReconcileStepProps> = ({
  emailItems,
  scannedBarcodes,
  capturedPhotos,
  onComplete,
  onBack,
}) => {
  // CSV state
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [showMappingModal, setShowMappingModal] = useState(false);
  
  // Reconciliation state
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'duplicates' | 'needs_review' | 'approved'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Push to Arda state
  const [isPushing, setIsPushing] = useState(false);
  const [pushProgress, setPushProgress] = useState({ current: 0, total: 0 });
  const [pushError, setPushError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build initial reconciliation items from all sources
  useEffect(() => {
    const items: ReconciliationItem[] = [];
    
    // Add email items
    emailItems.forEach(item => {
      items.push({
        id: `email-${item.id}`,
        source: 'email',
        name: item.name,
        normalizedName: item.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        supplier: item.supplier,
        location: item.location,
        barcode: item.amazonEnriched?.upc,
        asin: item.asin,
        quantity: item.totalQuantityOrdered,
        minQty: item.recommendedMin,
        orderQty: item.recommendedOrderQty,
        unitPrice: item.lastPrice,
        imageUrl: item.imageUrl,
        productUrl: item.productUrl,
        isApproved: false,
        needsReview: false,
      });
    });
    
    // Add scanned barcodes
    scannedBarcodes.forEach(barcode => {
      items.push({
        id: `barcode-${barcode.id}`,
        source: 'barcode',
        name: barcode.productName || `Unknown (${barcode.barcode})`,
        normalizedName: (barcode.productName || barcode.barcode).toLowerCase().replace(/[^a-z0-9]/g, ''),
        barcode: barcode.barcode,
        imageUrl: barcode.imageUrl,
        isApproved: false,
        needsReview: !barcode.productName,
      });
    });
    
    // Add photo-captured items
    capturedPhotos.forEach(photo => {
      if (photo.suggestedName) {
        items.push({
          id: `photo-${photo.id}`,
          source: 'photo',
          name: photo.suggestedName,
          normalizedName: photo.suggestedName.toLowerCase().replace(/[^a-z0-9]/g, ''),
          supplier: photo.suggestedSupplier,
          barcode: photo.detectedBarcodes?.[0],
          imageUrl: photo.imageData,
          isApproved: false,
          needsReview: true,
        });
      }
    });
    
    // Find duplicates using normalized names
    const nameMap = new Map<string, string[]>();
    items.forEach(item => {
      if (item.normalizedName) {
        const existing = nameMap.get(item.normalizedName) || [];
        nameMap.set(item.normalizedName, [...existing, item.id]);
      }
    });
    
    // Mark duplicates
    nameMap.forEach((ids) => {
      if (ids.length > 1) {
        ids.slice(1).forEach(id => {
          const item = items.find(i => i.id === id);
          if (item) {
            item.isDuplicate = true;
            item.duplicateOf = ids[0];
            item.needsReview = true;
          }
        });
      }
    });
    
    setReconciliationItems(items);
  }, [emailItems, scannedBarcodes, capturedPhotos]);

  // Handle CSV file upload
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      parseCSV(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Parse CSV text
  const parseCSV = (text: string) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return;
    
    // Parse headers
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    setCsvHeaders(headers);
    
    // Parse data rows
    const data: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      data.push(row);
    }
    
    setCsvData(data);
    
    // Auto-detect column mappings
    const mapping: ColumnMapping = {};
    headers.forEach(header => {
      const lower = header.toLowerCase();
      if (lower.includes('name') || lower.includes('item') || lower.includes('product')) {
        mapping.name = header;
      } else if (lower.includes('sku') || lower.includes('part')) {
        mapping.sku = header;
      } else if (lower.includes('barcode') || lower.includes('upc') || lower.includes('ean')) {
        mapping.barcode = header;
      } else if (lower.includes('supplier') || lower.includes('vendor')) {
        mapping.supplier = header;
      } else if (lower.includes('location') || lower.includes('bin')) {
        mapping.location = header;
      } else if (lower.includes('min') && lower.includes('qty')) {
        mapping.minQty = header;
      } else if (lower.includes('order') && lower.includes('qty')) {
        mapping.orderQty = header;
      } else if (lower.includes('price') || lower.includes('cost')) {
        mapping.unitPrice = header;
      }
    });
    
    setColumnMapping(mapping);
    setShowMappingModal(true);
  };

  // Apply CSV data with mapping
  const applyCSVMapping = () => {
    const newItems: ReconciliationItem[] = csvData.map((row, index) => ({
      id: `csv-${index}`,
      source: 'csv' as const,
      name: row[columnMapping.name || ''] || `Row ${index + 1}`,
      normalizedName: (row[columnMapping.name || ''] || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
      sku: row[columnMapping.sku || ''],
      barcode: row[columnMapping.barcode || ''],
      supplier: row[columnMapping.supplier || ''],
      location: row[columnMapping.location || ''],
      minQty: columnMapping.minQty ? parseFloat(row[columnMapping.minQty]) || undefined : undefined,
      orderQty: columnMapping.orderQty ? parseFloat(row[columnMapping.orderQty]) || undefined : undefined,
      unitPrice: columnMapping.unitPrice ? parseFloat(row[columnMapping.unitPrice]) || undefined : undefined,
      isApproved: false,
      needsReview: true,
    }));
    
    // Merge with existing items
    setReconciliationItems(prev => {
      const combined = [...prev, ...newItems];
      
      // Re-detect duplicates
      const nameMap = new Map<string, string[]>();
      combined.forEach(item => {
        if (item.normalizedName) {
          const existing = nameMap.get(item.normalizedName) || [];
          nameMap.set(item.normalizedName, [...existing, item.id]);
        }
      });
      
      nameMap.forEach((ids) => {
        if (ids.length > 1) {
          ids.slice(1).forEach(id => {
            const item = combined.find(i => i.id === id);
            if (item) {
              item.isDuplicate = true;
              item.duplicateOf = ids[0];
              item.needsReview = true;
            }
          });
        }
      });
      
      return combined;
    });
    
    setShowMappingModal(false);
    setCsvData([]);
  };

  // Filter items
  const filteredItems = useMemo(() => {
    let items = reconciliationItems;
    
    // Apply filter
    switch (filter) {
      case 'duplicates':
        items = items.filter(i => i.isDuplicate);
        break;
      case 'needs_review':
        items = items.filter(i => i.needsReview && !i.isExcluded);
        break;
      case 'approved':
        items = items.filter(i => i.isApproved);
        break;
    }
    
    // Apply search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      items = items.filter(i => 
        i.name.toLowerCase().includes(query) ||
        i.sku?.toLowerCase().includes(query) ||
        i.barcode?.includes(query) ||
        i.supplier?.toLowerCase().includes(query)
      );
    }
    
    return items;
  }, [reconciliationItems, filter, searchQuery]);

  // Toggle item selection
  const toggleSelection = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Bulk approve selected
  const approveSelected = () => {
    setReconciliationItems(prev => 
      prev.map(item => 
        selectedItems.has(item.id) 
          ? { ...item, isApproved: true, needsReview: false }
          : item
      )
    );
    setSelectedItems(new Set());
  };

  // Bulk exclude selected
  const excludeSelected = () => {
    setReconciliationItems(prev =>
      prev.map(item =>
        selectedItems.has(item.id)
          ? { ...item, isExcluded: true, needsReview: false }
          : item
      )
    );
    setSelectedItems(new Set());
  };

  // Merge duplicate with original
  const mergeDuplicate = (duplicateId: string) => {
    const duplicate = reconciliationItems.find(i => i.id === duplicateId);
    if (!duplicate?.duplicateOf) return;
    
    setReconciliationItems(prev => {
      // Find original and merge data
      return prev.map(item => {
        if (item.id === duplicate.duplicateOf) {
          return {
            ...item,
            barcode: item.barcode || duplicate.barcode,
            sku: item.sku || duplicate.sku,
            imageUrl: item.imageUrl || duplicate.imageUrl,
            location: item.location || duplicate.location,
          };
        }
        if (item.id === duplicateId) {
          return { ...item, isExcluded: true, needsReview: false };
        }
        return item;
      });
    });
  };

  // Update single item
  const updateItem = (id: string, updates: Partial<ReconciliationItem>) => {
    setReconciliationItems(prev =>
      prev.map(item => item.id === id ? { ...item, ...updates } : item)
    );
  };

  // Push to Arda
  const pushToArda = async () => {
    const itemsToPush = reconciliationItems.filter(i => i.isApproved && !i.isExcluded);
    if (itemsToPush.length === 0) return;
    
    setIsPushing(true);
    setPushProgress({ current: 0, total: itemsToPush.length });
    setPushError(null);
    
    try {
      for (let i = 0; i < itemsToPush.length; i++) {
        const item = itemsToPush[i];
        
        await fetch('/api/arda/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: item.name,
            sku: item.sku,
            barcode: item.barcode,
            supplier: item.supplier,
            location: item.location,
            minQty: item.minQty,
            orderQty: item.orderQty,
            unitPrice: item.unitPrice,
            imageUrl: item.imageUrl,
            productUrl: item.productUrl,
          }),
        });
        
        setPushProgress({ current: i + 1, total: itemsToPush.length });
      }
      
      onComplete(itemsToPush);
    } catch (error) {
      setPushError(error instanceof Error ? error.message : 'Failed to push items to Arda');
    } finally {
      setIsPushing(false);
    }
  };

  // Stats
  const stats = useMemo(() => ({
    total: reconciliationItems.length,
    approved: reconciliationItems.filter(i => i.isApproved).length,
    duplicates: reconciliationItems.filter(i => i.isDuplicate).length,
    needsReview: reconciliationItems.filter(i => i.needsReview && !i.isExcluded).length,
    excluded: reconciliationItems.filter(i => i.isExcluded).length,
  }), [reconciliationItems]);

  // Source badge
  const getSourceBadge = (source: ReconciliationItem['source']) => {
    switch (source) {
      case 'email':
        return <span className="rounded px-1.5 py-0.5 text-xs bg-arda-info-soft text-arda-info-text">📧 Email</span>;
      case 'barcode':
        return <span className="rounded px-1.5 py-0.5 text-xs bg-arda-success-soft text-arda-success-text">📊 Barcode</span>;
      case 'photo':
        return <span className="rounded px-1.5 py-0.5 text-xs bg-arda-bg-secondary text-arda-text-secondary">📷 Photo</span>;
      case 'csv':
        return <span className="rounded px-1.5 py-0.5 text-xs bg-arda-warning-soft text-arda-warning-text">📄 CSV</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-arda-text-primary">Review & Push to Arda</h1>
          <p className="mt-1 text-arda-text-muted">
            Deduplicate, reconcile fields, and sync items to your Arda inventory
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-arda-text-secondary hover:text-arda-text-primary transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={pushToArda}
            disabled={isPushing || stats.approved === 0}
            className="btn-arda-primary px-6 py-2 rounded-lg flex items-center gap-2 disabled:bg-arda-border disabled:text-white disabled:cursor-not-allowed"
          >
            {isPushing ? (
              <>
                <Icons.Loader2 className="w-4 h-4 animate-spin" />
                Pushing...
              </>
            ) : (
              <>
                <Icons.Upload className="w-4 h-4" />
                Push to Arda ({stats.approved})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-4">
        <button
          onClick={() => setFilter('all')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            filter === 'all' ? 'border-arda-info-border bg-arda-info-bg' : 'border-arda-border bg-white hover:border-arda-border-hover'
          }`}
        >
          <div className="text-2xl font-bold text-arda-text-primary">{stats.total}</div>
          <div className="text-sm text-arda-text-muted">Total Items</div>
        </button>
        <button
          onClick={() => setFilter('duplicates')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            filter === 'duplicates' ? 'border-arda-warning-border bg-arda-warning-bg' : 'border-arda-border bg-white hover:border-arda-border-hover'
          }`}
        >
          <div className="text-2xl font-bold text-arda-warning-text">{stats.duplicates}</div>
          <div className="text-sm text-arda-text-muted">Duplicates</div>
        </button>
        <button
          onClick={() => setFilter('needs_review')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            filter === 'needs_review' ? 'border-arda-warning-border bg-arda-warning-bg' : 'border-arda-border bg-white hover:border-arda-border-hover'
          }`}
        >
          <div className="text-2xl font-bold text-arda-warning-text">{stats.needsReview}</div>
          <div className="text-sm text-arda-text-muted">Needs Review</div>
        </button>
        <button
          onClick={() => setFilter('approved')}
          className={`p-4 rounded-lg border-2 transition-colors ${
            filter === 'approved' ? 'border-arda-success-border bg-arda-success-bg' : 'border-arda-border bg-white hover:border-arda-border-hover'
          }`}
        >
          <div className="text-2xl font-bold text-arda-success-text">{stats.approved}</div>
          <div className="text-sm text-arda-text-muted">Approved</div>
        </button>
        <div className="rounded-lg border-2 border-arda-border bg-white p-4">
          <div className="text-2xl font-bold text-arda-text-muted">{stats.excluded}</div>
          <div className="text-sm text-arda-text-muted">Excluded</div>
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-4 rounded-lg border border-arda-border bg-white p-4">
        <div className="flex-1 relative">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-arda-text-muted" />
          <input
            type="text"
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-arda-border py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-arda-info"
          />
        </div>
        
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-arda-outline px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <Icons.Upload className="w-4 h-4" />
          Upload CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleCSVUpload}
          className="hidden"
          aria-label="Upload CSV file"
        />
        
        {selectedItems.size > 0 && (
          <>
            <div className="h-6 w-px bg-arda-border" />
            <span className="text-sm text-arda-text-muted">{selectedItems.size} selected</span>
            <button
              onClick={approveSelected}
              className="rounded-lg bg-arda-success-soft px-3 py-1.5 text-sm font-medium text-arda-success-text hover:bg-arda-success-border"
            >
              Approve
            </button>
            <button
              onClick={excludeSelected}
              className="rounded-lg bg-arda-danger-soft px-3 py-1.5 text-sm font-medium text-arda-danger-text hover:bg-arda-danger-border"
            >
              Exclude
            </button>
          </>
        )}
      </div>

      {/* Items table */}
      <div className="overflow-hidden rounded-xl border border-arda-border bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-arda-border bg-arda-bg-secondary">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedItems.size === filteredItems.length && filteredItems.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedItems(new Set(filteredItems.map(i => i.id)));
                      } else {
                        setSelectedItems(new Set());
                      }
                    }}
                    className="rounded"
                    aria-label="Select all items"
                    title="Select all items"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Item</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Barcode</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Location</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Min/Order Qty</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-arda-text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arda-border">
              {filteredItems.map((item) => (
                <tr 
                  key={item.id} 
                  className={`
                    hover:bg-arda-bg-secondary transition-colors
                    ${item.isExcluded ? 'opacity-50 bg-arda-bg-secondary' : ''}
                    ${item.isDuplicate ? 'bg-arda-warning-bg' : ''}
                  `}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleSelection(item.id)}
                      disabled={item.isExcluded}
                      className="rounded"
                      aria-label={`Select ${item.name}`}
                      title={`Select ${item.name}`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.imageUrl && (
                        <img 
                          src={item.imageUrl} 
                          alt="" 
                          className="w-10 h-10 rounded object-cover"
                        />
                      )}
                      <div>
                        <p className="font-medium text-arda-text-primary">{item.name}</p>
                        {item.sku && <p className="text-xs text-arda-text-muted">SKU: {item.sku}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{getSourceBadge(item.source)}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-arda-text-secondary">{item.barcode || '-'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-arda-text-secondary">{item.supplier || '-'}</td>
                  <td className="px-4 py-3 text-sm text-arda-text-secondary">{item.location || '-'}</td>
                  <td className="px-4 py-3 text-sm text-arda-text-secondary">
                    {item.minQty || item.orderQty ? `${item.minQty || '-'} / ${item.orderQty || '-'}` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {item.isExcluded ? (
                      <span className="rounded px-2 py-0.5 text-xs bg-arda-bg-secondary text-arda-text-muted">Excluded</span>
                    ) : item.isApproved ? (
                      <span className="rounded px-2 py-0.5 text-xs bg-arda-success-soft text-arda-success-text">Approved</span>
                    ) : item.isDuplicate ? (
                      <span className="rounded px-2 py-0.5 text-xs bg-arda-warning-soft text-arda-warning-text">Duplicate</span>
                    ) : item.needsReview ? (
                      <span className="rounded px-2 py-0.5 text-xs bg-arda-warning-soft text-arda-warning-text">Review</span>
                    ) : (
                      <span className="rounded px-2 py-0.5 text-xs bg-arda-bg-secondary text-arda-text-muted">Pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {item.isDuplicate && !item.isExcluded && (
                        <button
                          onClick={() => mergeDuplicate(item.id)}
                          title="Merge with original"
                          className="rounded p-1.5 text-arda-warning-text hover:bg-arda-warning-soft"
                        >
                          <Icons.GitMerge className="w-4 h-4" />
                        </button>
                      )}
                      {!item.isApproved && !item.isExcluded && (
                        <button
                          onClick={() => updateItem(item.id, { isApproved: true, needsReview: false })}
                          title="Approve"
                          className="rounded p-1.5 text-arda-success-text hover:bg-arda-success-soft"
                        >
                          <Icons.Check className="w-4 h-4" />
                        </button>
                      )}
                      {!item.isExcluded && (
                        <button
                          onClick={() => updateItem(item.id, { isExcluded: true, needsReview: false })}
                          title="Exclude"
                          className="rounded p-1.5 text-arda-danger-text hover:bg-arda-danger-soft"
                        >
                          <Icons.X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredItems.length === 0 && (
          <div className="px-6 py-12 text-center text-arda-text-muted">
            <Icons.Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No items match your filter</p>
          </div>
        )}
      </div>

      {/* CSV Mapping Modal */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="mx-4 w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-arda-text-primary">Map CSV Columns</h3>
            <p className="text-sm text-arda-text-muted">
              Match your CSV columns to the item fields. {csvData.length} rows detected.
            </p>
            
            <div className="space-y-3">
              {[
                { key: 'name', label: 'Item Name *' },
                { key: 'sku', label: 'SKU/Part Number' },
                { key: 'barcode', label: 'Barcode (UPC/EAN)' },
                { key: 'supplier', label: 'Supplier' },
                { key: 'location', label: 'Location' },
                { key: 'minQty', label: 'Min Quantity' },
                { key: 'orderQty', label: 'Order Quantity' },
                { key: 'unitPrice', label: 'Unit Price' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-4">
                  <label htmlFor={`mapping-${key}`} className="w-32 text-sm text-arda-text-secondary">{label}</label>
                  <select
                    id={`mapping-${key}`}
                    value={columnMapping[key as keyof ColumnMapping] || ''}
                    onChange={(e) => setColumnMapping(prev => ({ ...prev, [key]: e.target.value || undefined }))}
                    className="flex-1 rounded-lg border border-arda-border px-3 py-2"
                    aria-label={`Select column for ${label}`}
                  >
                    <option value="">-- Select column --</option>
                    {csvHeaders.map(header => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            
            <div className="flex justify-end gap-3 pt-4">
              <button
                onClick={() => { setShowMappingModal(false); setCsvData([]); }}
                className="px-4 py-2 text-arda-text-secondary hover:text-arda-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={applyCSVMapping}
                disabled={!columnMapping.name}
                className="btn-arda-primary rounded-lg px-4 py-2 disabled:bg-arda-border disabled:text-white"
              >
                Import {csvData.length} Items
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push progress */}
      {isPushing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
            <Icons.Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-arda-info" />
            <p className="text-lg font-medium text-arda-text-primary">Pushing to Arda...</p>
            <p className="mt-1 text-arda-text-muted">
              {pushProgress.current} of {pushProgress.total} items
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-arda-bg-secondary">
              <div 
                className="h-full bg-arda-info transition-all"
                style={{ width: `${(pushProgress.current / pushProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Push error */}
      {pushError && (
        <div className="flex items-center gap-3 rounded-lg border border-arda-danger-border bg-arda-danger-bg px-4 py-3">
          <Icons.AlertCircle className="w-5 h-5 text-arda-danger" />
          <span className="text-arda-danger-text">{pushError}</span>
          <button 
            onClick={() => setPushError(null)} 
            className="ml-auto text-arda-danger hover:text-arda-danger-text"
            aria-label="Dismiss error"
            title="Dismiss error"
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
