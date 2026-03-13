import { ItemVelocityProfile, ExtractedOrder } from '../types';

/**
 * Escapes a CSV field value by wrapping in quotes if necessary
 * and escaping internal quotes by doubling them.
 */
function escapeCSVValue(value: string | number | undefined | null): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  
  // If the value contains comma, quote, or newline, wrap in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    // Escape quotes by doubling them
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Formats a date string for CSV export (ISO date format: YYYY-MM-DD)
 */
function formatDateForCSV(dateString: string | undefined | null): string {
  if (!dateString) {
    return '';
  }
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if invalid
    }
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  } catch {
    return dateString;
  }
}

/**
 * Formats a date string for CSV export with time (YYYY-MM-DD HH:MM:SS)
 */
function formatDateTimeForCSV(dateString: string | undefined | null): string {
  if (!dateString) {
    return '';
  }
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if invalid
    }
    const datePart = date.toISOString().split('T')[0];
    const timePart = date.toTimeString().split(' ')[0];
    return `${datePart} ${timePart}`;
  } catch {
    return dateString;
  }
}

/**
 * Helper function to trigger a browser download of CSV content
 */
export function downloadCSV(filename: string, csvContent: string): void {
  // Create a blob with the CSV content
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  // Create a temporary URL for the blob
  const url = URL.createObjectURL(blob);
  
  // Create a temporary anchor element and trigger download
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.display = 'none';
  
  // Append to body, click, and remove
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Exports velocity profiles to CSV format
 * Columns: Item Name, Supplier, SKU, Total Ordered, Order Count, Avg Cadence Days, Daily Burn Rate, Recommended Min, Recommended Order Qty, Next Predicted Order
 */
export function exportVelocityToCSV(profiles: ItemVelocityProfile[]): void {
  // CSV Headers
  const headers = [
    'Item Name',
    'Supplier',
    'SKU',
    'Total Ordered',
    'Order Count',
    'Avg Cadence Days',
    'Daily Burn Rate',
    'Recommended Min',
    'Recommended Order Qty',
    'Next Predicted Order'
  ];
  
  // Build CSV rows
  const rows: string[] = [];
  
  // Add header row
  rows.push(headers.map(escapeCSVValue).join(','));
  
  // Add data rows
  for (const profile of profiles) {
    const row = [
      profile.displayName || profile.normalizedName,
      profile.supplier,
      profile.sku || '',
      profile.totalQuantityOrdered,
      profile.orderCount,
      profile.averageCadenceDays.toFixed(2),
      profile.dailyBurnRate.toFixed(4),
      profile.recommendedMin.toFixed(2),
      profile.recommendedOrderQty.toFixed(2),
      profile.nextPredictedOrder ? formatDateForCSV(profile.nextPredictedOrder) : ''
    ];
    
    rows.push(row.map(escapeCSVValue).join(','));
  }
  
  const csvContent = rows.join('\n');
  downloadCSV('velocity-profiles', csvContent);
}

/**
 * Exports orders to CSV format
 * Columns: Order ID, Email ID, Supplier, Date, Total Amount, Item Count, Item Names
 */
export function exportOrdersToCSV(orders: ExtractedOrder[]): void {
  // CSV Headers
  const headers = [
    'Order ID',
    'Email ID',
    'Supplier',
    'Date',
    'Total Amount',
    'Item Count',
    'Item Names'
  ];
  
  // Build CSV rows
  const rows: string[] = [];
  
  // Add header row
  rows.push(headers.map(escapeCSVValue).join(','));
  
  // Add data rows
  for (const order of orders) {
    // Collect item names, handling multiple items
    const itemNames = order.items.map(item => item.name).join('; ');
    
    const row = [
      order.id,
      order.originalEmailId,
      order.supplier,
      formatDateTimeForCSV(order.orderDate),
      order.totalAmount !== undefined ? order.totalAmount.toFixed(2) : '',
      order.items.length,
      itemNames
    ];
    
    rows.push(row.map(escapeCSVValue).join(','));
  }
  
  const csvContent = rows.join('\n');
  downloadCSV('orders', csvContent);
}

export interface ItemExportRow {
  source?: string;
  name: string;
  supplier?: string;
  description?: string;
  location?: string;
  orderMethod?: string;
  minQty?: number;
  orderQty?: number;
  unitPrice?: number;
  sku?: string;
  barcode?: string;
  asin?: string;
  productUrl?: string;
  imageUrl?: string;
  color?: string;
}

export function exportItemsToCSV(items: ItemExportRow[], filenamePrefix = 'items-export'): void {
  const headers = [
    'Source',
    'Item Name',
    'Supplier',
    'Description',
    'Location',
    'Order Method',
    'Min Qty',
    'Order Qty',
    'Unit Price',
    'SKU',
    'Barcode',
    'ASIN',
    'Product URL',
    'Image URL',
    'Color',
  ];

  const rows: string[] = [];
  rows.push(headers.map(escapeCSVValue).join(','));

  for (const item of items) {
    const row = [
      item.source || '',
      item.name,
      item.supplier || '',
      item.description || '',
      item.location || '',
      item.orderMethod || '',
      item.minQty ?? '',
      item.orderQty ?? '',
      item.unitPrice ?? '',
      item.sku || '',
      item.barcode || '',
      item.asin || '',
      item.productUrl || '',
      item.imageUrl || '',
      item.color || '',
    ];
    rows.push(row.map(escapeCSVValue).join(','));
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csvContent = rows.join('\n');
  downloadCSV(`${filenamePrefix}-${timestamp}`, csvContent);
}
