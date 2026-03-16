import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '../components/Icons';
import { ExtractedOrder } from '../types';
import { buildVelocityProfiles, normalizeItemName } from '../utils/inventoryLogic';
import { SupplierSetup, EmailScanState, BackgroundEmailProgress } from './SupplierSetup';
import { UrlScrapeStep, UrlReviewState } from './UrlScrapeStep';
import { BarcodeScanStep } from './BarcodeScanStep';
import { PhotoCaptureStep } from './PhotoCaptureStep';
import { CSVUploadStep, CSVItem, CSVFooterState } from './CSVUploadStep';
import { MasterListStep } from './MasterListStep';
import type { MasterListItem, MasterListFooterState } from '../components/ItemsTable/types';
import { buildMasterListItems } from '../utils/masterListItems';
import { useSyncToArda } from '../hooks/useSyncToArda';
import { IntegrationsStep } from './IntegrationsStep';
import { UrlScrapedItem, gmailApi } from '../services/api';
import { OnboardingWelcomeStep } from './OnboardingWelcomeStep';

// Simple email item for onboarding (before full InventoryItem processing)
interface EmailItem {
  id: string;
  name: string;
  supplier: string;
  asin?: string;
  imageUrl?: string;
  productUrl?: string;
  lastPrice?: number;
  quantity?: number;
  location?: string;
  recommendedMin?: number;
  recommendedOrderQty?: number;
}

// Onboarding step definitions
export type OnboardingStep = 'welcome' | 'email' | 'integrations' | 'url' | 'barcode' | 'photo' | 'csv' | 'masterlist';
type StepGroup = 'required' | 'optional';
type DerivedStepStatus = 'not_started' | 'in_progress' | 'ready' | 'optional' | 'done';

interface StepConfig {
  id: OnboardingStep;
  number: number;
  title: string;
  description: string;
  tipsTitle: string;
  tips: string[];
  icon: keyof typeof Icons;
  group: StepGroup;
  estimatedTime: string;
  bestFor: string;
  valueLabel: string;
}

export interface OnboardingCompletionSummary {
  totalItems: number;
  syncedItems: number;
  unsyncedItems: number;
  needsAttentionItems: number;
  sourceCounts: Record<MasterListItem['source'], number>;
}

interface OnboardingDraftState {
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  hasStartedEmailSync: boolean;
  emailOrders: ExtractedOrder[];
  urlItems: UrlScrapedItem[];
  scannedBarcodes: ScannedBarcode[];
  csvItems: CSVItem[];
  emailScanState?: EmailScanState;
  emailBackgroundProgress?: BackgroundEmailProgress | null;
  urlReviewState?: UrlReviewState;
}

const ONBOARDING_DRAFT_STORAGE_KEY = 'orderPulse_onboardingDraft';

const ONBOARDING_STEPS: StepConfig[] = [
  {
    id: 'welcome',
    number: 1,
    title: 'Welcome',
    description: 'Overview the onboarding path and start your sync',
    tipsTitle: 'What you will do',
    tips: [
      'Start email sync to import orders automatically.',
      'Add items via URLs, barcodes, photos, or CSV.',
      'Review and sync items to Arda.',
    ],
    icon: 'Sparkles',
    group: 'required',
    estimatedTime: '1 min',
    bestFor: 'New accounts',
    valueLabel: 'Choose the fastest import path',
  },
  {
    id: 'email',
    number: 2,
    title: 'Email',
    description: 'Import orders from your inbox',
    tipsTitle: 'What to do',
    tips: [
      'Connect Gmail to start scanning.',
      'Wait for Amazon + priority suppliers to finish.',
      'Select any extra suppliers to import.',
    ],
    icon: 'Mail',
    group: 'required',
    estimatedTime: '2-4 min',
    bestFor: 'Recent purchase history',
    valueLabel: 'Import your first items automatically',
  },
  {
    id: 'integrations',
    number: 3,
    title: 'Integrations',
    description: 'Connect your systems and data sources',
    tipsTitle: 'What to do',
    tips: [
      'Connect QuickBooks or Xero if you want PO data.',
      'Start a sync to pull history.',
      'Continue when ready.',
    ],
    icon: 'Building2',
    group: 'optional',
    estimatedTime: '1-2 min',
    bestFor: 'Purchase order data',
    valueLabel: 'Pull orders from accounting tools',
  },
  {
    id: 'url',
    number: 4,
    title: 'URLs',
    description: 'Import products from links',
    tipsTitle: 'What to do',
    tips: [
      'Paste up to 50 product links.',
      'Click “Scrape URLs.”',
      'Review, edit, approve, or delete rows.',
      'Import approved rows to the master list.',
    ],
    icon: 'Link',
    group: 'optional',
    estimatedTime: '2-5 min',
    bestFor: 'Supplier websites and catalog links',
    valueLabel: 'Turn product links into items',
  },
  {
    id: 'barcode',
    number: 5,
    title: 'UPCs',
    description: 'Scan UPC/EAN codes in your shop',
    tipsTitle: 'What to do',
    tips: [
      'Scan with a USB/Bluetooth scanner or phone camera.',
      'Edit any detected fields as needed.',
      'Confirm items appear below.',
    ],
    icon: 'Barcode',
    group: 'optional',
    estimatedTime: '1-3 min',
    bestFor: 'Items already on shelves',
    valueLabel: 'Capture barcode-based inventory',
  },
  {
    id: 'photo',
    number: 5,
    title: 'Images',
    description: 'Photograph items with labels',
    tipsTitle: 'What to do',
    tips: [
      'Upload photos or use the phone camera.',
      'Wait for AI extraction, then edit any field as needed.',
      'Confirm details before continuing.',
    ],
    icon: 'Camera',
    group: 'optional',
    estimatedTime: '2-4 min',
    bestFor: 'Labels or bins without clean data',
    valueLabel: 'Extract item details from photos',
  },
  {
    id: 'csv',
    number: 6,
    title: 'CSV',
    description: 'Import from spreadsheet',
    tipsTitle: 'What to do',
    tips: [
      'Upload a CSV.',
      'Map columns to fields.',
      'Approve items to import.',
    ],
    icon: 'FileSpreadsheet',
    group: 'optional',
    estimatedTime: '2-4 min',
    bestFor: 'Existing spreadsheets',
    valueLabel: 'Bulk import tabular inventory',
  },
  {
    id: 'masterlist',
    number: 7,
    title: 'Review',
    description: 'Review and sync items',
    tipsTitle: 'What to do',
    tips: [
      'Review and edit item details in the grid below.',
      'Select items and sync to Arda.',
      'Complete setup when ready.',
    ],
    icon: 'ListChecks',
    group: 'required',
    estimatedTime: '2 min',
    bestFor: 'Final review',
    valueLabel: 'Clean up and sync approved items',
  },
];

const emptySourceCounts = (): Record<MasterListItem['source'], number> => ({
  email: 0,
  url: 0,
  barcode: 0,
  photo: 0,
  csv: 0,
});

const loadOnboardingDraft = (): OnboardingDraftState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OnboardingDraftState;
  } catch {
    return null;
  }
};

const ItemsGrid = lazy(async () => {
  const module = await import('../components/ItemsTable/ItemsGrid');
  return { default: module.ItemsGrid };
});

const buildEmailItemsFromOrders = (orders: ExtractedOrder[]): EmailItem[] => {
  if (orders.length === 0) return [];

  const velocityProfiles = buildVelocityProfiles(orders);
  const uniqueItems = new Map<string, EmailItem>();

  orders.forEach(order => {
    order.items.forEach(item => {
      const normalizedKey = item.normalizedName ?? normalizeItemName(item.name);
      const profile = velocityProfiles.get(normalizedKey);

      const displayName = profile?.displayName
        ?? item.amazonEnriched?.humanizedName
        ?? item.amazonEnriched?.itemName
        ?? item.name;

      // Two-bin system: min qty = order qty (refill one bin when empty)
      // Use velocity profile if available, otherwise default to 1.5x last order quantity
      const minQty = profile?.recommendedMin || Math.ceil((item.quantity || 1) * 1.5);

      const emailItem: EmailItem = {
        id: `email-${order.id}-${item.name}`,
        name: displayName,
        supplier: order.supplier,
        asin: item.asin,
        imageUrl: item.amazonEnriched?.imageUrl,
        productUrl: item.amazonEnriched?.amazonUrl,
        lastPrice: item.unitPrice,
        quantity: item.quantity,
        recommendedMin: minQty,
        recommendedOrderQty: minQty, // Two-bin: order qty = min qty
      };

      const existing = uniqueItems.get(normalizedKey);
      if (!existing || (emailItem.imageUrl && !existing.imageUrl)) {
        uniqueItems.set(normalizedKey, emailItem);
      }
    });
  });

  return Array.from(uniqueItems.values());
};

// Scanned barcode item
export interface ScannedBarcode {
  id: string;
  barcode: string;
  barcodeType: 'UPC' | 'EAN' | 'UPC-A' | 'EAN-13' | 'EAN-8' | 'GTIN-14' | 'unknown';
  scannedAt: string;
  source: 'desktop' | 'mobile';
  // Enriched data from lookup
  productName?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
  // Match status
  matchedToEmailItem?: string;
}

// Captured item photo
export interface CapturedPhoto {
  id: string;
  imageData: string;
  capturedAt: string;
  source: 'desktop' | 'mobile';
  // Extracted data from image analysis
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean;
}

// Unified item for reconciliation (kept for backwards compatibility)
export interface ReconciliationItem {
  id: string;
  source: 'email' | 'url' | 'barcode' | 'photo' | 'csv';
  name: string;
  normalizedName?: string;
  supplier?: string;
  location?: string;
  barcode?: string;
  sku?: string;
  asin?: string;
  quantity?: number;
  minQty?: number;
  orderQty?: number;
  unitPrice?: number;
  imageUrl?: string;
  productUrl?: string;
  duplicateOf?: string;
  isDuplicate?: boolean;
  matchConfidence?: number;
  isApproved?: boolean;
  isExcluded?: boolean;
  needsReview?: boolean;
}

interface OnboardingFlowProps {
  onComplete: (summary: OnboardingCompletionSummary) => void;
  onSkip: () => void;
  userProfile?: { name?: string; email?: string };
  initialReturnTo?: string | null;
}

const noop = () => {};

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  onComplete,
  onSkip,
  userProfile,
  initialReturnTo,
}) => {
  const persistedDraft = useMemo(() => loadOnboardingDraft(), []);
  const hasIntegrationCallback = (() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('integration_provider') && params.get('integration_status'));
  })();

  const hasEmailReturnTo = initialReturnTo === 'email';

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(() => {
    if (hasEmailReturnTo) return 'email';
    if (hasIntegrationCallback) return 'integrations';
    if (persistedDraft?.currentStep) return persistedDraft.currentStep;
    return 'welcome';
  });
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(() => {
    if (hasEmailReturnTo) return new Set<OnboardingStep>(['welcome']);
    if (hasIntegrationCallback) return new Set<OnboardingStep>(['welcome', 'email']);
    return new Set(persistedDraft?.completedSteps ?? []);
  });
  const [hasStartedEmailSync, setHasStartedEmailSync] = useState(hasEmailReturnTo || persistedDraft?.hasStartedEmailSync || false);
  const [tipsOpenForStep, setTipsOpenForStep] = useState<OnboardingStep | null>(null);
  const tipsWrapperRef = useRef<HTMLDivElement | null>(null);
  
  // Data from each step
  const [emailOrders, setEmailOrders] = useState<ExtractedOrder[]>(persistedDraft?.emailOrders ?? []);
  const emailItems = useMemo(() => buildEmailItemsFromOrders(emailOrders), [emailOrders]);
  const [urlItems, setUrlItems] = useState<UrlScrapedItem[]>(persistedDraft?.urlItems ?? []);
  const [scannedBarcodes, setScannedBarcodes] = useState<ScannedBarcode[]>(persistedDraft?.scannedBarcodes ?? []);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [csvItems, setCsvItems] = useState<CSVItem[]>(persistedDraft?.csvItems ?? []);
  const [csvFooterState, setCsvFooterState] = useState<CSVFooterState>({
    approvedCount: 0,
    canContinue: false,
    onSkip: noop,
    onContinue: noop,
  });
  const [masterListFooterState, setMasterListFooterState] = useState<MasterListFooterState>({
    selectedCount: 0,
    syncedCount: 0,
    canSyncSelected: false,
    canComplete: false,
    isSyncing: false,
    onSyncSelected: noop,
    onComplete: noop,
  });
  
  // Gmail connection status (checked once for the Welcome step)
  const [isGmailConnected, setIsGmailConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    gmailApi.getStatus()
      .then(status => { if (mounted) setIsGmailConnected(status.connected); })
      .catch(() => { if (mounted) setIsGmailConnected(false); });
    return () => { mounted = false; };
  }, []);

  // Track when user can proceed from email step (Amazon + priority done)
  const [canProceedFromEmail, setCanProceedFromEmail] = useState(false);
  const [urlReviewState, setUrlReviewState] = useState<UrlReviewState>(
    persistedDraft?.urlReviewState ?? {
      pendingReviewCount: 0,
      unimportedApprovedCount: 0,
      totalRows: 0,
      canContinue: true,
    },
  );
  
  // Preserve email scan state for navigation
  const [emailScanState, setEmailScanState] = useState<EmailScanState | undefined>(persistedDraft?.emailScanState);
  const [emailBackgroundProgress, setEmailBackgroundProgress] = useState<BackgroundEmailProgress | null>(
    persistedDraft?.emailBackgroundProgress ?? null,
  );
  
  // Mobile session ID for syncing
  const [mobileSessionId] = useState(() => 
    `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );

  const [masterItemEditsById, setMasterItemEditsById] = useState<Record<string, Partial<MasterListItem>>>({});
  const [removedMasterItemIds, setRemovedMasterItemIds] = useState<Record<string, true>>({});

  const baseMasterItems = useMemo(
    () => buildMasterListItems(emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems),
    [emailItems, urlItems, scannedBarcodes, capturedPhotos, csvItems],
  );

  const masterItems = useMemo(
    () => baseMasterItems
      .filter(item => !removedMasterItemIds[item.id])
      .map(item => {
        const override = masterItemEditsById[item.id];
        if (!override) return item;
        return { ...item, ...override };
      }),
    [baseMasterItems, masterItemEditsById, removedMasterItemIds],
  );

  const { syncStateById, setSyncStateById, syncSingleItem, syncSelectedItems, isBulkSyncing } = useSyncToArda(masterItems);
  const sourceCounts = useMemo(() => (
    masterItems.reduce<Record<MasterListItem['source'], number>>((counts, item) => {
      counts[item.source] += 1;
      return counts;
    }, emptySourceCounts())
  ), [masterItems]);
  const syncedItemsCount = useMemo(
    () => masterItems.filter(item => syncStateById[item.id]?.status === 'success').length,
    [masterItems, syncStateById],
  );
  const unsyncedApprovedItemsCount = Math.max(masterItems.length - syncedItemsCount, 0);
  const needsAttentionCount = useMemo(
    () => masterItems.filter(item => item.needsAttention).length,
    [masterItems],
  );

  const isPanelVisible = masterItems.length > 0;

  const renderGridFallback = (mode: 'panel' | 'fullpage') => (
    <div
      className={
        mode === 'panel'
          ? 'flex h-full min-h-[420px] items-center justify-center bg-arda-bg-secondary text-sm text-arda-text-muted'
          : 'flex min-h-[60vh] items-center justify-center bg-arda-bg-secondary text-sm text-arda-text-muted'
      }
    >
      Loading inventory grid...
    </div>
  );

  const updateItem = useCallback((id: string, field: keyof MasterListItem, value: unknown) => {
    setMasterItemEditsById(prev => {
      const existing = prev[id] ?? {};
      const nextOverride = { ...existing, [field]: value } as Partial<MasterListItem>;
      if (field === 'name' && value && !String(value).includes('Unknown')) {
        nextOverride.needsAttention = false;
      }
      return { ...prev, [id]: nextOverride };
    });
    setSyncStateById(prev => {
      const existing = prev[id];
      if (!existing || existing.status === 'idle') return prev;
      return { ...prev, [id]: { status: 'idle' } };
    });
  }, [setSyncStateById]);

  const removeItem = useCallback((id: string) => {
    setRemovedMasterItemIds(prev => (prev[id] ? prev : { ...prev, [id]: true }));
    setMasterItemEditsById(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSyncStateById(prev => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [setSyncStateById]);

  const { currentStepIndex, currentStepConfig } = useMemo(() => {
    const index = ONBOARDING_STEPS.findIndex(step => step.id === currentStep);
    const safeIndex = index === -1 ? 0 : index;
    return {
      currentStepIndex: safeIndex,
      currentStepConfig: ONBOARDING_STEPS[safeIndex],
    };
  }, [currentStep]);
  const tipsOpen = tipsOpenForStep === currentStep;
  const requiredSteps = useMemo(
    () => ONBOARDING_STEPS.filter(step => step.group === 'required' && step.id !== 'welcome'),
    [],
  );
  const firstIncompleteRequiredStep = useMemo(
    () => requiredSteps.find(step => !completedSteps.has(step.id) && step.id !== currentStep)?.id ?? null,
    [completedSteps, currentStep, requiredSteps],
  );

  useEffect(() => {
    if (!tipsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTipsOpenForStep(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (!tipsWrapperRef.current?.contains(target)) {
        setTipsOpenForStep(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [tipsOpen]);

  const urlReviewBlockMessage = useMemo(() => {
    if (urlReviewState.canContinue || urlReviewState.totalRows === 0) {
      return null;
    }
    if (urlReviewState.pendingReviewCount > 0) {
      return `Review or delete the remaining URL rows before continuing (${urlReviewState.pendingReviewCount} still need attention).`;
    }
    if (urlReviewState.unimportedApprovedCount > 0) {
      return `Import approved URL rows before continuing (${urlReviewState.unimportedApprovedCount} still waiting).`;
    }
    return 'Review and import URL rows before continuing.';
  }, [urlReviewState]);

  useEffect(() => {
    const draftState: OnboardingDraftState = {
      currentStep,
      completedSteps: Array.from(completedSteps),
      hasStartedEmailSync,
      emailOrders,
      urlItems,
      scannedBarcodes,
      csvItems,
      emailScanState,
      emailBackgroundProgress,
      urlReviewState,
    };

    const hasMeaningfulDraft = hasStartedEmailSync
      || completedSteps.size > 0
      || currentStep !== 'welcome'
      || emailOrders.length > 0
      || urlItems.length > 0
      || scannedBarcodes.length > 0
      || csvItems.length > 0;

    if (!hasMeaningfulDraft) {
      window.localStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(draftState));
  }, [
    completedSteps,
    currentStep,
    csvItems,
    emailBackgroundProgress,
    emailOrders,
    emailScanState,
    hasStartedEmailSync,
    scannedBarcodes,
    urlItems,
    urlReviewState,
  ]);
  
  // Check if can go back
  const canGoBack = currentStepIndex > 0;
  
  const canGoForward = currentStep === 'email'
    ? canProceedFromEmail
    : currentStep === 'url'
      ? urlReviewState.canContinue
      : true;

  // Handle step completion
  const handleStepComplete = useCallback((step: OnboardingStep) => {
    setCompletedSteps(prev => new Set([...prev, step]));
    
    // Auto-advance to next step
    const currentIndex = ONBOARDING_STEPS.findIndex(s => s.id === step);
    if (currentIndex < ONBOARDING_STEPS.length - 1) {
      setTipsOpenForStep(null);
      setCurrentStep(ONBOARDING_STEPS[currentIndex + 1].id);
    }
  }, []);

  // Handle email orders update (does NOT auto-advance - user clicks Continue)
  const handleEmailOrdersUpdate = useCallback((orders: ExtractedOrder[]) => {
    setEmailOrders(orders);
    // Don't auto-advance - user will click Continue when ready
  }, []);

  // Handle photo capture
  const handleBarcodeScanned = useCallback((barcode: ScannedBarcode) => {
    setScannedBarcodes(prev => {
      const existingIndex = prev.findIndex(item => item.id === barcode.id || item.barcode === barcode.barcode);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = barcode;
        return updated;
      }
      return [...prev, barcode];
    });
  }, []);

  // Handle photo capture
  const handlePhotoCaptured = useCallback((photo: CapturedPhoto) => {
    setCapturedPhotos(prev => {
      // Update existing photo or add new
      const existingIndex = prev.findIndex(p => p.id === photo.id);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = photo;
        return updated;
      }
      return [...prev, photo];
    });
  }, []);

  // Handle CSV upload completion
  const handleCSVComplete = useCallback((approvedItems: CSVItem[]) => {
    setCsvItems(approvedItems);
    handleStepComplete('csv');
  }, [handleStepComplete]);

  // Handle master list completion
  const handleMasterListComplete = useCallback(() => {
    handleStepComplete('masterlist');
    onComplete({
      totalItems: masterItems.length,
      syncedItems: syncedItemsCount,
      unsyncedItems: Math.max(masterItems.length - syncedItemsCount, 0),
      needsAttentionItems: needsAttentionCount,
      sourceCounts,
    });
  }, [handleStepComplete, masterItems.length, needsAttentionCount, onComplete, sourceCounts, syncedItemsCount]);

  // Handle when user can proceed from email step (key suppliers done)
  const handleCanProceedFromEmail = useCallback((canProceed: boolean) => {
    setCanProceedFromEmail(canProceed);
  }, []);

  const handleUrlReviewStateChange = useCallback((state: UrlReviewState) => {
    setUrlReviewState(state);
  }, []);

  // Preserve email scan state for navigation
  const handleEmailScanStateChange = useCallback((state: EmailScanState) => {
    setEmailScanState(state);
  }, []);

  const handleEmailProgressUpdate = useCallback((progress: BackgroundEmailProgress | null) => {
    setEmailBackgroundProgress(progress);
  }, []);

  const handleStartEmailSync = useCallback(() => {
    setHasStartedEmailSync(true);
    handleStepComplete('welcome');
  }, [handleStepComplete]);

  const handleSkipEmailSync = useCallback(() => {
    setHasStartedEmailSync(false);
    setCompletedSteps(prev => {
      const next = new Set(prev);
      next.add('welcome');
      next.add('email');
      return next;
    });
    setTipsOpenForStep(null);
    setCurrentStep('integrations');
  }, []);

  // Go to previous step
  const goBack = useCallback(() => {
    if (currentStepIndex > 0) {
      setTipsOpenForStep(null);
      setCurrentStep(ONBOARDING_STEPS[currentStepIndex - 1].id);
    }
  }, [currentStepIndex]);

  // Go to next step
  const goForward = useCallback(() => {
    if (currentStepIndex < ONBOARDING_STEPS.length - 1) {
      handleStepComplete(currentStep);
    }
  }, [currentStepIndex, currentStep, handleStepComplete]);

  const getStepStatus = (stepId: OnboardingStep): DerivedStepStatus => {
    if (completedSteps.has(stepId)) return 'done';
    if (currentStep === stepId) return 'in_progress';

    const step = ONBOARDING_STEPS.find(candidate => candidate.id === stepId);
    if (!step) return 'not_started';

    if (step.group === 'optional') {
      return 'optional';
    }

    if (firstIncompleteRequiredStep === stepId) {
      return 'ready';
    }

    return 'not_started';
  };

  const renderFooterNavigation = () => {
    if (currentStep === 'welcome') {
      return null;
    }

    const handleSkip = () => {
      if (currentStep === 'csv') {
        const skip = csvFooterState.onSkip === noop
          ? () => handleCSVComplete([])
          : csvFooterState.onSkip;
        skip();
        return;
      }

      if (currentStep === 'masterlist') {
        setTipsOpenForStep(null);
        onSkip();
        return;
      }

      handleStepComplete(currentStep);
    };

    const handleContinue = () => {
      if (currentStep === 'csv') {
        csvFooterState.onContinue();
        return;
      }

      if (currentStep === 'masterlist') {
        masterListFooterState.onComplete();
        return;
      }

      goForward();
    };

    const continueLabel = currentStep === 'masterlist'
      ? unsyncedApprovedItemsCount > 0
        ? 'Finish for now'
        : 'Complete setup'
      : 'Continue';

    const continueDisabled = currentStep === 'csv'
      ? !csvFooterState.canContinue
      : currentStep === 'masterlist'
        ? !masterListFooterState.canComplete
        : !canGoForward;

    return (
      <div
        className="fixed bottom-0 inset-x-0 z-40 border-t border-arda-border/70 bg-white/75 backdrop-blur"
        role="navigation"
        aria-label="Onboarding navigation"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            className="btn-arda-outline flex items-center gap-2 disabled:opacity-50"
          >
            <Icons.ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSkip}
              className="btn-arda-outline"
            >
              Skip
            </button>

            {currentStep === 'masterlist' && (
              <button
                type="button"
                onClick={masterListFooterState.onSyncSelected}
                disabled={!masterListFooterState.canSyncSelected}
                className="btn-arda-outline text-sm py-1.5 flex items-center gap-2 disabled:opacity-50"
              >
                {masterListFooterState.isSyncing ? (
                  <Icons.Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icons.Upload className="w-4 h-4" />
                )}
                Sync Selected ({masterListFooterState.selectedCount})
              </button>
            )}

            <button
              type="button"
              onClick={handleContinue}
              disabled={continueDisabled}
              className="btn-arda-primary flex items-center gap-2 disabled:bg-arda-border disabled:text-arda-text-muted disabled:cursor-not-allowed disabled:hover:bg-arda-border"
            >
              {continueLabel}
              <Icons.ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderStepIndicator = () => (
    <div className="sticky top-0 z-40 relative border-b border-arda-border/70 bg-white/75 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-2.5 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-arda-accent to-arda-accent-hover shadow-arda">
              <Icons.Package className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-semibold text-arda-text-primary">Arda</div>
              <div className="hidden text-[11px] text-arda-text-muted sm:block">Order Pulse onboarding</div>
            </div>
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-2 md:flex">
            <span className="flex-shrink-0 text-[11px] text-arda-text-muted">
              Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
            </span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              currentStepConfig.group === 'required'
                ? 'border-arda-warning-border bg-arda-warning-bg text-arda-warning-text'
                : 'border-arda-border bg-arda-bg-secondary text-arda-text-secondary'
            }`}>
              {currentStepConfig.group === 'required' ? 'Required' : 'Optional'}
            </span>
            <span className="truncate text-sm font-semibold text-arda-text-primary">
              {currentStepConfig.title}
            </span>
            <span className="hidden truncate text-xs text-arda-text-secondary xl:block">
              Next value: {currentStepConfig.valueLabel}
            </span>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            <div ref={tipsWrapperRef} className="relative">
              <button
                type="button"
                onClick={() => setTipsOpenForStep(open => (open === currentStep ? null : currentStep))}
                className="btn-arda-outline text-sm py-1.5 flex items-center gap-2"
                aria-controls={`onboarding-tips-${currentStep}`}
                aria-haspopup="dialog"
              >
                <Icons.Lightbulb className="w-4 h-4" />
                <span className="sr-only sm:not-sr-only">Tips</span>
              </button>

              {tipsOpen && (
                <div
                  id={`onboarding-tips-${currentStep}`}
                  role="dialog"
                  aria-label={currentStepConfig.tipsTitle}
                  className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-arda-border bg-white/95 p-3 shadow-lg backdrop-blur z-50"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-arda-text-muted">
                    {currentStepConfig.tipsTitle}
                  </div>
                  <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-arda-text-secondary">
                    {currentStepConfig.tips.map((tip, index) => (
                      <li key={`${currentStep}-${index}`}>{tip}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {userProfile?.email && (
              <div className="hidden sm:flex items-center gap-2 rounded-xl border border-arda-border bg-white/70 px-2.5 py-1.5 text-xs text-arda-text-secondary">
                <Icons.Mail className="w-3.5 h-3.5 text-arda-text-muted" />
                <span className="max-w-[14rem] truncate">{userProfile.email}</span>
              </div>
            )}

            <button
              type="button"
              onClick={onSkip}
              className="rounded-xl border border-transparent px-2.5 py-1.5 text-xs font-medium text-arda-text-muted transition-colors hover:border-arda-border hover:bg-white/70 hover:text-arda-text-primary"
            >
              Exit
            </button>
          </div>
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-2 md:hidden">
          <span className="flex-shrink-0 text-[11px] text-arda-text-muted">
            Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
          </span>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            currentStepConfig.group === 'required'
              ? 'border-arda-warning-border bg-arda-warning-bg text-arda-warning-text'
              : 'border-arda-border bg-arda-bg-secondary text-arda-text-secondary'
          }`}>
            {currentStepConfig.group === 'required' ? 'Required' : 'Optional'}
          </span>
          <span className="truncate text-sm font-semibold text-arda-text-primary">
            {currentStepConfig.title}
          </span>
        </div>

        <div className="mt-2 hidden items-center justify-center gap-1.5 lg:flex">
          {ONBOARDING_STEPS.map((step, index) => {
            const status = getStepStatus(step.id);
            const Icon = Icons[step.icon] || Icons.Circle;
            const isInteractive = status === 'done' || status === 'in_progress';
            const isCompleted = status === 'done';
            const isCurrent = status === 'in_progress';

            return (
              <div key={step.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    if (isInteractive) {
                      setTipsOpenForStep(null);
                      setCurrentStep(step.id);
                    }
                  }}
                  disabled={!isInteractive}
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-full border transition-colors',
                    isCompleted ? 'border-arda-accent-hover bg-arda-accent text-white' : '',
                    isCurrent ? 'border-arda-accent-hover bg-arda-accent text-white' : '',
                    status === 'ready' ? 'border-arda-warning-border bg-arda-warning-bg text-arda-warning-text' : '',
                    status === 'optional' ? 'border-arda-border bg-arda-bg-secondary text-arda-text-secondary' : '',
                    status === 'not_started' ? 'border-arda-border bg-white/80 text-arda-text-muted' : '',
                    isInteractive ? 'hover:bg-arda-accent/10' : 'cursor-not-allowed opacity-50',
                  ].join(' ')}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={`${step.title} • ${step.group === 'required' ? 'Required' : 'Optional'}`}
                >
                  {isCompleted ? <Icons.Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                </button>
                {index < ONBOARDING_STEPS.length - 1 && (
                  <div
                    className={[
                      'mx-1 h-[2px] w-6 rounded-full',
                      completedSteps.has(step.id) ? 'bg-arda-accent' : 'bg-arda-border',
                    ].join(' ')}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-arda-bg-tertiary">
        <div
          className="h-full bg-gradient-to-r from-arda-accent to-arda-accent-hover transition-all duration-300"
          style={{ width: `${((currentStepIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
          role="progressbar"
          aria-label="Onboarding progress"
        />
      </div>
    </div>
  );

  const renderEmailStatusCard = () => {
    if (!hasStartedEmailSync) return null;
    if (currentStep === 'welcome') return null;

    const progress = emailBackgroundProgress ?? {
      isActive: currentStep === 'email',
      phase: 'ready' as const,
      title: 'Email import in progress',
      supplier: 'Email import',
      processed: emailOrders.length,
      total: emailOrders.length,
      nextAction: 'If you continue now, email import keeps running and new items will still appear in review.',
    };

    const title = currentStep === 'email'
      ? 'Continue whenever you are ready'
      : progress.isActive
        ? 'Email import still running in the background'
        : 'Email import summary';

    return (
      <div className="fixed inset-x-0 bottom-16 z-30 px-4 sm:px-6 pointer-events-none">
        <div className="max-w-6xl mx-auto">
          <div className="pointer-events-auto rounded-2xl border border-arda-info-border bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-arda-info-text">
                  <Icons.Mail className="w-4 h-4" />
                  {title}
                </div>
                <p className="mt-1 text-sm text-arda-text-primary">
                  {progress.title}
                  {progress.total > 0
                    ? ` • ${progress.processed}/${progress.total}`
                    : ''}
                </p>
                <p className="mt-1 text-xs text-arda-text-secondary">
                  {progress.currentTask || progress.nextAction}
                </p>
              </div>
              <div className="rounded-xl bg-arda-info-bg px-3 py-2 text-xs text-arda-info-text">
                {currentStep === 'email'
                  ? 'If you continue now, email import keeps running and new items will still appear in review.'
                  : progress.nextAction}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render current step content (keep SupplierSetup mounted so background imports continue)
  const renderStepContent = () => (
    <>
      {currentStep === 'welcome' && (
        <OnboardingWelcomeStep
          steps={ONBOARDING_STEPS
            .filter(step => step.id !== 'welcome')
            .map(step => ({
              id: step.id,
              title: step.title,
              description: step.description,
              icon: step.icon,
              group: step.group,
              estimatedTime: step.estimatedTime,
              bestFor: step.bestFor,
              valueLabel: step.valueLabel,
              status: getStepStatus(step.id),
            }))}
          userProfile={userProfile}
          onStartEmailSync={handleStartEmailSync}
          onSkipEmail={handleSkipEmailSync}
          isGmailConnected={isGmailConnected ?? false}
        />
      )}

      <div className={currentStep === 'email' ? '' : 'hidden'}>
        {hasStartedEmailSync ? (
          <SupplierSetup
            onScanComplete={handleEmailOrdersUpdate}
            onSkip={() => handleStepComplete('email')}
            onProgressUpdate={handleEmailProgressUpdate}
            onCanProceed={handleCanProceedFromEmail}
            onStateChange={handleEmailScanStateChange}
            initialState={emailScanState}
            embedded
          />
        ) : (
          <div className="space-y-4">
            <div className="card-arda p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-arda-text-primary">Start email sync</h3>
                <p className="text-sm text-arda-text-secondary mt-1">
                  Email scanning will run in the background while you continue. Amazon and priority suppliers are the required path.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHasStartedEmailSync(true)}
                className="btn-arda-primary"
              >
                Start email sync
              </button>
            </div>
          </div>
        )}
      </div>

      {currentStep === 'integrations' && (
        <IntegrationsStep />
      )}

      {currentStep === 'url' && (
        <div className="space-y-3">
          {urlReviewBlockMessage && (
            <div className="rounded-xl border border-arda-warning-border bg-arda-warning-bg px-3 py-2 text-xs text-arda-warning-text">
              {urlReviewBlockMessage}
            </div>
          )}
          <UrlScrapeStep
            importedItems={urlItems}
            onImportItems={(items) => {
              setUrlItems(previousItems => {
                const merged = new Map(previousItems.map(item => [item.sourceUrl, item]));
                items.forEach(item => {
                  merged.set(item.sourceUrl, item);
                });
                return Array.from(merged.values());
              });
            }}
            onDeleteImportedItem={(sourceUrl) => {
              setUrlItems(previousItems => previousItems.filter(item => item.sourceUrl !== sourceUrl));
            }}
            onReviewStateChange={handleUrlReviewStateChange}
          />
        </div>
      )}
      
      {currentStep === 'barcode' && (
        <BarcodeScanStep
          sessionId={mobileSessionId}
          scannedBarcodes={scannedBarcodes}
          onBarcodeScanned={handleBarcodeScanned}
        />
      )}

      {currentStep === 'photo' && (
        <PhotoCaptureStep
          sessionId={mobileSessionId}
          capturedPhotos={capturedPhotos}
          onPhotoCaptured={handlePhotoCaptured}
          onComplete={() => handleStepComplete('photo')}
          onBack={() => {
            setTipsOpenForStep(null);
            setCurrentStep('barcode');
          }}
        />
      )}

      {currentStep === 'csv' && (
        <CSVUploadStep
          onComplete={handleCSVComplete}
          onBack={() => {
            setTipsOpenForStep(null);
            setCurrentStep('photo');
          }}
          onFooterStateChange={setCsvFooterState}
        />
      )}

      {currentStep === 'masterlist' && (
        <MasterListStep
          items={masterItems}
          syncStateById={syncStateById}
          isBulkSyncing={isBulkSyncing}
          onSyncSingle={syncSingleItem}
          onSyncSelected={syncSelectedItems}
          onUpdateItem={updateItem}
          onRemoveItem={removeItem}
          onComplete={handleMasterListComplete}
          onBack={() => {
            setTipsOpenForStep(null);
            setCurrentStep('csv');
          }}
          onFooterStateChange={setMasterListFooterState}
        />
      )}
    </>
  );

  return (
    <div className="relative min-h-screen arda-mesh flex flex-col">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-10 left-10 w-56 h-56 rounded-full bg-arda-accent/15 blur-3xl animate-float" />
        <div className="absolute top-32 right-12 w-72 h-72 rounded-full bg-arda-info/10 blur-3xl animate-float" />
      </div>
      {/* Step indicator */}
      {renderStepIndicator()}

      {/* Main content */}
      <div className="relative z-10 flex-1 px-4 sm:px-6 py-4 pb-20">
        <div className={
          currentStep === 'masterlist'
            ? 'max-w-none w-full'
            : isPanelVisible
              ? 'flex flex-col lg:flex-row gap-6 max-w-none'
              : 'max-w-6xl mx-auto'
        }>
          {/* Step content — left side */}
          <div className={
            isPanelVisible && currentStep !== 'masterlist'
              ? 'w-full lg:w-[40%] lg:min-w-[380px] lg:flex-shrink-0'
              : 'w-full'
          }>
            {renderStepContent()}
          </div>

          {/* AG Grid — right side panel (visible on non-masterlist steps) */}
          {isPanelVisible && currentStep !== 'masterlist' && (
            <div className="flex-1 min-w-0 lg:sticky lg:top-14 lg:self-start lg:h-[calc(100vh-10rem)] lg:max-h-[calc(100vh-10rem)] overflow-hidden rounded-xl border border-arda-border bg-white shadow-sm">
              <Suspense fallback={renderGridFallback('panel')}>
                <ItemsGrid
                  items={masterItems}
                  onUpdateItem={updateItem}
                  onRemoveItem={removeItem}
                  syncStateById={syncStateById}
                  onSyncSingle={syncSingleItem}
                  mode="panel"
                />
              </Suspense>
            </div>
          )}

          {/* Review step — grid is full-width (rendered by MasterListStep) */}
          {currentStep === 'masterlist' && (
            <div className="w-full rounded-xl border border-arda-border bg-white shadow-sm overflow-hidden mt-4">
              <Suspense fallback={renderGridFallback('fullpage')}>
                <ItemsGrid
                  items={masterItems}
                  onUpdateItem={updateItem}
                  onRemoveItem={removeItem}
                  syncStateById={syncStateById}
                  onSyncSingle={syncSingleItem}
                  mode="fullpage"
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      {renderEmailStatusCard()}
      {renderFooterNavigation()}
    </div>
  );
};
