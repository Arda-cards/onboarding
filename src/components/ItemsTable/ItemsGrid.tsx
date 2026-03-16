import { useCallback, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  GridReadyEvent,
  CellValueChangedEvent,
  GetRowIdParams,
  RowClassRules,
  RowSelectionOptions,
  SelectionColumnDef,
} from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import './gridSetup';
import './ardaGridTheme.css';
import type { MasterListItem, RowSyncState } from './types';
import { ORDER_METHOD_OPTIONS } from './types';
import { SourceBadgeRenderer } from './cellRenderers/SourceBadgeRenderer';
import { ImageCellRenderer } from './cellRenderers/ImageCellRenderer';
import { ColorCellRenderer } from './cellRenderers/ColorCellRenderer';
import { ColorCellEditor } from './cellRenderers/ColorCellEditor';
import { SyncStatusRenderer } from './cellRenderers/SyncStatusRenderer';
import { ActionsCellRenderer } from './cellRenderers/ActionsCellRenderer';
import { UrlCellRenderer } from './cellRenderers/UrlCellRenderer';

const ardaTheme = themeQuartz.withParams({
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  fontSize: 13,
  backgroundColor: 'var(--arda-bg)',
  headerBackgroundColor: 'var(--arda-bg-secondary)',
  oddRowBackgroundColor: 'var(--arda-bg)',
  rowHoverColor: 'var(--arda-bg-secondary)',
  headerCellHoverBackgroundColor: 'var(--arda-bg-tertiary)',
  selectedRowBackgroundColor: 'var(--arda-warning-bg)',
  modalOverlayBackgroundColor: 'var(--arda-overlay)',
  rangeSelectionBorderColor: 'var(--arda-accent)',
  rangeSelectionBackgroundColor: 'var(--arda-accent-soft)',
  accentColor: 'var(--arda-accent)',
  borderColor: 'var(--arda-border)',
  headerTextColor: 'var(--arda-text-secondary)',
  foregroundColor: 'var(--arda-text-primary)',
  subtleTextColor: 'var(--arda-text-secondary)',
  spacing: 4,
  cellHorizontalPadding: 8,
  headerHeight: 36,
  rowHeight: 38,
  wrapperBorderRadius: 12,
  borderRadius: 6,
  cardShadow: 'var(--arda-shadow-sm)',
  popupShadow: 'var(--arda-shadow-md)',
});

export interface ItemsGridProps {
  items: MasterListItem[];
  onUpdateItem: (id: string, field: keyof MasterListItem, value: unknown) => void;
  onRemoveItem: (id: string) => void;
  syncStateById: Record<string, RowSyncState>;
  onSyncSingle?: (id: string) => void;
  mode: 'panel' | 'fullpage';
}

export const ItemsGrid: React.FC<ItemsGridProps> = ({
  items,
  onUpdateItem,
  onRemoveItem,
  syncStateById,
  onSyncSingle,
  mode,
}) => {
  const gridRef = useRef<AgGridReact<MasterListItem>>(null);

  const getRowId = useCallback((params: GetRowIdParams<MasterListItem>) => params.data.id, []);

  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<MasterListItem>) => {
      const field = event.colDef.field as keyof MasterListItem | undefined;
      if (field && event.data) {
        onUpdateItem(event.data.id, field, event.newValue);
      }
    },
    [onUpdateItem],
  );

  const onGridReady = useCallback((event: GridReadyEvent) => {
    event.api.sizeColumnsToFit();
  }, []);

  const columnDefs = useMemo<ColDef<MasterListItem>[]>(
    () => [
      {
        headerName: 'Source',
        field: 'source',
        width: 90,
        maxWidth: 100,
        cellRenderer: SourceBadgeRenderer,
        editable: false,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Img',
        field: 'imageUrl',
        width: 56,
        maxWidth: 56,
        cellRenderer: ImageCellRenderer,
        editable: false,
        sortable: false,
        filter: false,
      },
      {
        headerName: 'Name',
        field: 'name',
        minWidth: 160,
        flex: 2,
        editable: true,
        filter: 'agTextColumnFilter',
        pinned: mode === 'fullpage' ? 'left' : undefined,
        rowDrag: true,
      },
      {
        headerName: 'Supplier',
        field: 'supplier',
        minWidth: 120,
        flex: 1,
        editable: true,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Order Method',
        field: 'orderMethod',
        width: 130,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: {
          values: ORDER_METHOD_OPTIONS.map((o) => o.value),
        },
        valueFormatter: (params) => {
          const opt = ORDER_METHOD_OPTIONS.find((o) => o.value === params.value);
          return opt?.label ?? (params.value as string);
        },
      },
      {
        headerName: 'Location',
        field: 'location',
        width: 100,
        editable: true,
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'SKU',
        field: 'sku',
        width: 100,
        editable: true,
      },
      {
        headerName: 'Barcode',
        field: 'barcode',
        width: 110,
        editable: true,
        hide: mode === 'panel',
      },
      {
        headerName: 'Min',
        field: 'minQty',
        width: 70,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        type: 'numericColumn',
        valueParser: (params) => {
          const val = Number(params.newValue);
          return isNaN(val) ? params.oldValue : val;
        },
      },
      {
        headerName: 'Order',
        field: 'orderQty',
        width: 70,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        type: 'numericColumn',
        valueParser: (params) => {
          const val = Number(params.newValue);
          return isNaN(val) ? params.oldValue : val;
        },
      },
      {
        headerName: 'Price',
        field: 'unitPrice',
        width: 80,
        editable: true,
        cellEditor: 'agNumberCellEditor',
        type: 'numericColumn',
        valueFormatter: (params) => {
          if (params.value == null) return '—';
          return `$${Number(params.value).toFixed(2)}`;
        },
        valueParser: (params) => {
          const cleaned = String(params.newValue).replace(/[$,]/g, '');
          const val = Number(cleaned);
          return isNaN(val) ? params.oldValue : val;
        },
      },
      {
        headerName: 'Color',
        field: 'color',
        width: 100,
        cellRenderer: ColorCellRenderer,
        cellEditor: ColorCellEditor,
        editable: true,
      },
      {
        headerName: 'Product URL',
        field: 'productUrl',
        width: 130,
        cellRenderer: UrlCellRenderer,
        editable: true,
        hide: mode === 'panel',
      },
      {
        headerName: 'Status',
        colId: 'syncStatus',
        width: 60,
        maxWidth: 60,
        cellRenderer: SyncStatusRenderer,
        cellRendererParams: { syncStateById },
        editable: false,
        sortable: false,
        filter: false,
      },
      {
        headerName: '',
        colId: 'actions',
        width: 80,
        maxWidth: 80,
        cellRenderer: ActionsCellRenderer,
        cellRendererParams: { onSyncSingle, onRemoveItem, syncStateById },
        editable: false,
        sortable: false,
        filter: false,
        pinned: 'right',
      },
    ],
    [mode, syncStateById, onSyncSingle, onRemoveItem],
  );

  const rowSelection = useMemo<RowSelectionOptions<MasterListItem>>(
    () => ({
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false,
    }),
    [],
  );

  const selectionColumnDef = useMemo<SelectionColumnDef>(
    () => ({
      width: 44,
      maxWidth: 44,
      pinned: 'left',
      resizable: false,
      sortable: false,
      suppressMovable: true,
      lockPosition: true,
      suppressHeaderMenuButton: true,
    }),
    [],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      resizable: true,
      sortable: true,
      filter: true,
      suppressMovable: false,
    }),
    [],
  );

  const rowClassRules = useMemo<RowClassRules<MasterListItem>>(
    () => ({
      'row-needs-attention': (params) => !!params.data?.needsAttention,
      'row-sync-success': (params) => syncStateById[params.data?.id ?? '']?.status === 'success',
      'row-sync-error': (params) => syncStateById[params.data?.id ?? '']?.status === 'error',
    }),
    [syncStateById],
  );

  const containerHeight = mode === 'fullpage' ? 'calc(100vh - 160px)' : 'clamp(320px, 45vh, 620px)';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-arda-border bg-arda-bg-secondary/70">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-arda-text">Item Ledger</h3>
          <span className="text-xs text-arda-text-muted">{items.length} items</span>
          {Object.values(syncStateById).filter((s) => s.status === 'success').length > 0 && (
            <span className="text-xs text-arda-success-text">
              {Object.values(syncStateById).filter((s) => s.status === 'success').length} synced
            </span>
          )}
          {Object.values(syncStateById).filter((s) => s.status === 'error').length > 0 && (
            <span className="text-xs text-arda-danger-text">
              {Object.values(syncStateById).filter((s) => s.status === 'error').length} failed
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      <div
        className="ag-theme-arda flex-1 min-h-0"
        style={{
          height: containerHeight,
          width: '100%',
          minHeight: mode === 'panel' ? 320 : undefined,
        }}
      >
        <AgGridReact<MasterListItem>
          ref={gridRef}
          theme={ardaTheme}
          rowData={items}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          selectionColumnDef={selectionColumnDef}
          getRowId={getRowId}
          rowClassRules={rowClassRules}
          onCellValueChanged={onCellValueChanged}
          onGridReady={onGridReady}
          // Selection
          rowSelection={rowSelection}
          // Editing
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          undoRedoCellEditing
          undoRedoCellEditingLimit={20}
          // Row drag
          rowDragManaged
          animateRows
          // Performance
          suppressColumnVirtualisation={items.length < 100}
          rowBuffer={10}
          // Empty state
          overlayNoRowsTemplate='<div class="p-8 text-center text-arda-text-muted"><div class="text-lg mb-1">No items yet</div><div class="text-sm">Items will appear here as you collect them from each step.</div></div>'
        />
      </div>
    </div>
  );
};
