import { useMemo, useCallback, useEffect } from 'react';
import type { MasterListItem, RowSyncState, MasterListFooterState } from '../components/ItemsTable/types';

interface MasterListStepProps {
  items: MasterListItem[];
  syncStateById: Record<string, RowSyncState>;
  isBulkSyncing: boolean;
  onSyncSingle: (id: string) => Promise<boolean>;
  onSyncSelected: (ids: string[]) => Promise<void>;
  onUpdateItem: (id: string, field: keyof MasterListItem, value: unknown) => void;
  onRemoveItem: (id: string) => void;
  onComplete: () => void;
  onBack: () => void;
  onFooterStateChange?: (state: MasterListFooterState) => void;
}

export { type MasterListItem } from '../components/ItemsTable/types';
export { type MasterListFooterState } from '../components/ItemsTable/types';

export const MasterListStep: React.FC<MasterListStepProps> = ({
  items,
  syncStateById,
  isBulkSyncing,
  onSyncSelected,
  onComplete,
  onBack,
  onFooterStateChange,
}) => {
  void onBack;

  const syncedItems = useMemo(
    () => items.filter(item => syncStateById[item.id]?.status === 'success'),
    [items, syncStateById],
  );
  const sourceCounts = useMemo(() => (
    items.reduce<Record<MasterListItem['source'], number>>((counts, item) => {
      counts[item.source] += 1;
      return counts;
    }, {
      email: 0,
      url: 0,
      barcode: 0,
      photo: 0,
      csv: 0,
    })
  ), [items]);
  const failedCount = useMemo(
    () => items.filter(item => syncStateById[item.id]?.status === 'error').length,
    [items, syncStateById],
  );
  const attentionCount = useMemo(
    () => items.filter(item => item.needsAttention).length,
    [items],
  );
  const unsyncedApprovedCount = Math.max(items.length - syncedItems.length, 0);

  const hasSyncInProgress = useMemo(
    () => isBulkSyncing || Object.values(syncStateById).some(state => state.status === 'syncing'),
    [isBulkSyncing, syncStateById],
  );

  const handleComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleSyncSelected = useCallback(() => {
    const allIds = items.map(item => item.id);
    void onSyncSelected(allIds);
  }, [items, onSyncSelected]);

  useEffect(() => {
    onFooterStateChange?.({
      selectedCount: items.length,
      syncedCount: syncedItems.length,
      canSyncSelected: items.length > 0 && !hasSyncInProgress,
      canComplete: !hasSyncInProgress,
      isSyncing: isBulkSyncing,
      onSyncSelected: handleSyncSelected,
      onComplete: handleComplete,
    });
  }, [
    handleComplete,
    handleSyncSelected,
    hasSyncInProgress,
    isBulkSyncing,
    items.length,
    onFooterStateChange,
    syncedItems.length,
  ]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-arda-border bg-white/90 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="font-medium">{items.length} items</span>
            <span className="text-arda-success-text">{syncedItems.length} synced</span>
            {failedCount > 0 && (
              <span className="text-arda-danger-text">{failedCount} failed</span>
            )}
            {attentionCount > 0 && (
              <span className="text-arda-warning-text">{attentionCount} need attention</span>
            )}
            <span className="text-arda-info-text">{unsyncedApprovedCount} unsynced approved items</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs min-w-0 lg:min-w-[30rem]">
            <div className="rounded-xl bg-arda-bg-secondary px-3 py-2">
              <div className="text-arda-text-muted uppercase tracking-wide">Email</div>
              <div className="mt-1 font-semibold text-arda-text-primary">{sourceCounts.email}</div>
            </div>
            <div className="rounded-xl bg-arda-bg-secondary px-3 py-2">
              <div className="text-arda-text-muted uppercase tracking-wide">URL</div>
              <div className="mt-1 font-semibold text-arda-text-primary">{sourceCounts.url}</div>
            </div>
            <div className="rounded-xl bg-arda-bg-secondary px-3 py-2">
              <div className="text-arda-text-muted uppercase tracking-wide">Barcode</div>
              <div className="mt-1 font-semibold text-arda-text-primary">{sourceCounts.barcode}</div>
            </div>
            <div className="rounded-xl bg-arda-bg-secondary px-3 py-2">
              <div className="text-arda-text-muted uppercase tracking-wide">Photo</div>
              <div className="mt-1 font-semibold text-arda-text-primary">{sourceCounts.photo}</div>
            </div>
            <div className="rounded-xl bg-arda-bg-secondary px-3 py-2">
              <div className="text-arda-text-muted uppercase tracking-wide">CSV</div>
              <div className="mt-1 font-semibold text-arda-text-primary">{sourceCounts.csv}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
