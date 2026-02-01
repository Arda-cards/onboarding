import React, { useState, useMemo } from 'react';
import { ExtractedOrder, InventoryItem, RawEmail, LineItemNodeData, ItemVelocityProfile } from '../types';
import { Icons } from '../components/Icons';
import { buildVelocityProfiles, buildJourneyTree } from '../utils/inventoryLogic';
import { exportVelocityToCSV, exportOrdersToCSV } from '../utils/exportUtils';
import { VelocityBadge } from '../components/VelocityBadge';

interface JourneyViewProps {
  orders: ExtractedOrder[];
  inventory: InventoryItem[];
  emails?: RawEmail[];
  onReorder?: (item: InventoryItem) => void;
}

type ViewMode = 'timeline' | 'suppliers' | 'items';

export const JourneyView: React.FC<JourneyViewProps> = ({
  orders,
  inventory,
  emails,
  onReorder,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<LineItemNodeData | null>(null);

  // Build velocity profiles
  const velocityProfiles = useMemo(() => buildVelocityProfiles(orders), [orders]);
  const journeyTree = useMemo(() => buildJourneyTree(orders, emails), [orders, emails]);

  // Get selected item's profile
  const selectedProfile = selectedItem 
    ? velocityProfiles.get(selectedItem.normalizedName) 
    : undefined;

  // Find matching inventory item for reorder
  const matchingInventoryItem = selectedItem 
    ? inventory.find(i => i.name.toLowerCase().trim() === selectedItem.normalizedName)
    : undefined;

  // Stats
  const stats = useMemo(() => {
    const suppliers = new Set<string>();
    let totalItems = 0;
    orders.forEach(o => {
      suppliers.add(o.supplier);
      totalItems += o.items.length;
    });
    return {
      orders: orders.length,
      suppliers: suppliers.size,
      items: totalItems,
      uniqueItems: velocityProfiles.size,
    };
  }, [orders, velocityProfiles]);

  // Group orders by supplier
  const ordersBySupplier = useMemo(() => {
    const map = new Map<string, ExtractedOrder[]>();
    orders.forEach(order => {
      const list = map.get(order.supplier) || [];
      list.push(order);
      map.set(order.supplier, list);
    });
    // Sort suppliers by order count
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length);
  }, [orders]);

  // Filter based on search
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase();
    return orders.filter(o => 
      o.supplier.toLowerCase().includes(q) ||
      o.items.some(i => i.name.toLowerCase().includes(q))
    );
  }, [orders, searchQuery]);

  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return Array.from(velocityProfiles.values());
    const q = searchQuery.toLowerCase();
    return Array.from(velocityProfiles.values()).filter(p =>
      p.displayName.toLowerCase().includes(q) ||
      p.supplier.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q)
    );
  }, [velocityProfiles, searchQuery]);

  const toggleSupplier = (supplier: string) => {
    setExpandedSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(supplier)) {
        next.delete(supplier);
      } else {
        next.add(supplier);
      }
      return next;
    });
  };

  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const handleItemClick = (item: LineItemNodeData) => {
    setSelectedItem(item);
  };

  const handleExportOrders = () => exportOrdersToCSV(orders);
  const handleExportItems = () => exportVelocityToCSV(Array.from(velocityProfiles.values()));

  // Empty state
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-12rem)] text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
          <Icons.GitBranch className="w-8 h-8 text-slate-600" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">No Orders Yet</h2>
        <p className="text-slate-400 max-w-md">
          Run the ingestion engine to process your emails and see your complete order journey here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-6">
      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Order Journey</h1>
            <p className="text-slate-400 text-sm mt-1">
              Trace the flow from suppliers to orders to items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportOrders}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              <Icons.Download className="w-4 h-4" />
              Orders
            </button>
            <button
              onClick={handleExportItems}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              <Icons.Download className="w-4 h-4" />
              Items
            </button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Icons.Building2 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.suppliers}</div>
                <div className="text-xs text-slate-500">Suppliers</div>
              </div>
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Icons.Package className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.orders}</div>
                <div className="text-xs text-slate-500">Orders</div>
              </div>
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Icons.Box className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.items}</div>
                <div className="text-xs text-slate-500">Line Items</div>
              </div>
            </div>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <Icons.Activity className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{stats.uniqueItems}</div>
                <div className="text-xs text-slate-500">Unique Items</div>
              </div>
            </div>
          </div>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-4 mb-4">
          {/* View Mode Toggle */}
          <div className="flex bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-arda-accent text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              By Date
            </button>
            <button
              onClick={() => setViewMode('suppliers')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'suppliers'
                  ? 'bg-arda-accent text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              By Supplier
            </button>
            <button
              onClick={() => setViewMode('items')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'items'
                  ? 'bg-arda-accent text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              By Item
            </button>
          </div>

          {/* Search */}
          <div className="flex-1 relative">
            <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search orders, suppliers, items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-10 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-arda-accent focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-900/50 rounded-xl border border-slate-800 p-4">
          {viewMode === 'timeline' && (
            <TimelineView 
              orders={filteredOrders}
              expandedOrders={expandedOrders}
              toggleOrder={toggleOrder}
              onItemClick={handleItemClick}
              velocityProfiles={velocityProfiles}
            />
          )}
          {viewMode === 'suppliers' && (
            <SupplierView
              ordersBySupplier={ordersBySupplier}
              expandedSuppliers={expandedSuppliers}
              expandedOrders={expandedOrders}
              toggleSupplier={toggleSupplier}
              toggleOrder={toggleOrder}
              onItemClick={handleItemClick}
              velocityProfiles={velocityProfiles}
              searchQuery={searchQuery}
            />
          )}
          {viewMode === 'items' && (
            <ItemsView
              profiles={filteredProfiles}
              onItemClick={handleItemClick}
              selectedItem={selectedItem}
            />
          )}
        </div>
      </div>

      {/* Detail Panel */}
      {selectedItem && selectedProfile && (
        <div className="w-96 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          {/* Header with Amazon Image */}
          <div className="p-5 border-b border-slate-800">
            <div className="flex items-start gap-4">
              {/* Product Image from Amazon or placeholder */}
              {selectedProfile.imageUrl ? (
                <img 
                  src={selectedProfile.imageUrl}
                  alt=""
                  className="w-20 h-20 rounded-lg object-contain bg-white flex-shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <Icons.Package className="w-8 h-8 text-purple-400" />
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-white leading-tight">
                    {selectedProfile.displayName}
                  </h3>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="p-1 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-slate-400 mt-1">{selectedProfile.supplier}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedProfile.sku && (
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-xs rounded font-mono">
                      SKU: {selectedProfile.sku}
                    </span>
                  )}
                  {selectedProfile.asin && (
                    <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded font-mono">
                      ASIN: {selectedProfile.asin}
                    </span>
                  )}
                </div>
                {selectedProfile.amazonUrl && (
                  <a 
                    href={selectedProfile.amazonUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-blue-400 hover:underline"
                  >
                    View on Amazon <Icons.ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 p-5 border-b border-slate-800">
            <StatCard 
              value={selectedProfile.dailyBurnRate.toFixed(1)} 
              label="Units/Day" 
              color="orange" 
            />
            <StatCard 
              value={Math.round(selectedProfile.averageCadenceDays).toString()} 
              label="Days Between Orders" 
              color="blue" 
            />
            <StatCard 
              value={selectedProfile.totalQuantityOrdered.toString()} 
              label="Total Ordered" 
              color="green" 
            />
            <StatCard 
              value={selectedProfile.orderCount.toString()} 
              label="Orders Placed" 
              color="purple" 
            />
          </div>

          {/* Recommendations */}
          <div className="p-5 border-b border-slate-800">
            <h4 className="text-sm font-medium text-white mb-3">Kanban Settings</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Min Qty (Reorder Point)</span>
                <span className="text-sm font-semibold text-white bg-slate-800 px-2 py-1 rounded">
                  {selectedProfile.recommendedMin}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Order Qty</span>
                <span className="text-sm font-semibold text-white bg-slate-800 px-2 py-1 rounded">
                  {selectedProfile.recommendedOrderQty}
                </span>
              </div>
              {selectedProfile.nextPredictedOrder && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Next Predicted Order</span>
                  <span className="text-sm font-semibold text-yellow-400">
                    {new Date(selectedProfile.nextPredictedOrder).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Order History */}
          <div className="flex-1 overflow-y-auto p-5">
            <h4 className="text-sm font-medium text-white mb-3">Order History</h4>
            <div className="space-y-2">
              {selectedProfile.orders
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((order, idx) => (
                  <div 
                    key={`${order.orderId}-${idx}`}
                    className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    <div>
                      <div className="text-sm text-white font-medium">
                        {new Date(order.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-white">
                        ×{order.quantity}
                      </div>
                      {order.unitPrice && (
                        <div className="text-xs text-slate-500">
                          ${order.unitPrice.toFixed(2)} ea
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Actions */}
          <div className="p-5 border-t border-slate-800 space-y-2">
            {matchingInventoryItem && onReorder && (
              <button
                onClick={() => onReorder(matchingInventoryItem)}
                className="w-full bg-arda-accent hover:bg-arda-accent-hover text-white py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                <Icons.Send className="w-4 h-4" />
                Create Reorder Email
              </button>
            )}
            <button
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-2.5 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <Icons.Upload className="w-4 h-4" />
              Push to Arda
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{ value: string; label: string; color: string }> = ({ value, label, color }) => {
  const colorClasses: Record<string, string> = {
    orange: 'text-orange-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
    purple: 'text-purple-400',
  };
  
  return (
    <div className="bg-slate-800/50 rounded-lg p-3">
      <div className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
};

// Timeline View Component
const TimelineView: React.FC<{
  orders: ExtractedOrder[];
  expandedOrders: Set<string>;
  toggleOrder: (id: string) => void;
  onItemClick: (item: LineItemNodeData) => void;
  velocityProfiles: Map<string, ItemVelocityProfile>;
}> = ({ orders, expandedOrders, toggleOrder, onItemClick, velocityProfiles }) => {
  // Sort by date descending
  const sortedOrders = useMemo(() => 
    [...orders].sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()),
    [orders]
  );

  return (
    <div className="space-y-3">
      {sortedOrders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          isExpanded={expandedOrders.has(order.id)}
          onToggle={() => toggleOrder(order.id)}
          onItemClick={onItemClick}
          velocityProfiles={velocityProfiles}
        />
      ))}
    </div>
  );
};

// Supplier View Component
const SupplierView: React.FC<{
  ordersBySupplier: [string, ExtractedOrder[]][];
  expandedSuppliers: Set<string>;
  expandedOrders: Set<string>;
  toggleSupplier: (supplier: string) => void;
  toggleOrder: (id: string) => void;
  onItemClick: (item: LineItemNodeData) => void;
  velocityProfiles: Map<string, ItemVelocityProfile>;
  searchQuery: string;
}> = ({ ordersBySupplier, expandedSuppliers, expandedOrders, toggleSupplier, toggleOrder, onItemClick, velocityProfiles, searchQuery }) => {
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return ordersBySupplier;
    const q = searchQuery.toLowerCase();
    return ordersBySupplier.filter(([supplier, orders]) =>
      supplier.toLowerCase().includes(q) ||
      orders.some(o => o.items.some(i => i.name.toLowerCase().includes(q)))
    );
  }, [ordersBySupplier, searchQuery]);

  return (
    <div className="space-y-4">
      {filtered.map(([supplier, supplierOrders]) => (
        <div key={supplier} className="bg-slate-800/30 rounded-lg overflow-hidden">
          {/* Supplier Header */}
          <button
            onClick={() => toggleSupplier(supplier)}
            className="w-full flex items-center gap-3 p-4 hover:bg-slate-800/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Icons.Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-white font-medium">{supplier}</div>
              <div className="text-sm text-slate-400">{supplierOrders.length} orders</div>
            </div>
            <Icons.ChevronRight 
              className={`w-5 h-5 text-slate-400 transition-transform ${
                expandedSuppliers.has(supplier) ? 'rotate-90' : ''
              }`}
            />
          </button>

          {/* Supplier Orders */}
          {expandedSuppliers.has(supplier) && (
            <div className="px-4 pb-4 space-y-2">
              {supplierOrders
                .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime())
                .map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    isExpanded={expandedOrders.has(order.id)}
                    onToggle={() => toggleOrder(order.id)}
                    onItemClick={onItemClick}
                    velocityProfiles={velocityProfiles}
                    compact
                  />
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// Items View Component
const ItemsView: React.FC<{
  profiles: ItemVelocityProfile[];
  onItemClick: (item: LineItemNodeData) => void;
  selectedItem: LineItemNodeData | null;
}> = ({ profiles, onItemClick, selectedItem }) => {
  // Sort by daily burn rate
  const sorted = useMemo(() => 
    [...profiles].sort((a, b) => b.dailyBurnRate - a.dailyBurnRate),
    [profiles]
  );

  return (
    <div className="grid gap-3">
      {sorted.map((profile) => {
        const isSelected = selectedItem?.normalizedName === profile.normalizedName;
        
        return (
          <button
            key={profile.normalizedName}
            onClick={() => onItemClick({
              lineItemId: profile.normalizedName,
              orderId: '',
              emailId: '',
              name: profile.displayName,
              normalizedName: profile.normalizedName,
              quantity: profile.totalQuantityOrdered,
              unit: 'total',
              sku: profile.sku,
            })}
            className={`w-full text-left p-4 rounded-lg transition-all ${
              isSelected 
                ? 'bg-arda-accent/20 border-2 border-arda-accent' 
                : 'bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 hover:border-slate-600'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium truncate">{profile.displayName}</span>
                  {profile.sku && (
                    <span className="text-xs text-slate-500 font-mono bg-slate-800 px-1.5 py-0.5 rounded">
                      {profile.sku}
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-400 mt-1">{profile.supplier}</div>
              </div>
              <VelocityBadge
                dailyBurnRate={profile.dailyBurnRate}
                averageCadenceDays={profile.averageCadenceDays}
                orderCount={profile.orderCount}
                compact
              />
            </div>
            
            {/* Order dates as small pills */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {profile.orders
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .slice(0, 5)
                .map((order, idx) => (
                  <span
                    key={idx}
                    className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded"
                  >
                    {new Date(order.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    <span className="text-slate-500 ml-1">×{order.quantity}</span>
                  </span>
                ))}
              {profile.orders.length > 5 && (
                <span className="text-xs text-slate-500">
                  +{profile.orders.length - 5} more
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};

// Order Card Component
const OrderCard: React.FC<{
  order: ExtractedOrder;
  isExpanded: boolean;
  onToggle: () => void;
  onItemClick: (item: LineItemNodeData) => void;
  velocityProfiles: Map<string, ItemVelocityProfile>;
  compact?: boolean;
}> = ({ order, isExpanded, onToggle, onItemClick, velocityProfiles, compact = false }) => {
  return (
    <div className={`bg-slate-800/50 rounded-lg overflow-hidden border border-slate-700/50 ${
      compact ? '' : ''
    }`}>
      {/* Order Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-800 transition-colors"
      >
        <div className={`rounded-lg flex items-center justify-center flex-shrink-0 ${
          compact ? 'w-8 h-8 bg-green-500/10' : 'w-10 h-10 bg-green-500/20'
        }`}>
          <Icons.Package className={`text-green-400 ${compact ? 'w-4 h-4' : 'w-5 h-5'}`} />
        </div>
        
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium">
              {compact ? '' : `${order.supplier} - `}
              {new Date(order.orderDate).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
            {order.confidence && order.confidence < 0.8 && (
              <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                Low confidence
              </span>
            )}
          </div>
          <div className="text-sm text-slate-400">
            {order.items.length} item{order.items.length !== 1 ? 's' : ''}
            {order.totalAmount && ` • $${order.totalAmount.toFixed(2)}`}
          </div>
        </div>

        <Icons.ChevronRight 
          className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Order Items */}
      {isExpanded && (
        <div className="border-t border-slate-700/50 p-3 space-y-2">
          {order.items.map((item, idx) => {
            const normalizedName = item.normalizedName || item.name.toLowerCase().trim();
            const profile = velocityProfiles.get(normalizedName);
            
            return (
              <button
                key={idx}
                onClick={() => onItemClick({
                  lineItemId: item.id || `${order.id}-${idx}`,
                  orderId: order.id,
                  emailId: order.originalEmailId,
                  name: item.amazonEnriched?.itemName || item.name,
                  normalizedName,
                  quantity: item.quantity,
                  unit: item.unit,
                  unitPrice: item.unitPrice,
                  sku: item.sku || item.asin,
                })}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors text-left"
              >
                {/* Amazon product image or fallback icon */}
                {item.amazonEnriched?.imageUrl ? (
                  <img 
                    src={item.amazonEnriched.imageUrl} 
                    alt=""
                    className="w-12 h-12 rounded-lg object-contain bg-white flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <Icons.Box className="w-5 h-5 text-purple-400" />
                  </div>
                )}
                
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {item.amazonEnriched?.itemName || item.name}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{item.quantity} {item.unit}</span>
                    {item.unitPrice && <span className="text-green-400 font-medium">@ ${item.unitPrice.toFixed(2)}</span>}
                    {item.asin && <span className="text-orange-400">ASIN: {item.asin}</span>}
                  </div>
                  {item.amazonEnriched?.amazonUrl && (
                    <a 
                      href={item.amazonEnriched.amazonUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      View on Amazon →
                    </a>
                  )}
                </div>

                {profile && profile.orderCount > 1 && (
                  <VelocityBadge
                    dailyBurnRate={profile.dailyBurnRate}
                    averageCadenceDays={profile.averageCadenceDays}
                    orderCount={profile.orderCount}
                    compact
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default JourneyView;
