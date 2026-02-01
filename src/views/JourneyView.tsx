import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ExtractedOrder, InventoryItem, RawEmail, LineItemNodeData, ItemVelocityProfile } from '../types';
import { OrderTree } from '../components/OrderTree';
import { Icons } from '../components/Icons';
import { buildVelocityProfiles } from '../utils/inventoryLogic';

interface JourneyViewProps {
  orders: ExtractedOrder[];
  inventory: InventoryItem[];
  emails?: RawEmail[];
  onReorder?: (item: InventoryItem) => void;
}

// CSV Helper Functions
const velocityToCSV = (profiles: Map<string, ItemVelocityProfile>): string => {
  const headers = [
    'Item Name',
    'Supplier',
    'SKU',
    'Total Quantity Ordered',
    'Order Count',
    'Average Cadence (Days)',
    'Daily Burn Rate',
    'First Order Date',
    'Last Order Date',
    'Next Predicted Order',
    'Recommended Min Qty',
    'Recommended Order Qty'
  ];

  const rows = Array.from(profiles.values()).map(profile => [
    escapeCSV(profile.displayName),
    escapeCSV(profile.supplier),
    escapeCSV(profile.sku || ''),
    profile.totalQuantityOrdered.toString(),
    profile.orderCount.toString(),
    profile.averageCadenceDays.toFixed(2),
    profile.dailyBurnRate.toFixed(2),
    profile.firstOrderDate,
    profile.lastOrderDate,
    profile.nextPredictedOrder || '',
    profile.recommendedMin.toString(),
    profile.recommendedOrderQty.toString()
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
};

const ordersToCSV = (orders: ExtractedOrder[]): string => {
  const headers = [
    'Order ID',
    'Email ID',
    'Supplier',
    'Order Date',
    'Total Amount',
    'Confidence',
    'Item Name',
    'Normalized Name',
    'SKU',
    'Quantity',
    'Unit',
    'Unit Price',
    'Total Price'
  ];

  const rows: string[] = [];
  orders.forEach(order => {
    if (order.items.length === 0) {
      // Include order even if no items
      rows.push([
        escapeCSV(order.id),
        escapeCSV(order.originalEmailId),
        escapeCSV(order.supplier),
        order.orderDate,
        order.totalAmount?.toString() || '',
        order.confidence.toString(),
        '', '', '', '', '', '', ''
      ].join(','));
    } else {
      order.items.forEach(item => {
        rows.push([
          escapeCSV(order.id),
          escapeCSV(order.originalEmailId),
          escapeCSV(order.supplier),
          order.orderDate,
          order.totalAmount?.toString() || '',
          order.confidence.toString(),
          escapeCSV(item.name),
          escapeCSV(item.normalizedName || ''),
          escapeCSV(item.sku || ''),
          item.quantity.toString(),
          escapeCSV(item.unit),
          item.unitPrice?.toString() || '',
          item.totalPrice?.toString() || ''
        ].join(','));
      });
    }
  });

  return [headers.join(','), ...rows].join('\n');
};

const recommendationsToCSV = (profiles: Map<string, ItemVelocityProfile>): string => {
  const headers = [
    'Item Name',
    'Supplier',
    'SKU',
    'Daily Burn Rate',
    'Average Cadence (Days)',
    'Recommended Min Qty (Reorder Point)',
    'Recommended Order Qty (EOQ)',
    'Next Predicted Order Date'
  ];

  const rows = Array.from(profiles.values()).map(profile => [
    escapeCSV(profile.displayName),
    escapeCSV(profile.supplier),
    escapeCSV(profile.sku || ''),
    profile.dailyBurnRate.toFixed(2),
    profile.averageCadenceDays.toFixed(2),
    profile.recommendedMin.toString(),
    profile.recommendedOrderQty.toString(),
    profile.nextPredictedOrder || ''
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
};

const escapeCSV = (value: string | undefined): string => {
  if (!value) return '';
  const stringValue = String(value);
  // If contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const downloadCSV = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
};

export const JourneyView: React.FC<JourneyViewProps> = ({
  orders,
  inventory,
  emails,
  onReorder,
}) => {
  const [selectedItem, setSelectedItem] = useState<LineItemNodeData | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  
  // Build velocity profiles for the selected item panel
  const velocityProfiles = useMemo(() => 
    buildVelocityProfiles(orders),
    [orders]
  );

  const handleItemClick = (itemData: LineItemNodeData) => {
    setSelectedItem(itemData);
  };

  const getVelocityProfile = (normalizedName: string): ItemVelocityProfile | undefined => {
    return velocityProfiles.get(normalizedName);
  };

  const selectedProfile = selectedItem ? getVelocityProfile(selectedItem.normalizedName) : undefined;

  // Find matching inventory item for reorder
  const matchingInventoryItem = selectedItem 
    ? inventory.find(i => i.name.toLowerCase().trim() === selectedItem.normalizedName)
    : undefined;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setExportDropdownOpen(false);
      }
    };

    if (exportDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [exportDropdownOpen]);

  // Export handlers
  const handleExportVelocity = () => {
    const csv = velocityToCSV(velocityProfiles);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `velocity_data_${dateStr}.csv`);
    setExportDropdownOpen(false);
  };

  const handleExportOrders = () => {
    const csv = ordersToCSV(orders);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `order_history_${dateStr}.csv`);
    setExportDropdownOpen(false);
  };

  const handleExportRecommendations = () => {
    const csv = recommendationsToCSV(velocityProfiles);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCSV(csv, `recommendations_${dateStr}.csv`);
    setExportDropdownOpen(false);
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      {/* Header with Export Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Order Journey</h2>
        <div className="relative" ref={exportDropdownRef}>
          <button
            onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
          >
            <Icons.Download className="w-4 h-4" />
            <span>Export</span>
            <Icons.ChevronDown className={`w-4 h-4 transition-transform ${exportDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {exportDropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-slate-200 z-50">
              <div className="py-1">
                <button
                  onClick={handleExportVelocity}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Export Velocity Data (CSV)
                </button>
                <button
                  onClick={handleExportOrders}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Export Order History (CSV)
                </button>
                <button
                  onClick={handleExportRecommendations}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Export Recommendations (CSV)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex gap-6 flex-1 min-h-0">
      {/* Main Tree View */}
      <div className="flex-1 min-w-0">
        <OrderTree
          orders={orders}
          emails={emails}
          onItemClick={handleItemClick}
          className="h-full"
        />
      </div>

      {/* Item Detail Panel */}
      {selectedItem && selectedProfile && (
        <div className="w-96 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-white truncate">
                {selectedProfile.displayName}
              </h3>
              <p className="text-sm text-slate-400 mt-1">
                {selectedProfile.supplier}
              </p>
              {selectedProfile.sku && (
                <span className="inline-block mt-2 px-2 py-0.5 bg-slate-800 text-slate-300 text-xs rounded">
                  SKU: {selectedProfile.sku}
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedItem(null)}
              className="p-1 text-slate-500 hover:text-white transition-colors"
              aria-label="Close panel"
            >
              <Icons.X className="w-5 h-5" />
            </button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-3 p-4 border-b border-slate-800">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-orange-400">
                {selectedProfile.dailyBurnRate.toFixed(1)}
              </div>
              <div className="text-xs text-slate-500 mt-1">Units/Day</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-blue-400">
                {Math.round(selectedProfile.averageCadenceDays)}
              </div>
              <div className="text-xs text-slate-500 mt-1">Avg Days Between Orders</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-400">
                {selectedProfile.totalQuantityOrdered}
              </div>
              <div className="text-xs text-slate-500 mt-1">Total Ordered</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-2xl font-bold text-purple-400">
                {selectedProfile.orderCount}
              </div>
              <div className="text-xs text-slate-500 mt-1">Orders Placed</div>
            </div>
          </div>

          {/* Recommendations */}
          <div className="p-4 border-b border-slate-800">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Kanban Recommendations</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Min Qty (Reorder Point)</span>
                <span className="font-medium text-white">{selectedProfile.recommendedMin}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Order Qty (EOQ)</span>
                <span className="font-medium text-white">{selectedProfile.recommendedOrderQty}</span>
              </div>
              {selectedProfile.nextPredictedOrder && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Next Predicted Order</span>
                  <span className="font-medium text-yellow-400">
                    {new Date(selectedProfile.nextPredictedOrder).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Order History */}
          <div className="flex-1 overflow-y-auto p-4">
            <h4 className="text-sm font-medium text-slate-300 mb-3">Order History</h4>
            <div className="space-y-2">
              {selectedProfile.orders
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((order, idx) => (
                  <div 
                    key={`${order.orderId}-${idx}`}
                    className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg"
                  >
                    <div>
                      <div className="text-sm text-white">
                        {new Date(order.date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                      <div className="text-xs text-slate-500">
                        Order #{order.orderId.substring(0, 8)}...
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-white">
                        Qty: {order.quantity}
                      </div>
                      {order.unitPrice && (
                        <div className="text-xs text-slate-500">
                          @ ${order.unitPrice.toFixed(2)}/ea
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="p-4 border-t border-slate-800 space-y-2">
            {matchingInventoryItem && onReorder && (
              <button
                onClick={() => onReorder(matchingInventoryItem)}
                className="w-full bg-arda-accent hover:bg-arda-accent-hover text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Icons.Send className="w-4 h-4" />
                Create Reorder Email
              </button>
            )}
            <button
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Icons.Upload className="w-4 h-4" />
              Push to Arda
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default JourneyView;
