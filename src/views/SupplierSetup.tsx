import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { discoverApi, jobsApi, JobStatus, DiscoveredSupplier } from '../services/api';
import { mergeSuppliers } from '../utils/supplierUtils';
import {
  buildSupplierGridItems,
  calculateProgressPercent,
  OTHER_PRIORITY_SUPPLIERS,
  PRIORITY_SUPPLIER_DOMAINS,
} from './supplierSetupUtils';

// Snarky lean manufacturing quotes for loading states
const LEAN_QUOTES = [
  { quote: "Inventory is the root of all evil.", author: "Taiichi Ohno" },
  { quote: "The most dangerous kind of waste is the waste we do not recognize.", author: "Shigeo Shingo" },
  { quote: "Where there is no standard, there can be no kaizen.", author: "Taiichi Ohno" },
  { quote: "All we are doing is looking at the timeline from order to cash and reducing it.", author: "Taiichi Ohno" },
  { quote: "Having no problems is the biggest problem of all.", author: "Taiichi Ohno" },
  { quote: "Costs do not exist to be calculated. Costs exist to be reduced.", author: "Taiichi Ohno" },
  { quote: "Progress cannot be generated when we are satisfied with existing situations.", author: "Taiichi Ohno" },
  { quote: "Without standards, there can be no improvement.", author: "Taiichi Ohno" },
  { quote: "Make your workplace into a showcase that can be understood by everyone at a glance.", author: "Taiichi Ohno" },
  { quote: "If you're going to do kaizen continuously, you've got to assume that things are a mess.", author: "Masaaki Imai" },
  { quote: "Build a culture of stopping to fix problems, to get quality right the first time.", author: "Toyota Principle" },
  { quote: "Waste is any human activity which absorbs resources but creates no value.", author: "James Womack" },
  { quote: "Your customers do not care about your systems, they care about their problems.", author: "Lean Wisdom" },
  { quote: "A relentless barrage of 'why's' is the best way to prepare your mind to pierce the clouded veil of thinking.", author: "Taiichi Ohno" },
  { quote: "People don't go to Toyota to 'work', they go there to 'think'.", author: "Toyota Wisdom" },
];

function useRotatingQuote(intervalMs = 5000) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * LEAN_QUOTES.length));
  
  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % LEAN_QUOTES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  
  return LEAN_QUOTES[index];
}

// Background progress type for parent components
interface BackgroundEmailProgress {
  isActive: boolean;
  supplier: string;
  processed: number;
  total: number;
  currentTask?: string;
}

// State that can be preserved when navigating away
export interface EmailScanState {
  amazonOrders: ExtractedOrder[];
  priorityOrders: ExtractedOrder[];
  otherOrders: ExtractedOrder[];
  isAmazonComplete: boolean;
  isPriorityComplete: boolean;
  discoveredSuppliers: DiscoveredSupplier[];
  hasDiscovered: boolean;
}

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
  onProgressUpdate?: (progress: BackgroundEmailProgress | null) => void;
  onCanProceed?: (canProceed: boolean) => void;
  onStateChange?: (state: EmailScanState) => void;
  initialState?: EmailScanState;
}

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onSkip,
  onProgressUpdate,
  onCanProceed,
  onStateChange,
  initialState,
}) => {
  // Rotating lean quote for loading states
  const leanQuote = useRotatingQuote();
  
  // Track if we already have restored state (don't restart scans)
  const hasRestoredState = Boolean(initialState && (initialState.amazonOrders.length > 0 || initialState.priorityOrders.length > 0 || initialState.otherOrders.length > 0));

  // Amazon processing state (starts immediately if no initial state)
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);
  const [amazonStatus, setAmazonStatus] = useState<JobStatus | null>(null);
  const [amazonOrders, setAmazonOrders] = useState<ExtractedOrder[]>(initialState?.amazonOrders || []);
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [isAmazonComplete, setIsAmazonComplete] = useState(initialState?.isAmazonComplete || false);
  const amazonPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Priority suppliers (McMaster-Carr, Uline) processing state (starts immediately if no initial state)
  const [priorityJobId, setPriorityJobId] = useState<string | null>(null);
  const [priorityStatus, setPriorityStatus] = useState<JobStatus | null>(null);
  const [priorityOrders, setPriorityOrders] = useState<ExtractedOrder[]>(initialState?.priorityOrders || []);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [isPriorityComplete, setIsPriorityComplete] = useState(initialState?.isPriorityComplete || false);
  const priorityPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Discovery state (runs in parallel)
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState<string>('');
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>(initialState?.discoveredSuppliers || []);
  const [enabledSuppliers, setEnabledSuppliers] = useState<Set<string>>(
    new Set(['mcmaster.com', 'uline.com'])
  );
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(initialState?.hasDiscovered || false);

  // Other suppliers scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [otherOrders, setOtherOrders] = useState<ExtractedOrder[]>(initialState?.otherOrders || []);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [otherScanDomains, setOtherScanDomains] = useState<string[]>([]);

  // Computed values for the experience
  const allItems = useMemo(() => {
    const items: Array<{ name: string; price: number; supplier: string; image?: string; date: string }> = [];
    
    amazonOrders.forEach(order => {
      order.items.forEach(item => {
        items.push({
          name: item.amazonEnriched?.itemName || item.name,
          price: item.unitPrice || 0,
          supplier: 'Amazon',
          image: item.amazonEnriched?.imageUrl,
          date: order.orderDate,
        });
      });
    });
    
    priorityOrders.forEach(order => {
      order.items.forEach(item => {
        items.push({
          name: item.name,
          price: item.unitPrice || 0,
          supplier: order.supplier,
          image: item.imageUrl,
          date: order.orderDate,
        });
      });
    });
    
    otherOrders.forEach(order => {
      order.items.forEach(item => {
        items.push({
          name: item.name,
          price: item.unitPrice || 0,
          supplier: order.supplier,
          image: item.imageUrl,
          date: order.orderDate,
        });
      });
    });
    
    return items;
  }, [amazonOrders, priorityOrders, otherOrders]);

  const totalSpend = useMemo(() => {
    return allItems.reduce((sum, item) => sum + (item.price || 0), 0);
  }, [allItems]);

  const combinedOrders = useMemo(() => {
    return [...amazonOrders, ...priorityOrders, ...otherOrders];
  }, [amazonOrders, priorityOrders, otherOrders]);

  const totalOrders = combinedOrders.length;
  const uniqueSuppliers = useMemo(() => {
    const suppliers = new Set<string>();
    allItems.forEach(item => suppliers.add(item.supplier));
    return suppliers.size;
  }, [allItems]);

  // Merge priority suppliers with discovered ones (excluding Amazon)
  const allSuppliers = useMemo(() => mergeSuppliers(OTHER_PRIORITY_SUPPLIERS, discoveredSuppliers), [discoveredSuppliers]);

  // Note: We keep this step clean and professional — progress is shown inline below.

  // 1. START PRIORITY SUPPLIERS - STAGGERED TO AVOID RATE LIMITS
  // Skip if we have restored state (user navigated back)
  useEffect(() => {
    // Skip initialization if we restored from saved state
    if (hasRestoredState) {
      console.log('📦 Restored email scan state - skipping initialization');
      return;
    }
    
    let amazonRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    let priorityDelayTimeout: ReturnType<typeof setTimeout> | null = null;
    
    // Start Amazon with retry logic
    const startAmazon = async (retryCount = 0) => {
      try {
        console.log(`🛒 Starting Amazon processing${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        const response = await jobsApi.startAmazon();
        setAmazonJobId(response.jobId);
        setAmazonError(null);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start Amazon processing';
        console.error('Amazon processing error:', errorMessage);
        
        // Retry on rate limit or temporary errors (up to 3 times)
        if (retryCount < 3 && (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('Too many'))) {
          const retryDelay = (retryCount + 1) * 3000; // 3s, 6s, 9s
          console.log(`⏳ Rate limited, retrying Amazon in ${retryDelay / 1000}s...`);
          amazonRetryTimeout = setTimeout(() => startAmazon(retryCount + 1), retryDelay);
        } else {
          setAmazonError(errorMessage);
        }
      }
    };
    
    // Start McMaster-Carr and Uline (delayed to avoid rate limits)
    const startPrioritySuppliers = async (retryCount = 0) => {
      try {
        console.log(`🏭 Starting McMaster-Carr & Uline${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        const response = await jobsApi.startJob(['mcmaster.com', 'uline.com'], 'priority');
        setPriorityJobId(response.jobId);
        setPriorityError(null);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start McMaster-Carr & Uline';
        console.error('Priority suppliers error:', errorMessage);
        
        // Retry on rate limit (up to 3 times)
        if (retryCount < 3 && (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('Too many'))) {
          const retryDelay = (retryCount + 1) * 4000; // 4s, 8s, 12s
          console.log(`⏳ Rate limited, retrying priority suppliers in ${retryDelay / 1000}s...`);
          setTimeout(() => startPrioritySuppliers(retryCount + 1), retryDelay);
        } else {
          setPriorityError(errorMessage);
        }
      }
    };
    
    // Start Amazon immediately
    startAmazon();
    
    // Delay priority suppliers by 2 seconds to stagger API calls
    priorityDelayTimeout = setTimeout(() => {
      startPrioritySuppliers();
    }, 2000);
    
    // Cleanup on unmount
    return () => {
      if (amazonRetryTimeout) clearTimeout(amazonRetryTimeout);
      if (priorityDelayTimeout) clearTimeout(priorityDelayTimeout);
    };
  }, [hasRestoredState]);

  // 2. START SUPPLIER DISCOVERY (delayed to stagger API calls)
  useEffect(() => {
    if (!hasDiscovered && !isDiscovering) {
      // Delay discovery by 4 seconds to avoid overwhelming the server
      const discoveryTimeout = setTimeout(() => {
        handleDiscoverSuppliers();
      }, 4000);
      
      return () => clearTimeout(discoveryTimeout);
    }
  }, [hasDiscovered, isDiscovering]);

  // Poll Amazon job status
  const pollAmazonStatus = useCallback(async () => {
    if (!amazonJobId) return;
    
    try {
      const status = await jobsApi.getStatus(amazonJobId);
      console.log(`🛒 Amazon poll: ${status.progress?.processed}/${status.progress?.total}, status=${status.status}`);
      setAmazonStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          shippedDate: o.shippedDate,
          deliveredDate: o.deliveredDate,
          leadTimeDays: o.leadTimeDays,
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

  useEffect(() => {
    if (amazonJobId && !isAmazonComplete) {
      console.log('🛒 Starting Amazon polling interval');
      pollAmazonStatus();
      amazonPollingRef.current = setInterval(pollAmazonStatus, 1000);
      return () => {
        console.log('🛒 Clearing Amazon polling interval');
        if (amazonPollingRef.current) {
          clearInterval(amazonPollingRef.current);
          amazonPollingRef.current = null;
        }
      };
    }
  }, [amazonJobId, isAmazonComplete, pollAmazonStatus]);

  // Poll Priority Suppliers (McMaster-Carr, Uline) job status
  const pollPriorityStatus = useCallback(async () => {
    if (!priorityJobId) return;
    
    try {
      const status = await jobsApi.getStatus(priorityJobId);
      setPriorityStatus(status);
      
      if (status.orders && status.orders.length > 0) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          shippedDate: o.shippedDate,
          deliveredDate: o.deliveredDate,
          leadTimeDays: o.leadTimeDays,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setPriorityOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsPriorityComplete(true);
        if (priorityPollingRef.current) {
          clearInterval(priorityPollingRef.current);
          priorityPollingRef.current = null;
        }
      }
    } catch (error) {
      console.error('Priority polling error:', error);
    }
  }, [priorityJobId]);

  useEffect(() => {
    if (priorityJobId && !isPriorityComplete) {
      pollPriorityStatus();
      priorityPollingRef.current = setInterval(pollPriorityStatus, 1000);
      return () => {
        if (priorityPollingRef.current) {
          clearInterval(priorityPollingRef.current);
          priorityPollingRef.current = null;
        }
      };
    }
  }, [priorityJobId, isPriorityComplete, pollPriorityStatus]);

  // Preserve state for parent (so navigation back doesn't lose progress)
  useEffect(() => {
    onStateChange?.({
      amazonOrders,
      priorityOrders,
      otherOrders,
      isAmazonComplete,
      isPriorityComplete,
      discoveredSuppliers,
      hasDiscovered,
    });
  }, [amazonOrders, priorityOrders, otherOrders, isAmazonComplete, isPriorityComplete, discoveredSuppliers, hasDiscovered, onStateChange]);

  // Discover suppliers
  const handleDiscoverSuppliers = async () => {
    setIsDiscovering(true);
    setDiscoverError(null);
    setDiscoveryProgress('Scanning your inbox for suppliers...');
    
    try {
      const result = await discoverApi.discoverSuppliers();
      // Filter out Amazon since we handle it separately
      const nonAmazonSuppliers = result.suppliers.filter((s: DiscoveredSupplier) => !s.domain.includes('amazon'));
      setDiscoveredSuppliers(nonAmazonSuppliers);
      setHasDiscovered(true);
      setDiscoveryProgress('');
    } catch (err: unknown) {
      console.error('Discovery error:', err);
      const message = err instanceof Error ? err.message : 'Failed to discover suppliers';
      setDiscoverError(message);
      setHasDiscovered(true);
    } finally {
      setIsDiscovering(false);
    }
  };

  // Poll job status
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
          shippedDate: o.shippedDate,
          deliveredDate: o.deliveredDate,
          leadTimeDays: o.leadTimeDays,
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
      console.error('Job polling error:', error);
    }
  }, [currentJobId]);

  useEffect(() => {
    if (currentJobId && isScanning) {
      pollJobStatus();
      pollingRef.current = setInterval(pollJobStatus, 1000);
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      };
    }
  }, [currentJobId, isScanning, pollJobStatus]);

  // Scan selected suppliers
  const handleScanSuppliers = useCallback(async () => {
    // Filter to only non-Amazon, non-priority enabled suppliers
    const domainsToScan = Array.from(enabledSuppliers).filter(
      d => !d.includes('amazon') && !PRIORITY_SUPPLIER_DOMAINS.has(d)
    );
    
    if (domainsToScan.length === 0) {
      return; // Nothing additional to scan
    }
    
    setIsScanning(true);
    setJobStatus(null);
    setOtherScanDomains(domainsToScan);
    
    try {
      const response = await jobsApi.startJob(domainsToScan, 'other');
      setCurrentJobId(response.jobId);
    } catch (error) {
      console.error('Scan error:', error);
      setIsScanning(false);
    }
  }, [enabledSuppliers]);

  const handleToggleSupplier = useCallback((domain: string) => {
    setEnabledSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  }, []);

  // Keep parent updated with collected orders as they come in
  useEffect(() => {
    if (combinedOrders.length > 0) {
      onScanComplete(combinedOrders);
    }
  }, [combinedOrders, onScanComplete]);

  const selectableSuppliers = useMemo(
    () => allSuppliers.filter(s => !PRIORITY_SUPPLIER_DOMAINS.has(s.domain)),
    [allSuppliers],
  );
  const supplierCount = selectableSuppliers.length;
  const hasSelectableSuppliers = supplierCount > 0;
  const selectedOtherDomains = useMemo(
    () => Array.from(enabledSuppliers).filter(d => !d.includes('amazon') && !PRIORITY_SUPPLIER_DOMAINS.has(d)),
    [enabledSuppliers],
  );
  const selectedOtherCount = selectedOtherDomains.length;
  const canContinueWithoutOthers = (hasDiscovered && !hasSelectableSuppliers) || Boolean(discoverError);
  const isPriorityProcessing = useMemo(
    () => Boolean(!isPriorityComplete && priorityJobId),
    [isPriorityComplete, priorityJobId],
  );
  const isAnyProcessing = useMemo(
    () => Boolean((!isAmazonComplete && amazonJobId) || isPriorityProcessing || isScanning),
    [isAmazonComplete, amazonJobId, isPriorityProcessing, isScanning],
  );
  const readyToContinue = isAmazonComplete && isPriorityComplete && (selectedOtherCount > 0 || canContinueWithoutOthers);
  const foundOtherSupplierNames = useMemo(
    () => Array.from(new Set(otherOrders.map(o => o.supplier))).slice(0, 10),
    [otherOrders],
  );
  // Report progress to parent component for background display
  useEffect(() => {
    if (!onProgressUpdate) return;
    
    // Determine active scanning progress
    if (isScanning && jobStatus?.progress) {
      onProgressUpdate({
        isActive: true,
        supplier: 'Other Suppliers',
        processed: jobStatus.progress.processed || 0,
        total: jobStatus.progress.total || 0,
        currentTask: jobStatus.progress.currentTask,
      });
    } else if (isPriorityProcessing && priorityStatus?.progress) {
      onProgressUpdate({
        isActive: true,
        supplier: 'McMaster-Carr & Uline',
        processed: priorityStatus.progress.processed || 0,
        total: priorityStatus.progress.total || 0,
        currentTask: priorityStatus.progress.currentTask,
      });
    } else if (!isAmazonComplete && amazonStatus?.progress) {
      onProgressUpdate({
        isActive: true,
        supplier: 'Amazon',
        processed: amazonStatus.progress.processed || 0,
        total: amazonStatus.progress.total || 0,
        currentTask: amazonStatus.progress.currentTask,
      });
    } else if (!isAnyProcessing) {
      onProgressUpdate(null);
    }
  }, [
    onProgressUpdate, 
    isScanning, 
    jobStatus, 
    isPriorityProcessing, 
    priorityStatus, 
    isAmazonComplete, 
    amazonStatus, 
    isAnyProcessing
  ]);

  // Priority suppliers progress
  const priorityProgress = priorityStatus?.progress;
  const priorityProgressPercent = useMemo(
    () => calculateProgressPercent(priorityProgress),
    [priorityProgress],
  );

  // Amazon progress
  const amazonProgress = amazonStatus?.progress;
  const amazonProgressPercent = useMemo(
    () => calculateProgressPercent(amazonProgress),
    [amazonProgress],
  );

  const supplierGridItems = useMemo(
    () => buildSupplierGridItems(selectableSuppliers, enabledSuppliers),
    [selectableSuppliers, enabledSuppliers],
  );

  // Update parent about navigation readiness (Continue button)
  useEffect(() => {
    const keySuppliersDone = isAmazonComplete && isPriorityComplete;
    onCanProceed?.(keySuppliersDone && (selectedOtherCount > 0 || canContinueWithoutOthers));
  }, [onCanProceed, isAmazonComplete, isPriorityComplete, selectedOtherCount, canContinueWithoutOthers]);

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="card-arda p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="arda-pill w-fit">
              <Icons.Sparkles className="w-4 h-4" />
              Email import
            </div>
            <h2 className="text-lg font-semibold text-arda-text-primary">
              Importing orders from your inbox
            </h2>
            <p className="text-sm text-arda-text-secondary">
              We’ll extract items from Amazon and your priority suppliers first. Then, pick at least one other supplier to import.
            </p>
            <div className="flex items-center gap-2 text-sm mt-3">
              {readyToContinue ? (
                <>
                  <Icons.CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-green-700">
                    Ready — click Continue below{canContinueWithoutOthers ? ' (no additional suppliers required)' : ''}
                  </span>
                </>
              ) : (isAmazonComplete && isPriorityComplete && selectedOtherCount === 0 && !canContinueWithoutOthers) ? (
                <>
                  <Icons.AlertCircle className="w-4 h-4 text-arda-accent" />
                  <span className="text-arda-text-secondary">Select at least 1 other supplier below to unlock Continue</span>
                </>
              ) : (
                <>
                  <Icons.Loader2 className="w-4 h-4 text-arda-accent animate-spin" />
                  <span className="text-arda-text-secondary">Import in progress… Continue will unlock shortly</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            disabled={!readyToContinue}
            className={[
              'btn-arda-outline whitespace-nowrap',
              !readyToContinue ? 'opacity-50 cursor-not-allowed' : '',
            ].join(' ')}
          >
            Skip email import
          </button>
        </div>

        {(allItems.length > 0 || totalOrders > 0) && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-arda-bg-secondary border border-arda-border rounded-arda-lg p-3">
              <div className="text-xs text-arda-text-muted">Items found</div>
              <div className="text-lg font-semibold text-arda-text-primary">{allItems.length}</div>
            </div>
            <div className="bg-arda-bg-secondary border border-arda-border rounded-arda-lg p-3">
              <div className="text-xs text-arda-text-muted">Orders</div>
              <div className="text-lg font-semibold text-arda-text-primary">{totalOrders}</div>
            </div>
            <div className="bg-arda-bg-secondary border border-arda-border rounded-arda-lg p-3">
              <div className="text-xs text-arda-text-muted">Suppliers</div>
              <div className="text-lg font-semibold text-arda-text-primary">{uniqueSuppliers}</div>
            </div>
            <div className="bg-arda-bg-secondary border border-arda-border rounded-arda-lg p-3">
              <div className="text-xs text-arda-text-muted">Spend tracked</div>
              <div className="text-lg font-semibold text-arda-text-primary">
                ${totalSpend >= 1000 ? `${(totalSpend / 1000).toFixed(1)}k` : totalSpend.toFixed(0)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Amazon Processing Card - Premium look */}
      <div className={`border-2 rounded-2xl p-6 transition-all ${
        amazonError
          ? 'bg-red-50 border-red-200'
          : isAmazonComplete 
            ? amazonOrders.length > 0
              ? 'bg-green-50 border-green-300 shadow-md' 
              : 'bg-gray-50 border-gray-200'
            : 'bg-orange-50 border-orange-200 shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isAmazonComplete ? 'bg-green-500' : 'bg-orange-500'
            }`}>
              {amazonError ? (
                <Icons.AlertCircle className="w-6 h-6 text-white" />
              ) : !isAmazonComplete ? (
                <Icons.Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <Icons.CheckCircle2 className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-arda-text-primary">Amazon</h3>
              <p className={`text-sm ${amazonError ? 'text-red-600' : 'text-arda-text-secondary'}`}>
                {amazonError 
                  ? amazonError
                  : !isAmazonComplete 
                    ? 'Extracting products from your orders...'
                    : amazonOrders.length > 0 
                      ? `${amazonOrders.reduce((sum, o) => sum + o.items.length, 0)} items from ${amazonOrders.length} orders`
                      : 'No Amazon orders found'
                }
              </p>
            </div>
          </div>
          
          {amazonProgress && !isAmazonComplete && !amazonError && (
            <div className="text-right">
              <div className="text-2xl font-bold text-orange-600">
                {Math.round(amazonProgressPercent)}%
              </div>
              <div className="text-xs text-arda-text-muted">
                {amazonProgress.processed} / {amazonProgress.total} emails
              </div>
            </div>
          )}
        </div>

        {/* Amazon Progress Bar */}
        {!isAmazonComplete && amazonProgress && !amazonError && (
          <div className="mb-4">
            <div className="h-3 bg-orange-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-orange-500 to-orange-400 transition-all duration-300 rounded-full"
                style={{ width: `${amazonProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Amazon Items Grid - Show all items beautifully */}
        {amazonOrders.length > 0 && (
          <div className="max-h-64 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {amazonOrders.flatMap((order, orderIdx) => 
                order.items.map((item, itemIdx) => (
                  <div 
                    key={`${orderIdx}-${itemIdx}`} 
                    className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:shadow-md transition-shadow"
                  >
                    {item.amazonEnriched?.imageUrl ? (
                      <img 
                        src={item.amazonEnriched.imageUrl} 
                        alt="" 
                        className="w-14 h-14 object-contain flex-shrink-0 rounded-lg bg-gray-50"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icons.Package className="w-7 h-7 text-orange-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-arda-text-primary line-clamp-2">
                        {item.amazonEnriched?.itemName || item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {(item.unitPrice ?? 0) > 0 && (
                          <span className="text-sm text-green-600 font-bold">
                            ${(item.unitPrice ?? 0).toFixed(2)}
                          </span>
                        )}
                        <span className="text-xs text-arda-text-muted">
                          {order.orderDate}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* McMaster-Carr & Uline Card */}
      <div className={`border-2 rounded-2xl p-6 transition-all ${
        priorityError
          ? 'bg-red-50 border-red-200'
          : isPriorityComplete 
            ? priorityOrders.length > 0 
              ? 'bg-green-50 border-green-300 shadow-md' 
              : 'bg-gray-50 border-gray-200'
            : 'bg-blue-50 border-blue-200 shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isPriorityComplete ? 'bg-green-500' : 'bg-blue-500'
            }`}>
              {priorityError ? (
                <Icons.AlertCircle className="w-6 h-6 text-white" />
              ) : !isPriorityComplete ? (
                <Icons.Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <Icons.CheckCircle2 className="w-6 h-6 text-white" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-bold text-arda-text-primary">Industrial Suppliers</h3>
              <p className="text-sm text-arda-text-secondary">
                McMaster-Carr, Uline, and more
              </p>
            </div>
          </div>
          
          {priorityProgress && !isPriorityComplete && !priorityError && (
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-600">
                {Math.round(priorityProgressPercent)}%
              </div>
              <div className="text-xs text-arda-text-muted">
                {priorityProgress.processed} / {priorityProgress.total} emails
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {!isPriorityComplete && priorityProgress && !priorityError && (
          <div className="mb-4">
            <div className="h-3 bg-blue-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 rounded-full"
                style={{ width: `${priorityProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Priority Items List */}
        {priorityOrders.length > 0 && (
          <div className="max-h-48 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {priorityOrders.flatMap((order, orderIdx) => 
                order.items.map((item, itemIdx) => (
                  <div 
                    key={`${orderIdx}-${itemIdx}`} 
                    className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icons.Package className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-arda-text-primary line-clamp-1">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {(item.unitPrice ?? 0) > 0 && (
                          <span className="text-sm text-blue-600 font-bold">
                            ${(item.unitPrice ?? 0).toFixed(2)}
                          </span>
                        )}
                        {item.quantity > 1 && (
                          <span className="text-xs text-arda-text-muted bg-gray-100 px-1.5 py-0.5 rounded">
                            x{item.quantity}
                          </span>
                        )}
                        <span className="text-xs text-arda-text-muted">
                          {order.supplier}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Additional Suppliers Section */}
      <div className="border-2 border-gray-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-arda-text-primary">Other Suppliers</h3>
            <p className="text-sm text-arda-text-secondary">
              {isDiscovering 
                ? 'Discovering...' 
                : supplierCount > 0
                  ? `${supplierCount} suppliers found — select at least 1`
                  : discoverError
                    ? 'Discovery failed — you can continue or retry'
                    : hasDiscovered
                      ? 'No other suppliers found — you can continue'
                      : 'No other suppliers found yet'}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {discoverError && !isDiscovering && (
              <button
                onClick={handleDiscoverSuppliers}
                className="btn-arda-outline px-3 py-2 text-sm"
              >
                Retry discovery
              </button>
            )}
            {hasDiscovered && !isScanning && selectedOtherCount > 0 && (
              <button
                onClick={handleScanSuppliers}
                className="bg-arda-accent hover:bg-arda-accent-hover text-white px-5 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2"
              >
                <Icons.Download className="w-4 h-4" />
                Import {selectedOtherCount} Suppliers
              </button>
            )}
          </div>
        </div>

        {/* Discovery error / empty state messaging */}
        {!isScanning && hasDiscovered && (discoverError || supplierCount === 0) && (
          <div className={`mb-4 rounded-xl border px-4 py-3 flex items-start gap-3 ${
            discoverError ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="mt-0.5">
              {discoverError ? (
                <Icons.AlertTriangle className="w-5 h-5 text-red-500" />
              ) : (
                <Icons.AlertCircle className="w-5 h-5 text-blue-500" />
              )}
            </div>
            <div className="text-sm text-arda-text-secondary">
              {discoverError
                ? `${discoverError}. You can retry or continue without importing additional suppliers.`
                : 'We could not find any additional suppliers. You can continue without importing more.'}
            </div>
          </div>
        )}

        {/* Scanning Progress */}
        {isScanning && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <Icons.Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <span className="font-medium text-blue-700">
                {jobStatus?.progress?.currentTask || 'Starting scan...'}
              </span>
            </div>
            
            {/* Selected suppliers being scanned */}
            {otherScanDomains.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-xs font-medium text-blue-700">Scanning:</span>
                {otherScanDomains.slice(0, 10).map((domain) => (
                  <span
                    key={domain}
                    className="text-xs px-2 py-0.5 rounded-full bg-white/80 border border-blue-200 text-blue-700"
                  >
                    {domain}
                  </span>
                ))}
                {otherScanDomains.length > 10 && (
                  <span className="text-xs text-blue-700">+{otherScanDomains.length - 10} more</span>
                )}
              </div>
            )}

            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ 
                  width: `${(jobStatus?.progress?.processed || 0) / Math.max(jobStatus?.progress?.total || 1, 1) * 100}%` 
                }}
              />
            </div>
            
            {/* Lean quote while scanning */}
            <blockquote className="mt-3 text-center px-4 py-2 bg-white/50 rounded-lg border border-blue-100 transition-opacity duration-500">
              <p className="text-xs italic text-blue-700">"{leanQuote.quote}"</p>
              <footer className="text-xs text-blue-500 mt-1">— {leanQuote.author}</footer>
            </blockquote>
            
            {/* Live updates feed */}
            {jobStatus?.logs && jobStatus.logs.length > 0 && (
              <div className="mt-3 bg-white/70 border border-blue-200 rounded-xl p-3 max-h-28 overflow-y-auto">
                <div className="text-xs font-semibold text-blue-800 mb-2">Live updates</div>
                <div className="space-y-1">
                  {jobStatus.logs.slice(0, 8).map((line, idx) => (
                    <div key={idx} className="text-xs text-blue-900 whitespace-nowrap truncate">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suppliers found so far */}
            {foundOtherSupplierNames.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-xs font-medium text-blue-700">Found:</span>
                {foundOtherSupplierNames.slice(0, 10).map((name) => (
                  <span
                    key={name}
                    className="text-xs px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700"
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}

            {/* Other Orders Items */}
            {otherOrders.length > 0 && (
              <div className="mt-4 max-h-32 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2">
                  {otherOrders.flatMap((order, orderIdx) => 
                    order.items.slice(0, 4).map((item, itemIdx) => (
                      <div 
                        key={`${orderIdx}-${itemIdx}`} 
                        className="bg-white rounded-lg px-3 py-2 text-sm flex items-center gap-2"
                      >
                        <Icons.Package className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="truncate text-arda-text-primary">
                          {item.name}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Supplier Grid */}
        {!isScanning && hasDiscovered && supplierCount > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {supplierGridItems.map(({ supplier, colors, isEnabled }) => (
              <div
                key={supplier.domain}
                onClick={() => handleToggleSupplier(supplier.domain)}
                className={`
                  relative aspect-square p-3 rounded-xl border-2 cursor-pointer transition-all
                  flex flex-col items-center justify-center text-center
                  ${isEnabled 
                    ? 'bg-white border-arda-accent shadow-md scale-105' 
                    : 'bg-gray-50 border-gray-200 hover:border-gray-300 opacity-60 hover:opacity-100'
                  }
                `}
              >
                {isEnabled && (
                  <div className="absolute top-2 right-2">
                    <Icons.CheckCircle2 className="w-5 h-5 text-arda-accent" />
                  </div>
                )}
                <div className="text-2xl mb-1">{colors.icon}</div>
                <div className="text-sm font-medium text-arda-text-primary truncate w-full">
                  {supplier.displayName}
                </div>
                {supplier.emailCount > 0 && (
                  <div className="text-xs text-arda-text-muted">
                    {supplier.emailCount} emails
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Discovering state */}
        {isDiscovering && (
          <div className="flex items-center justify-center py-8">
            <Icons.Loader2 className="w-6 h-6 text-blue-500 animate-spin mr-3" />
            <span className="text-arda-text-secondary">{discoveryProgress}</span>
          </div>
        )}

      </div>

      {/* Insights Preview Card - Tease value */}
      {allItems.length >= 10 && (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <Icons.BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-arda-text-primary mb-2">
                Insights Coming Soon...
              </h3>
              <p className="text-arda-text-secondary mb-4">
                Based on your {allItems.length} items, Arda will help you:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white/70 rounded-lg p-3">
                  <div className="text-lg font-bold text-purple-600">🔄</div>
                  <div className="text-sm font-medium text-arda-text-primary">Auto-Reorder</div>
                  <div className="text-xs text-arda-text-muted">Set up Kanban cards</div>
                </div>
                <div className="bg-white/70 rounded-lg p-3">
                  <div className="text-lg font-bold text-blue-600">📈</div>
                  <div className="text-sm font-medium text-arda-text-primary">Track Velocity</div>
                  <div className="text-xs text-arda-text-muted">See consumption patterns</div>
                </div>
                <div className="bg-white/70 rounded-lg p-3">
                  <div className="text-lg font-bold text-green-600">💰</div>
                  <div className="text-sm font-medium text-arda-text-primary">Optimize Spend</div>
                  <div className="text-xs text-arda-text-muted">Find savings opportunities</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Note: Navigation handled by OnboardingFlow footer */}
    </div>
  );
};
