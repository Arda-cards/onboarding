import { useState, useEffect, useCallback, useRef } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { discoverApi, jobsApi, JobStatus, DiscoveredSupplier } from '../services/api';

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
}

// Non-Amazon priority suppliers
const OTHER_PRIORITY_SUPPLIERS: DiscoveredSupplier[] = [
  {
    domain: 'mcmaster.com',
    displayName: 'McMaster-Carr',
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
  {
    domain: 'uline.com',
    displayName: 'Uline',
    emailCount: 0,
    score: 100,
    category: 'industrial',
    sampleSubjects: [],
    isRecommended: true,
  },
];

const CATEGORY_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  industrial: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: '🏭' },
  retail: { bg: 'bg-green-500/20', text: 'text-green-400', icon: '🛒' },
  electronics: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', icon: '⚡' },
  office: { bg: 'bg-purple-500/20', text: 'text-purple-400', icon: '📎' },
  food: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: '🍽️' },
  unknown: { bg: 'bg-slate-500/20', text: 'text-slate-400', icon: '📦' },
};

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
}) => {
  // Amazon processing state (starts immediately)
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);
  const [amazonStatus, setAmazonStatus] = useState<JobStatus | null>(null);
  const [amazonOrders, setAmazonOrders] = useState<ExtractedOrder[]>([]);
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [isAmazonComplete, setIsAmazonComplete] = useState(false);
  const amazonPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Discovery state (runs in parallel)
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string>('');
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>([]);
  const [enabledSuppliers, setEnabledSuppliers] = useState<Set<string>>(
    new Set(['mcmaster.com', 'uline.com'])
  );
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(false);

  // Other suppliers scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [otherOrders, setOtherOrders] = useState<ExtractedOrder[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Merge priority suppliers with discovered ones (excluding Amazon)
  const allSuppliers = useCallback(() => {
    const merged = new Map<string, DiscoveredSupplier>();
    
    // Add priority suppliers first
    OTHER_PRIORITY_SUPPLIERS.forEach(s => merged.set(s.domain, { ...s }));
    
    // Merge discovered suppliers (excluding Amazon since it's auto-processed)
    discoveredSuppliers
      .filter(s => !s.domain.includes('amazon'))
      .forEach(s => {
        if (merged.has(s.domain)) {
          const existing = merged.get(s.domain)!;
          merged.set(s.domain, {
            ...existing,
            emailCount: s.emailCount,
            sampleSubjects: s.sampleSubjects,
          });
        } else {
          merged.set(s.domain, s);
        }
      });
    
    // Sort: priority first, then by score
    return Array.from(merged.values()).sort((a, b) => {
      const aPriority = OTHER_PRIORITY_SUPPLIERS.some(p => p.domain === a.domain);
      const bPriority = OTHER_PRIORITY_SUPPLIERS.some(p => p.domain === b.domain);
      if (aPriority && !bPriority) return -1;
      if (!aPriority && bPriority) return 1;
      return b.score - a.score;
    });
  }, [discoveredSuppliers]);

  // 1. START AMAZON IMMEDIATELY ON MOUNT
  useEffect(() => {
    const startAmazon = async () => {
      try {
        console.log('🛒 Starting Amazon processing immediately...');
        const response = await jobsApi.startAmazon();
        setAmazonJobId(response.jobId);
      } catch (error: any) {
        console.error('Failed to start Amazon processing:', error);
        setAmazonError(error.message || 'Failed to start Amazon processing');
      }
    };
    
    startAmazon();
  }, []);

  // 2. START SUPPLIER DISCOVERY IN PARALLEL
  useEffect(() => {
    if (!hasDiscovered && !isDiscovering) {
      handleDiscoverSuppliers();
    }
  }, []);

  // Poll Amazon job status
  const pollAmazonStatus = useCallback(async () => {
    if (!amazonJobId) return;
    
    try {
      const status = await jobsApi.getStatus(amazonJobId);
      setAmazonStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setAmazonOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsAmazonComplete(true);
        if (amazonPollingRef.current) {
          clearInterval(amazonPollingRef.current);
          amazonPollingRef.current = null;
        }
      }
    } catch (error) {
      console.error('Amazon polling error:', error);
    }
  }, [amazonJobId]);

  // Start Amazon polling
  useEffect(() => {
    if (amazonJobId && !isAmazonComplete) {
      pollAmazonStatus();
      amazonPollingRef.current = setInterval(pollAmazonStatus, 1000);
      return () => {
        if (amazonPollingRef.current) {
          clearInterval(amazonPollingRef.current);
          amazonPollingRef.current = null;
        }
      };
    }
  }, [amazonJobId, isAmazonComplete, pollAmazonStatus]);

  // Poll for other suppliers job status
  const pollJobStatus = useCallback(async () => {
    if (!currentJobId) return;
    
    try {
      const status = await jobsApi.getStatus(currentJobId);
      setJobStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setOtherOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsScanning(false);
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, [currentJobId]);

  // Start polling when scanning other suppliers
  useEffect(() => {
    if (isScanning && currentJobId) {
      pollJobStatus();
      pollingRef.current = setInterval(pollJobStatus, 1000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      };
    }
  }, [isScanning, currentJobId, pollJobStatus]);

  const handleDiscoverSuppliers = async () => {
    setIsDiscovering(true);
    setDiscoverError(null);
    setDiscoveryProgress('Connecting to Gmail...');
    
    try {
      setDiscoveryProgress('Scanning email headers...');
      const response = await discoverApi.discoverSuppliers();
      
      setDiscoveryProgress(`Found ${response.suppliers.length} potential suppliers`);
      setDiscoveredSuppliers(response.suppliers);
      
      // Auto-enable all recommended suppliers (except Amazon)
      const newEnabled = new Set(enabledSuppliers);
      response.suppliers
        .filter(s => s.isRecommended && !s.domain.includes('amazon'))
        .forEach(s => newEnabled.add(s.domain));
      setEnabledSuppliers(newEnabled);
      
      setHasDiscovered(true);
    } catch (error: any) {
      console.error('Failed to discover suppliers:', error);
      setDiscoverError(error.message || 'Failed to discover suppliers');
    } finally {
      setIsDiscovering(false);
      setDiscoveryProgress('');
    }
  };

  const handleToggleSupplier = (domain: string) => {
    setEnabledSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const handleStartScan = async () => {
    const suppliersToScan = Array.from(enabledSuppliers);
    if (suppliersToScan.length === 0) {
      alert('Please select at least one supplier to scan.');
      return;
    }

    setIsScanning(true);
    setOtherOrders([]);
    setJobStatus(null);
    
    try {
      console.log('Starting scan for suppliers:', suppliersToScan);
      const response = await jobsApi.startJob(suppliersToScan);
      setCurrentJobId(response.jobId);
    } catch (error: any) {
      console.error('Failed to start scan:', error);
      setDiscoverError(error.message || 'Failed to start scan. Please try again.');
      setIsScanning(false);
    }
  };

  const handleComplete = () => {
    // Combine Amazon orders with other orders
    const allOrders = [...amazonOrders, ...otherOrders];
    onScanComplete(allOrders);
  };

  const suppliers = allSuppliers();
  const enabledCount = enabledSuppliers.size;
  const totalOrders = amazonOrders.length + otherOrders.length;
  const isAnyProcessing = (!isAmazonComplete && amazonJobId) || isScanning;

  // Calculate Amazon progress
  const amazonProgress = amazonStatus?.progress;
  const amazonProgressPercent = amazonProgress 
    ? (amazonProgress.processed / amazonProgress.total) * 100 
    : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Import Orders</h1>
          <p className="text-slate-400 mt-1">
            Amazon processing starts automatically. Select other suppliers below.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isAnyProcessing && totalOrders > 0 && (
            <button
              onClick={handleComplete}
              className="bg-green-500 hover:bg-green-600 text-white px-5 py-2 rounded-lg font-medium transition-colors"
            >
              Continue with {totalOrders} orders →
            </button>
          )}
          {!isAnyProcessing && (
            <button
              onClick={onSkip}
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {/* Amazon Processing Card - Always visible at top */}
      <div className={`border rounded-xl p-5 ${
        isAmazonComplete 
          ? amazonOrders.length > 0 
            ? 'bg-green-500/10 border-green-500/30' 
            : 'bg-slate-800/50 border-slate-700'
          : 'bg-orange-500/10 border-orange-500/30'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {!isAmazonComplete ? (
              <Icons.Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            ) : amazonOrders.length > 0 ? (
              <Icons.CheckCircle2 className="w-5 h-5 text-green-400" />
            ) : (
              <Icons.AlertCircle className="w-5 h-5 text-slate-500" />
            )}
            <div>
              <span className="text-lg font-semibold text-white">🛒 Amazon</span>
              <span className="text-slate-400 ml-2 text-sm">
                {!isAmazonComplete 
                  ? 'Processing with ASIN enrichment...'
                  : amazonOrders.length > 0 
                    ? `${amazonOrders.length} orders imported`
                    : 'No Amazon orders found'
                }
              </span>
            </div>
          </div>
          
          {amazonProgress && !isAmazonComplete && (
            <span className="text-slate-400 text-sm font-mono">
              {amazonProgress.processed} / {amazonProgress.total}
            </span>
          )}
        </div>

        {/* Amazon Progress Bar */}
        {!isAmazonComplete && amazonProgress && (
          <div className="mb-3">
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-orange-500 to-yellow-400 transition-all duration-300"
                style={{ width: `${amazonProgressPercent}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {amazonProgress.currentTask}
            </div>
          </div>
        )}

        {/* Amazon Live Results */}
        {amazonOrders.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {amazonOrders.slice(-5).reverse().map((order, i) => (
              <div key={order.id || i} className="text-xs bg-slate-900/50 text-slate-300 px-2 py-1 rounded flex items-center gap-1">
                <span className="text-green-400">✓</span>
                {order.items.length} items
                {order.items[0]?.amazonEnriched?.imageUrl && (
                  <img 
                    src={order.items[0].amazonEnriched.imageUrl} 
                    alt="" 
                    className="w-4 h-4 object-contain ml-1"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {amazonError && (
          <div className="text-red-400 text-sm mt-2 flex items-center gap-2">
            <Icons.AlertCircle className="w-4 h-4" />
            {amazonError}
          </div>
        )}
      </div>

      {/* Discovery Error */}
      {discoverError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Icons.AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-red-400 font-medium">Error</div>
              <div className="text-red-300 text-sm mt-1">{discoverError}</div>
              <button
                onClick={() => {
                  setDiscoverError(null);
                  if (!hasDiscovered) handleDiscoverSuppliers();
                }}
                className="mt-3 text-sm bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1.5 rounded transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Suppliers Section */}
      <div className="border-t border-slate-800 pt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Other Suppliers</h2>
          {isDiscovering && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Icons.Loader2 className="w-4 h-4 animate-spin" />
              {discoveryProgress}
            </div>
          )}
        </div>

        {/* Scanning Progress for Other Suppliers */}
        {isScanning && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Icons.Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                <span className="text-white font-medium">Importing from {enabledCount} suppliers</span>
              </div>
              {jobStatus?.progress && (
                <span className="text-slate-400 text-sm font-mono">
                  {jobStatus.progress.processed} / {jobStatus.progress.total}
                </span>
              )}
            </div>

            {jobStatus?.progress && (
              <>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300"
                    style={{ 
                      width: `${(jobStatus.progress.processed / jobStatus.progress.total) * 100}%` 
                    }}
                  />
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-green-400">
                    ✓ {jobStatus.progress.success} orders found
                  </span>
                  <span className="text-slate-500 text-xs">
                    {jobStatus.progress.currentTask}
                  </span>
                </div>
              </>
            )}

            {otherOrders.length > 0 && (
              <div className="border-t border-slate-700 mt-4 pt-4">
                <div className="text-xs text-slate-500 mb-2">Recent:</div>
                <div className="flex flex-wrap gap-2">
                  {otherOrders.slice(-6).reverse().map((order, i) => (
                    <div key={order.id || i} className="text-xs bg-slate-900 text-slate-300 px-2 py-1 rounded">
                      {order.supplier} • {order.items.length} items
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Supplier Grid */}
        {!isScanning && (
          <>
            {isDiscovering && !hasDiscovered ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-8 text-center">
                <Icons.Loader2 className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-3" />
                <div className="text-white font-medium">{discoveryProgress}</div>
                <div className="text-slate-500 text-sm mt-1">Discovering other suppliers...</div>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {suppliers.map((supplier) => {
                  const isEnabled = enabledSuppliers.has(supplier.domain);
                  const isPriority = OTHER_PRIORITY_SUPPLIERS.some(p => p.domain === supplier.domain);
                  const colors = CATEGORY_COLORS[supplier.category] || CATEGORY_COLORS.unknown;
                  
                  return (
                    <div
                      key={supplier.domain}
                      onClick={() => handleToggleSupplier(supplier.domain)}
                      className={`
                        relative aspect-square p-3 rounded-xl border-2 cursor-pointer transition-all
                        flex flex-col items-center justify-center text-center
                        ${isEnabled 
                          ? 'bg-slate-800 border-blue-500 shadow-lg shadow-blue-500/10' 
                          : 'bg-slate-900 border-slate-700 hover:border-slate-600 opacity-60 hover:opacity-100'
                        }
                      `}
                    >
                      {isPriority && (
                        <div className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full" />
                      )}

                      {isEnabled && (
                        <div className="absolute top-1.5 left-1.5">
                          <Icons.CheckCircle2 className="w-4 h-4 text-blue-400" />
                        </div>
                      )}

                      <div className={`text-2xl mb-1 ${isEnabled ? '' : 'grayscale'}`}>
                        {colors.icon}
                      </div>

                      <div className={`text-xs font-medium truncate w-full ${isEnabled ? 'text-white' : 'text-slate-400'}`}>
                        {supplier.displayName}
                      </div>

                      {supplier.emailCount > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {supplier.emailCount} emails
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Action Bar */}
            {!isDiscovering && (
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-slate-500">
                    {enabledCount} selected
                  </span>
                  {hasDiscovered && (
                    <button
                      onClick={handleDiscoverSuppliers}
                      className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                    >
                      <Icons.RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  )}
                </div>
                <button
                  onClick={handleStartScan}
                  disabled={enabledCount === 0 || isScanning}
                  className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Icons.Download className="w-4 h-4" />
                  Import from {enabledCount} Suppliers
                </button>
              </div>
            )}
          </>
        )}

        {/* Other Suppliers Complete */}
        {!isScanning && jobStatus?.status === 'completed' && otherOrders.length > 0 && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 mt-4">
            <div className="flex items-center gap-3">
              <Icons.CheckCircle2 className="w-6 h-6 text-green-400" />
              <div>
                <div className="text-green-400 font-medium">Import Complete</div>
                <div className="text-green-300/70 text-sm">
                  {otherOrders.length} additional orders imported
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Bar at Bottom */}
      {(amazonOrders.length > 0 || otherOrders.length > 0) && !isAnyProcessing && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-4">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="text-white">
              <span className="font-semibold">{totalOrders} orders</span>
              <span className="text-slate-400 ml-2">
                ({amazonOrders.length} Amazon, {otherOrders.length} other)
              </span>
            </div>
            <button
              onClick={handleComplete}
              className="bg-green-500 hover:bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              Continue to Dashboard →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierSetup;
