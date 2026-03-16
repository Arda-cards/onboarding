import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import {
  API_BASE_URL,
  discoverApi,
  jobsApi,
  JobStatus,
  DiscoveredSupplier,
  isSessionExpiredError,
  gmailApi,
  ApiRequestError,
} from '../services/api';
import { mergeSuppliers } from '../utils/supplierUtils';
import {
  buildSupplierGridItems,
  canonicalizePrioritySupplierDomain,
  calculateProgressPercent,
  getPrioritySummaryText,
  getMilestoneMessage,
  isPrioritySupplierDomain,
  MILESTONES,
  OTHER_PRIORITY_SUPPLIERS,
  PRIORITY_SUPPLIER_SCAN_DOMAINS,
} from './supplierSetupUtils';

// Module-level cache for discovery results to handle StrictMode remounts
// When the first mount's API call completes, results are cached here
// so the second mount can use them instead of making another call
let moduleDiscoveryPromise: Promise<{ suppliers: DiscoveredSupplier[] }> | null = null;
let moduleDiscoveryResult: DiscoveredSupplier[] | null = null;
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.';
const GMAIL_REQUIRED_MESSAGE = 'Connect Gmail to start email analysis.';

export interface BackgroundEmailProgress {
  isActive: boolean;
  phase: 'connecting_gmail' | 'scanning_amazon' | 'scanning_priority' | 'optional_suppliers' | 'ready';
  title: string;
  supplier: string;
  processed: number;
  total: number;
  currentTask?: string;
  lastCompleted?: string;
  nextAction: string;
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
  hasStartedOtherImport?: boolean;
  selectedOtherSuppliers?: string[];
}

interface SupplierSetupProps {
  onScanComplete: (orders: ExtractedOrder[]) => void;
  onSkip: () => void;
  onProgressUpdate?: (progress: BackgroundEmailProgress | null) => void;
  onCanProceed?: (canProceed: boolean) => void;
  onStateChange?: (state: EmailScanState) => void;
  initialState?: EmailScanState;
  embedded?: boolean;
}

export const SupplierSetup: React.FC<SupplierSetupProps> = ({
  onScanComplete,
  onProgressUpdate,
  onCanProceed,
  onStateChange,
  initialState,
  embedded = false,
}) => {
  // Track if we already have restored state (don't restart scans)
  const hasRestoredState = Boolean(initialState && (initialState.amazonOrders.length > 0 || initialState.priorityOrders.length > 0 || initialState.otherOrders.length > 0));
  
  // Onboarding phase states
  const [showWelcome, setShowWelcome] = useState(!hasRestoredState);
  const [celebratingMilestone, setCelebratingMilestone] = useState<string | null>(null);
  const [achievedMilestones, setAchievedMilestones] = useState<Set<string>>(new Set());

  // Discovery progress messages for better feedback
  const [discoveryMessageIndex, setDiscoveryMessageIndex] = useState(0);
  const DISCOVERY_MESSAGES = useMemo(() => [
    'Scanning recent supplier emails...',
    'Identifying supplier domains...',
    'Checking order confirmations...',
    'Looking for invoices and receipts...',
    'Preparing optional supplier suggestions...',
  ], []);

  // Amazon processing state (starts immediately if no initial state)
  const [amazonJobId, setAmazonJobId] = useState<string | null>(null);
  const [amazonStatus, setAmazonStatus] = useState<JobStatus | null>(null);
  const [amazonOrders, setAmazonOrders] = useState<ExtractedOrder[]>(initialState?.amazonOrders || []);
  const [amazonError, setAmazonError] = useState<string | null>(null);
  const [isAmazonComplete, setIsAmazonComplete] = useState(initialState?.isAmazonComplete || false);
  const amazonPollAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Priority suppliers (McMaster-Carr, Uline) processing state (starts immediately if no initial state)
  const [priorityJobId, setPriorityJobId] = useState<string | null>(null);
  const [priorityStatus, setPriorityStatus] = useState<JobStatus | null>(null);
  const [priorityOrders, setPriorityOrders] = useState<ExtractedOrder[]>(initialState?.priorityOrders || []);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const [isPriorityComplete, setIsPriorityComplete] = useState(initialState?.isPriorityComplete || false);
  const priorityPollAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; gmailEmail?: string | null } | null>(null);
  const [gmailStatusError, setGmailStatusError] = useState<string | null>(null);

  // Discovery state (runs in parallel)
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>(initialState?.discoveredSuppliers || []);
  const [enabledSuppliers, setEnabledSuppliers] = useState<Set<string>>(() => {
    const base = new Set<string>();
    if (initialState?.selectedOtherSuppliers) {
      initialState.selectedOtherSuppliers.forEach(domain => {
        const normalizedDomain = canonicalizePrioritySupplierDomain(domain);
        if (!isPrioritySupplierDomain(normalizedDomain) && !normalizedDomain.includes('amazon')) {
          base.add(normalizedDomain);
        }
      });
    }
    return base;
  });
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [hasDiscovered, setHasDiscovered] = useState(initialState?.hasDiscovered || false);
  // Ref to prevent re-triggering discovery after an error (avoids infinite loop)
  // Initialize based on whether we already have discovered state (handles StrictMode remounts)
  const hasInitiatedDiscovery = useRef(initialState?.hasDiscovered || false);

  // Other suppliers scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [otherOrders, setOtherOrders] = useState<ExtractedOrder[]>(initialState?.otherOrders || []);
  const [otherScanError, setOtherScanError] = useState<string | null>(null);
  const otherPollAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [hasStartedOtherImport, setHasStartedOtherImport] = useState<boolean>(
    initialState?.hasStartedOtherImport || false,
  );

  const getErrorMessage = useCallback((error: unknown, fallback: string): string => {
    if (isSessionExpiredError(error)) {
      return SESSION_EXPIRED_MESSAGE;
    }
    if (error instanceof ApiRequestError && error.code === 'GMAIL_AUTH_REQUIRED') {
      return GMAIL_REQUIRED_MESSAGE;
    }
    return error instanceof Error && error.message ? error.message : fallback;
  }, []);

  const isGmailConnected = Boolean(gmailStatus?.connected);

  useEffect(() => {
    let isMounted = true;

    const loadGmailStatus = async () => {
      try {
        const status = await gmailApi.getStatus();
        if (isMounted) {
          setGmailStatus(status);
          setGmailStatusError(null);
        }
      } catch (error: unknown) {
        const message = getErrorMessage(error, 'Unable to check Gmail connection.');
        if (isMounted) {
          setGmailStatusError(message);
          setGmailStatus({ connected: false, gmailEmail: null });
        }
      }
    };

    void loadGmailStatus();

    return () => {
      isMounted = false;
    };
  }, [getErrorMessage]);

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
  const allSuppliers = useMemo(
    () =>
      mergeSuppliers(OTHER_PRIORITY_SUPPLIERS, discoveredSuppliers, {
        canonicalizeDomain: canonicalizePrioritySupplierDomain,
      }),
    [discoveredSuppliers],
  );

  // Filter out priority suppliers for the selectable list
  const selectableOtherSuppliers = useMemo(
    () =>
      allSuppliers.filter(
        s => !isPrioritySupplierDomain(s.domain) && !s.domain.includes('amazon'),
      ),
    [allSuppliers],
  );

  // Suppliers that actually require an explicit import (non-priority, non-Amazon)
  const otherSuppliersToScan = useMemo(() => selectableOtherSuppliers.map(s => s.domain), [selectableOtherSuppliers]);

  const selectedOtherSuppliers = useMemo(
    () => Array.from(enabledSuppliers).filter(domain => otherSuppliersToScan.includes(domain)),
    [enabledSuppliers, otherSuppliersToScan],
  );

  const selectedOtherCount = selectedOtherSuppliers.length;
  const hasSelectableOtherSuppliers = otherSuppliersToScan.length > 0;

  // Check for milestone achievements
  useEffect(() => {
    const newMilestones = new Set(achievedMilestones);
    
    if (allItems.length >= MILESTONES.firstItem && !achievedMilestones.has('firstItem')) {
      newMilestones.add('firstItem');
      setCelebratingMilestone('firstItem');
      setTimeout(() => setCelebratingMilestone(null), 2000);
    }
    
    if (allItems.length >= MILESTONES.tenItems && !achievedMilestones.has('tenItems')) {
      newMilestones.add('tenItems');
      setCelebratingMilestone('tenItems');
      setTimeout(() => setCelebratingMilestone(null), 2000);
    }
    
    if (allItems.length >= MILESTONES.fiftyItems && !achievedMilestones.has('fiftyItems')) {
      newMilestones.add('fiftyItems');
      setCelebratingMilestone('fiftyItems');
      setTimeout(() => setCelebratingMilestone(null), 2500);
    }
    
    if (newMilestones.size !== achievedMilestones.size) {
      setAchievedMilestones(newMilestones);
    }
  }, [allItems.length, achievedMilestones]);

  // Hide welcome after processing starts
  useEffect(() => {
    if (amazonJobId || priorityJobId) {
      const timer = setTimeout(() => setShowWelcome(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [amazonJobId, priorityJobId]);

  // Rotate discovery messages while scanning (every 2.5 seconds)
  useEffect(() => {
    if (!isDiscovering) return;
    
    const interval = setInterval(() => {
      setDiscoveryMessageIndex(prev => (prev + 1) % DISCOVERY_MESSAGES.length);
    }, 2500);
    
    return () => clearInterval(interval);
  }, [isDiscovering, DISCOVERY_MESSAGES.length]);

  // 1. START PRIORITY SUPPLIERS - start immediately (light jitter handled server-side)
  // Skip if we have restored state (user navigated back)
  useEffect(() => {
    // Skip initialization if we restored from saved state
    if (hasRestoredState) {
      console.log('📦 Restored email scan state - skipping initialization');
      return;
    }

    if (!isGmailConnected) {
      return;
    }
    
    let amazonRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    let priorityRetryTimeout: ReturnType<typeof setTimeout> | null = null;
    
    // Start Amazon with retry logic
    const startAmazon = async (retryCount = 0) => {
      try {
        console.log(`🛒 Starting Amazon processing${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        const response = await jobsApi.startAmazon();
        setAmazonJobId(response.jobId);
        setAmazonError(null);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, 'Failed to start Amazon processing');
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
    
    // Start McMaster-Carr and Uline
    const startPrioritySuppliers = async (retryCount = 0) => {
      try {
        console.log(`🏭 Starting McMaster-Carr & Uline${retryCount > 0 ? ` (retry ${retryCount})` : ''}...`);
        const response = await jobsApi.startJob(PRIORITY_SUPPLIER_SCAN_DOMAINS, 'priority');
        setPriorityJobId(response.jobId);
        setPriorityError(null);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, 'Failed to start McMaster-Carr & Uline');
        console.error('Priority suppliers error:', errorMessage);
        
        // Retry on rate limit (up to 3 times)
        if (retryCount < 3 && (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('Too many'))) {
          const retryDelay = (retryCount + 1) * 4000; // 4s, 8s, 12s
          console.log(`⏳ Rate limited, retrying priority suppliers in ${retryDelay / 1000}s...`);
          priorityRetryTimeout = setTimeout(() => startPrioritySuppliers(retryCount + 1), retryDelay);
        } else {
          setPriorityError(errorMessage);
        }
      }
    };
    
    // Start Amazon immediately
    startAmazon();
    
    // Start priority suppliers immediately (server manages rate limiting)
    startPrioritySuppliers();
    
    // Cleanup on unmount
    return () => {
      if (amazonRetryTimeout) clearTimeout(amazonRetryTimeout);
      if (priorityRetryTimeout) clearTimeout(priorityRetryTimeout);
    };
  }, [getErrorMessage, hasRestoredState, isGmailConnected]);

  // Discover suppliers - memoized to allow proper dependency tracking
  // Uses module-level caching to handle StrictMode remounts
  const handleDiscoverSuppliers = useCallback(async () => {
    if (!isGmailConnected) {
      setDiscoverError(GMAIL_REQUIRED_MESSAGE);
      setHasDiscovered(true);
      return;
    }
    // Check if we already have cached results (from previous mount in StrictMode)
    if (moduleDiscoveryResult) {
      setDiscoveredSuppliers(moduleDiscoveryResult);
      setHasDiscovered(true);
      return;
    }
    
    setIsDiscovering(true);
    setDiscoverError(null);
    
    try {
      // Reuse in-flight promise if one exists (prevents duplicate API calls)
      if (!moduleDiscoveryPromise) {
        moduleDiscoveryPromise = discoverApi.discoverSuppliers();
      }
      
      const result = await moduleDiscoveryPromise;
      // Filter out Amazon since we handle it separately
      const nonAmazonSuppliers = result.suppliers.filter((s: DiscoveredSupplier) => !s.domain.includes('amazon'));
      
      // Cache the result for potential StrictMode remount
      moduleDiscoveryResult = nonAmazonSuppliers;
      
      setDiscoveredSuppliers(nonAmazonSuppliers);
      setHasDiscovered(true);
    } catch (err: unknown) {
      console.error('Discovery error:', err);
      const message = getErrorMessage(err, 'Failed to discover suppliers');
      setDiscoverError(message);
      // Still mark as discovered so the grid shows (with priority suppliers at minimum)
      setHasDiscovered(true);
      // Clear the failed promise so next attempt can retry
      moduleDiscoveryPromise = null;
    } finally {
      setIsDiscovering(false);
    }
  }, [getErrorMessage, isGmailConnected]);

  // 2. START SUPPLIER DISCOVERY (start immediately for faster supplier identification)
  // Uses ref to prevent infinite loop and module-level caching for StrictMode
  useEffect(() => {
    if (!isGmailConnected) return;
    if (!hasDiscovered && !isDiscovering && !hasInitiatedDiscovery.current) {
      hasInitiatedDiscovery.current = true;
      handleDiscoverSuppliers();
    }
  }, [hasDiscovered, isDiscovering, handleDiscoverSuppliers, isGmailConnected]);

  useEffect(() => {
    if (!isGmailConnected) return;
    if (discoverError === GMAIL_REQUIRED_MESSAGE) {
      setDiscoverError(null);
      setHasDiscovered(false);
      hasInitiatedDiscovery.current = false;
    }
  }, [discoverError, isGmailConnected]);

  // Poll Amazon job status with adaptive backoff
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
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setAmazonOrders(convertedOrders);
      }
      
      if (status.status === 'completed' || status.status === 'failed') {
        setIsAmazonComplete(true);
        amazonPollAbortRef.current.cancelled = true;
      }
    } catch (error) {
      console.error('Amazon polling error:', error);
    }
  }, [amazonJobId]);

  useEffect(() => {
    if (amazonJobId && !isAmazonComplete) {
      const pollState = amazonPollAbortRef.current;
      pollState.cancelled = false;
      const pollWithBackoff = async (delayMs: number) => {
        if (pollState.cancelled) return;
        await pollAmazonStatus();
        if (!pollState.cancelled) {
          const nextDelay = Math.min(Math.floor(delayMs * 1.35), 1800);
          setTimeout(() => pollWithBackoff(nextDelay), nextDelay);
        }
      };
      pollWithBackoff(700);
      return () => {
        pollState.cancelled = true;
      };
    }
  }, [amazonJobId, isAmazonComplete, pollAmazonStatus]);

  // Poll Priority Suppliers (McMaster-Carr, Uline) job status with adaptive backoff
  const pollPriorityStatus = useCallback(async () => {
    if (!priorityJobId) return;
    
    try {
      const status = await jobsApi.getStatus(priorityJobId);
      setPriorityStatus(status);
      
      if (Array.isArray(status.orders)) {
        const convertedOrders: ExtractedOrder[] = status.orders.map(o => ({
          id: o.id,
          originalEmailId: o.id,
          supplier: o.supplier,
          orderDate: o.orderDate,
          totalAmount: o.totalAmount,
          items: o.items,
          confidence: o.confidence,
        }));
        setPriorityOrders(convertedOrders);
      }
      
      if (status.status === 'failed') {
        setPriorityError(status.error || 'Failed to process McMaster-Carr & Uline emails');
        setIsPriorityComplete(true);
        priorityPollAbortRef.current.cancelled = true;
      } else if (status.status === 'completed') {
        setIsPriorityComplete(true);
        priorityPollAbortRef.current.cancelled = true;
      }
    } catch (error) {
      console.error('Priority polling error:', error);
    }
  }, [priorityJobId]);

  useEffect(() => {
    if (priorityJobId && !isPriorityComplete) {
      const pollState = priorityPollAbortRef.current;
      pollState.cancelled = false;
      const pollWithBackoff = async (delayMs: number) => {
        if (pollState.cancelled) return;
        await pollPriorityStatus();
        if (!pollState.cancelled) {
          const nextDelay = Math.min(Math.floor(delayMs * 1.35), 1800);
          setTimeout(() => pollWithBackoff(nextDelay), nextDelay);
        }
      };
      pollWithBackoff(700);
      return () => {
        pollState.cancelled = true;
      };
    }
  }, [priorityJobId, isPriorityComplete, pollPriorityStatus]);

  // Notify parent when user can leave email step.
  useEffect(() => {
    const canProceed = hasDiscovered && isAmazonComplete && isPriorityComplete;

    onCanProceed?.(canProceed);
  }, [
    hasDiscovered,
    isAmazonComplete,
    isPriorityComplete,
    onCanProceed,
  ]);

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
      hasStartedOtherImport,
      selectedOtherSuppliers,
    });
  }, [
    amazonOrders,
    priorityOrders,
    otherOrders,
    isAmazonComplete,
    isPriorityComplete,
    discoveredSuppliers,
    hasDiscovered,
    hasStartedOtherImport,
    selectedOtherSuppliers,
    onStateChange,
  ]);


  // Poll job status for other suppliers with adaptive backoff
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
        otherPollAbortRef.current.cancelled = true;
      }
    } catch (error) {
      console.error('Job polling error:', error);
    }
  }, [currentJobId]);

  useEffect(() => {
    if (currentJobId && isScanning) {
      const pollState = otherPollAbortRef.current;
      pollState.cancelled = false;
      const pollWithBackoff = async (delayMs: number) => {
        if (pollState.cancelled) return;
        await pollJobStatus();
        if (!pollState.cancelled) {
          const nextDelay = Math.min(Math.floor(delayMs * 1.35), 2000);
          setTimeout(() => pollWithBackoff(nextDelay), nextDelay);
        }
      };
      pollWithBackoff(650);
      return () => {
        pollState.cancelled = true;
      };
    }
  }, [currentJobId, isScanning, pollJobStatus]);

  // Mark that other import was initiated if we resumed an in-flight job or already have data
  useEffect(() => {
    if (!hasStartedOtherImport && (currentJobId || otherOrders.length > 0)) {
      setHasStartedOtherImport(true);
    }
  }, [currentJobId, otherOrders.length, hasStartedOtherImport]);

  // Scan selected suppliers
  const handleScanSuppliers = useCallback(async () => {
    if (isScanning || currentJobId || hasStartedOtherImport) {
      return;
    }

    if (!isGmailConnected) {
      setOtherScanError(GMAIL_REQUIRED_MESSAGE);
      return;
    }

    // Filter to only non-Amazon, non-priority enabled suppliers
    const domainsToScan = Array.from(
      new Set(Array.from(enabledSuppliers).map((domain) => canonicalizePrioritySupplierDomain(domain))),
    ).filter((domain) => !domain.includes('amazon') && !isPrioritySupplierDomain(domain));
    
    if (domainsToScan.length === 0) {
      return; // Nothing additional to scan
    }

    setIsScanning(true);
    setJobStatus(null);
    setOtherScanError(null);
    
    try {
      const response = await jobsApi.startJob(domainsToScan, 'other');
      setCurrentJobId(response.jobId);
      setHasStartedOtherImport(true);
    } catch (error) {
      console.error('Scan error:', error);
      setOtherScanError(getErrorMessage(error, 'Failed to start selected supplier import.'));
      setIsScanning(false);
    }
  }, [
    enabledSuppliers,
    getErrorMessage,
    hasStartedOtherImport,
    currentJobId,
    isScanning,
    isGmailConnected,
  ]);

  const handleToggleSupplier = useCallback((domain: string) => {
    const normalizedDomain = canonicalizePrioritySupplierDomain(domain);
    setEnabledSuppliers(prev => {
      const next = new Set(prev);
      if (next.has(normalizedDomain)) {
        next.delete(normalizedDomain);
      } else {
        next.add(normalizedDomain);
      }
      return next;
    });
    setOtherScanError(null);
  }, []);

  // Keep parent updated with collected orders as they come in
  useEffect(() => {
    if (combinedOrders.length > 0) {
      onScanComplete(combinedOrders);
    }
  }, [combinedOrders, onScanComplete]);

  const supplierCount = selectableOtherSuppliers.length;
  const isPriorityProcessing = useMemo(
    () => Boolean(!isPriorityComplete && priorityJobId),
    [isPriorityComplete, priorityJobId],
  );
  const isAnyProcessing = useMemo(
    () => Boolean((!isAmazonComplete && amazonJobId) || isPriorityProcessing || isScanning),
    [isAmazonComplete, amazonJobId, isPriorityProcessing, isScanning],
  );

  const backgroundProgress = useMemo<BackgroundEmailProgress>(() => {
    if (!isGmailConnected) {
      return {
        isActive: false,
        phase: 'connecting_gmail',
        title: 'Connect Gmail',
        supplier: 'Gmail',
        processed: 0,
        total: 0,
        nextAction: 'Go back one step and connect Gmail to start email import.',
      };
    }

    if (!isAmazonComplete && amazonStatus?.progress) {
      return {
        isActive: true,
        phase: 'scanning_amazon',
        title: 'Scanning Amazon',
        supplier: 'Amazon',
        processed: amazonStatus.progress.processed || 0,
        total: amazonStatus.progress.total || 0,
        currentTask: amazonStatus.progress.currentTask || amazonStatus.currentEmail?.subject || undefined,
        nextAction: 'You can continue once Amazon and priority suppliers finish.',
      };
    }

    if (isPriorityProcessing && priorityStatus?.progress) {
      return {
        isActive: true,
        phase: 'scanning_priority',
        title: 'Scanning priority suppliers',
        supplier: 'McMaster-Carr & Uline',
        processed: priorityStatus.progress.processed || 0,
        total: priorityStatus.progress.total || 0,
        currentTask: priorityStatus.progress.currentTask || priorityStatus.currentEmail?.subject || undefined,
        lastCompleted: isAmazonComplete ? 'Amazon' : undefined,
        nextAction: 'You can continue after priority suppliers finish, or start optional supplier imports next.',
      };
    }

    if (isScanning && jobStatus?.progress) {
      return {
        isActive: true,
        phase: 'optional_suppliers',
        title: 'Scanning optional suppliers',
        supplier: 'Additional suppliers',
        processed: jobStatus.progress.processed || 0,
        total: jobStatus.progress.total || 0,
        currentTask: jobStatus.progress.currentTask || jobStatus.currentEmail?.subject || undefined,
        lastCompleted: 'Amazon and priority suppliers',
        nextAction: 'This scan keeps running if you move to the next step.',
      };
    }

    if (hasSelectableOtherSuppliers) {
      return {
        isActive: false,
        phase: 'ready',
        title: 'Ready for optional suppliers',
        supplier: 'Optional suppliers',
        processed: selectedOtherCount,
        total: supplierCount,
        lastCompleted: 'Amazon and priority suppliers',
        nextAction: hasStartedOtherImport
          ? 'Optional supplier import has started and will keep running in the background.'
          : 'Select any additional suppliers you want to scan, or continue to the next step.',
      };
    }

    return {
      isActive: false,
      phase: 'ready',
      title: 'Ready to continue',
      supplier: 'Email import',
      processed: totalOrders,
      total: totalOrders,
      lastCompleted: 'Amazon and priority suppliers',
      nextAction: 'Continue to the next step whenever you are ready.',
    };
  }, [
    amazonStatus,
    hasSelectableOtherSuppliers,
    hasStartedOtherImport,
    isAmazonComplete,
    isGmailConnected,
    isPriorityProcessing,
    isScanning,
    jobStatus,
    priorityStatus,
    selectedOtherCount,
    supplierCount,
    totalOrders,
  ]);

  // Report progress to parent component for background display
  useEffect(() => {
    if (!onProgressUpdate) return;

    onProgressUpdate(backgroundProgress);
  }, [backgroundProgress, onProgressUpdate]);

  const milestoneMessage = useMemo(
    () => (celebratingMilestone ? getMilestoneMessage(celebratingMilestone) : null),
    [celebratingMilestone],
  );
  
  // Priority suppliers progress
  const priorityProgress = priorityStatus?.progress;
  const priorityProgressPercent = useMemo(
    () => calculateProgressPercent(priorityProgress),
    [priorityProgress],
  );
  const priorityOrderCount = priorityOrders.length;
  const priorityItemCount = useMemo(
    () => priorityOrders.reduce((sum, order) => sum + order.items.length, 0),
    [priorityOrders],
  );
  const priorityProcessedEmails = priorityProgress?.processed ?? 0;
  const priorityTotalEmails = priorityProgress?.total ?? 0;
  const prioritySummaryText = getPrioritySummaryText({
    error: priorityError,
    isComplete: isPriorityComplete,
    processedEmails: priorityProcessedEmails,
    totalEmails: priorityTotalEmails,
    orderCount: priorityOrderCount,
    itemCount: priorityItemCount,
  });

  // Amazon progress
  const amazonProgress = amazonStatus?.progress;
  const amazonProgressPercent = useMemo(
    () => calculateProgressPercent(amazonProgress),
    [amazonProgress],
  );

  const supplierGridItems = useMemo(
    () => buildSupplierGridItems(selectableOtherSuppliers, enabledSuppliers),
    [selectableOtherSuppliers, enabledSuppliers],
  );

  return (
    <div className={embedded ? 'max-w-5xl mx-auto pb-32 space-y-5 relative' : 'max-w-5xl mx-auto p-6 pb-32 space-y-5 relative'}>
      
      {/* Milestone Celebration Overlay */}
      {milestoneMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center animate-bounce-in border-4 border-arda-accent">
            <div className="text-6xl mb-4">{milestoneMessage.emoji}</div>
            <h2 className="text-2xl font-bold text-arda-text-primary mb-2">
              {milestoneMessage.title}
            </h2>
            <p className="text-arda-text-secondary">
              {milestoneMessage.subtitle}
            </p>
          </div>
          {/* Confetti effect */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute animate-confetti"
                style={{
                  left: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 0.5}s`,
                  backgroundColor: ['var(--arda-success)', 'var(--arda-info)', 'var(--arda-warning)', 'var(--arda-danger)', 'var(--arda-series-4)'][i % 5],
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Welcome Header - Animated intro */}
      {showWelcome && (
        <div className="text-center py-8 animate-fade-in">
          <div className="inline-flex items-center gap-2 bg-arda-accent/10 text-arda-accent px-4 py-2 rounded-full text-sm font-medium mb-4">
            <Icons.Mail className="w-4 h-4" />
            Email import in progress
          </div>
          <h1 className="text-3xl font-bold text-arda-text-primary mb-3">
            Import your first items from email
          </h1>
          <p className="text-arda-text-secondary max-w-lg mx-auto">
            We are connecting Gmail, scanning Amazon and priority suppliers, and preparing optional suppliers for review.
            You can continue once the required scans finish.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-arda-info-border bg-arda-info-bg p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-arda-info-text">
              <Icons.Activity className="w-4 h-4" />
              {backgroundProgress.title}
            </div>
            <p className="mt-1 text-sm text-arda-text-primary">
              {backgroundProgress.currentTask || backgroundProgress.supplier}
            </p>
            <p className="mt-2 text-sm text-arda-info-text">
              {backgroundProgress.nextAction}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm min-w-0 lg:min-w-[24rem]">
            <div className="rounded-xl border border-arda-info-border bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-arda-info">Phase</div>
              <div className="mt-1 font-semibold text-arda-text-primary">{backgroundProgress.title}</div>
            </div>
            <div className="rounded-xl border border-arda-info-border bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-arda-info">Progress</div>
              <div className="mt-1 font-semibold text-arda-text-primary">
                {backgroundProgress.total > 0
                  ? `${backgroundProgress.processed} / ${backgroundProgress.total}`
                  : 'Waiting for scan results'}
              </div>
            </div>
            <div className="rounded-xl border border-arda-info-border bg-white px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-arda-info">Last completed</div>
              <div className="mt-1 font-semibold text-arda-text-primary">
                {backgroundProgress.lastCompleted || 'Connecting Gmail'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Stats Bar */}
      {(allItems.length > 0 || totalOrders > 0) && (
        <div className={`bg-gradient-to-r from-arda-accent to-arda-accent-hover rounded-2xl p-6 text-white shadow-lg ${isGmailConnected ? '' : 'opacity-60'}`}>
          <div className="grid grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-4xl font-bold">{allItems.length}</div>
              <div className="text-white/80 text-sm">Items Found</div>
            </div>
            <div>
              <div className="text-4xl font-bold">{totalOrders}</div>
              <div className="text-white/80 text-sm">Orders</div>
            </div>
            <div>
              <div className="text-4xl font-bold">{uniqueSuppliers}</div>
              <div className="text-white/80 text-sm">Suppliers</div>
            </div>
            <div>
              <div className="text-4xl font-bold">
                ${totalSpend >= 1000 ? `${(totalSpend / 1000).toFixed(1)}k` : totalSpend.toFixed(0)}
              </div>
              <div className="text-white/80 text-sm">Tracked</div>
            </div>
          </div>
          
          {allItems.length >= 5 && (
            <div className="mt-4 pt-4 border-t border-white/20 text-center">
              <p className="text-white/90 text-sm">
                You can continue now and keep reviewing items while the rest of email import finishes in the background.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Header when not showing welcome */}
      {!showWelcome && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-arda-text-primary">Importing Your Orders</h1>
            <p className="text-arda-text-secondary mt-1">
              {isAnyProcessing 
                ? 'Tracking supplier scans and preparing items for review.'
                : 'Required email import is done. Optional supplier imports can continue in the background.'}
            </p>
          </div>
        </div>
      )}

      {!isGmailConnected && (
        <div className="border border-arda-border rounded-2xl p-6 bg-arda-bg-secondary">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-arda-accent text-white flex items-center justify-center">
              <Icons.Mail className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-arda-text-primary">Gmail not connected</h3>
              <p className="text-sm text-arda-text-secondary mt-1">
                {gmailStatusError || 'Go back to the Welcome step and click "Connect Gmail & start sync" to link your Google account, or skip this step.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  window.location.href = `${API_BASE_URL}/auth/google?returnTo=email`;
                }}
                className="mt-4 inline-flex items-center gap-2 btn-arda-primary !rounded-lg"
              >
                <Icons.Link className="w-4 h-4" />
                Connect Gmail
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Amazon Processing Card - Premium look */}
      <div className={`border-2 rounded-2xl p-6 transition-all ${
        amazonError
          ? 'bg-arda-danger-bg border-arda-danger-border'
          : isAmazonComplete 
            ? amazonOrders.length > 0
              ? 'bg-arda-success-bg border-arda-success-border shadow-md' 
              : 'bg-arda-bg-secondary border-arda-border'
            : 'bg-arda-warning-bg border-arda-warning-border shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isAmazonComplete ? 'bg-arda-success' : 'bg-arda-accent'
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
              <p className={`text-sm ${amazonError ? 'text-arda-danger-text' : 'text-arda-text-secondary'}`}>
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
              <div className="text-2xl font-bold text-arda-accent">
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
            <div className="h-3 bg-arda-warning-soft rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-arda-accent to-arda-accent-hover transition-all duration-300 rounded-full"
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
                    className="bg-white border border-arda-border rounded-xl p-3 flex items-center gap-3 hover:shadow-md transition-shadow"
                  >
                    {item.amazonEnriched?.imageUrl ? (
                      <img 
                        src={item.amazonEnriched.imageUrl} 
                        alt="" 
                        className="w-14 h-14 object-contain flex-shrink-0 rounded-lg bg-arda-bg-secondary"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-arda-warning-bg rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icons.Package className="w-7 h-7 text-arda-accent" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-arda-text-primary line-clamp-2">
                        {item.amazonEnriched?.itemName || item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {(item.unitPrice ?? 0) > 0 && (
                          <span className="text-sm text-arda-success-text font-bold">
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
          ? 'bg-arda-danger-bg border-arda-danger-border'
          : isPriorityComplete 
            ? 'bg-arda-success-bg border-arda-success-border shadow-md'
            : 'bg-arda-info-bg border-arda-info-border shadow-sm'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isPriorityComplete ? 'bg-arda-success' : 'bg-arda-info'
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
              <p className={`text-sm ${priorityError ? 'text-arda-danger-text' : 'text-arda-text-secondary'}`}>
                {prioritySummaryText}
              </p>
            </div>
          </div>
          
          {priorityProgress && !isPriorityComplete && !priorityError && (
            <div className="text-right">
              <div className="text-2xl font-bold text-arda-info-text">
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
            <div className="h-3 bg-arda-info-soft rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-arda-info to-arda-info-text transition-all duration-300 rounded-full"
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
                    className="bg-white border border-arda-border rounded-xl p-3 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 bg-arda-info-bg rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icons.Package className="w-5 h-5 text-arda-info" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-arda-text-primary line-clamp-1">
                        {item.name}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {(item.unitPrice ?? 0) > 0 && (
                          <span className="text-sm text-arda-info-text font-bold">
                            ${(item.unitPrice ?? 0).toFixed(2)}
                          </span>
                        )}
                        {item.quantity > 1 && (
                          <span className="text-xs text-arda-text-muted bg-arda-bg-tertiary px-1.5 py-0.5 rounded">
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
      <div className="border-2 border-arda-border rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-arda-border bg-arda-bg-secondary px-3 py-1 text-xs font-medium text-arda-text-secondary mb-2">
              <Icons.Clock className="w-3.5 h-3.5" />
              Optional
            </div>
            <h3 className="text-xl font-bold text-arda-text-primary">Other Suppliers</h3>
            <p className="text-sm text-arda-text-secondary">
              {isDiscovering 
                ? 'Scanning for additional supplier domains...' 
                : hasStartedOtherImport
                  ? 'Optional supplier import started. You can continue while it runs.'
                  : `${supplierCount} additional suppliers found`}
            </p>
          </div>
          
          {hasDiscovered && !isScanning && hasSelectableOtherSuppliers && (
            <button
              onClick={handleScanSuppliers}
              disabled={selectedOtherCount === 0 || hasStartedOtherImport}
              className={[
                "btn-arda-primary !px-5 !py-2.5 !rounded-xl transition-all flex items-center gap-2",
                selectedOtherCount > 0 && !hasStartedOtherImport
                  ? ""
                  : "bg-arda-border hover:bg-arda-border text-arda-text-muted cursor-not-allowed"
              ].join(" ")}
            >
              <Icons.Download className="w-4 h-4" />
              {hasStartedOtherImport
                ? 'Import started'
                : selectedOtherCount > 0
                ? `Import ${selectedOtherCount} Supplier${selectedOtherCount === 1 ? '' : 's'}`
                : 'Select suppliers to import'}
            </button>
          )}
        </div>

        {otherScanError && !isScanning && (
          <div className="mb-4 bg-arda-danger-bg border border-arda-danger-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Icons.AlertCircle className="w-5 h-5 text-arda-danger flex-shrink-0" />
              <div>
                <span className="font-medium text-arda-danger-text">
                  {otherScanError}
                </span>
                <p className="mt-1 text-sm text-arda-danger-text">
                  Select any suppliers you want to include, then start the optional import or continue without them.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scanning Progress */}
        {isScanning && jobStatus && (
          <div className="mb-4 bg-arda-info-bg border border-arda-info-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <Icons.Loader2 className="w-5 h-5 text-arda-info animate-spin" />
              <span className="font-medium text-arda-info-text">
                {jobStatus.progress?.currentTask || 'Processing...'}
              </span>
            </div>
            <div className="h-2 bg-arda-info-soft rounded-full overflow-hidden">
              <div 
                className="h-full bg-arda-info transition-all duration-300"
                style={{ 
                  width: `${(jobStatus.progress?.processed || 0) / Math.max(jobStatus.progress?.total || 1, 1) * 100}%` 
                }}
              />
            </div>
            
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
                        <Icons.Package className="w-4 h-4 text-arda-success flex-shrink-0" />
                        <span className="truncate text-arda-text-primary">{item.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Discovery Error Message */}
        {discoverError && !isDiscovering && (
          <div className="mb-4 bg-arda-warning-bg border border-arda-warning-border rounded-xl p-4">
            <div className="flex items-center gap-3">
              <Icons.AlertCircle className="w-5 h-5 text-arda-warning flex-shrink-0" />
              <div>
                <span className="font-medium text-arda-warning-text">
                  {discoverError === SESSION_EXPIRED_MESSAGE ? SESSION_EXPIRED_MESSAGE : 'Could not fully discover suppliers'}
                </span>
                <p className="text-sm text-arda-warning mt-1">
                  {discoverError === SESSION_EXPIRED_MESSAGE
                    ? 'Please sign in again to continue importing suppliers.'
                    : 'Showing available suppliers. You can still select and import from the list below.'}
                </p>
              </div>
            </div>
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
                    : 'bg-arda-bg-secondary border-arda-border hover:border-arda-border-hover opacity-60 hover:opacity-100'
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

        {/* Discovering state - Enhanced feedback */}
        {isDiscovering && (
          <div className="py-6 space-y-6">
            {/* Animated progress message */}
            <div className="flex items-center justify-center gap-3">
              <div className="relative">
                <Icons.Loader2 className="w-6 h-6 text-arda-info animate-spin" />
                <div className="absolute inset-0 animate-ping opacity-30">
                  <Icons.Loader2 className="w-6 h-6 text-arda-info" />
                </div>
              </div>
              <span className="text-arda-text-secondary font-medium transition-opacity duration-300">
                {DISCOVERY_MESSAGES[discoveryMessageIndex]}
              </span>
            </div>
            
            {/* Scanning animation - shows activity */}
            <div className="bg-gradient-to-r from-arda-info-bg to-arda-bg-secondary border border-arda-info-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Icons.Search className="w-4 h-4 text-arda-info animate-pulse" />
                <span className="text-sm font-medium text-arda-info-text">
                  {DISCOVERY_MESSAGES[discoveryMessageIndex]}
                </span>
              </div>
              
              {/* Animated scanning bars */}
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div 
                      className="h-2 rounded-full animate-shimmer"
                      style={{ 
                        width: `${65 + i * 8}%`,
                        animationDelay: `${i * 150}ms`,
                      }}
                    />
                    <div className="w-2 h-2 rounded-full bg-arda-info animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Skeleton placeholder grid for suppliers being discovered */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="aspect-square p-3 rounded-xl border-2 border-arda-border bg-arda-bg-secondary flex flex-col items-center justify-center animate-pulse"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <div className="w-8 h-8 rounded-lg bg-arda-border mb-2" />
                  <div className="w-16 h-3 rounded bg-arda-border" />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Insights Preview Card - Tease value */}
      {allItems.length >= 10 && (
        <div className="bg-gradient-to-br from-arda-info-bg to-arda-bg-secondary border-2 border-arda-info-border rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-arda-info rounded-xl flex items-center justify-center flex-shrink-0">
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
                <div className="bg-white/70 border border-arda-border rounded-lg p-3">
                  <div className="text-lg font-bold text-arda-info-text">🔄</div>
                  <div className="text-sm font-medium text-arda-text-primary">Auto-Reorder</div>
                  <div className="text-xs text-arda-text-muted">Set up Kanban cards</div>
                </div>
                <div className="bg-white/70 border border-arda-border rounded-lg p-3">
                  <div className="text-lg font-bold text-arda-info-text">📈</div>
                  <div className="text-sm font-medium text-arda-text-primary">Track Velocity</div>
                  <div className="text-xs text-arda-text-muted">See consumption patterns</div>
                </div>
                <div className="bg-white/70 border border-arda-border rounded-lg p-3">
                  <div className="text-lg font-bold text-arda-success-text">💰</div>
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
