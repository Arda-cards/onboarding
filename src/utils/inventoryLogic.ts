import { ExtractedOrder, InventoryItem } from '../types';

export const processOrdersToInventory = (orders: ExtractedOrder[]): InventoryItem[] => {
  const itemMap = new Map<string, InventoryItem>();

  // 1. Group items
  orders.forEach(order => {
    order.items.forEach(lineItem => {
      // Normalize name (simple lowercasing and trimming for this demo)
      const key = lineItem.name.trim().toLowerCase();
      
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          id: key,
          name: lineItem.name,
          supplier: order.supplier,
          totalQuantityOrdered: 0,
          orderCount: 0,
          firstOrderDate: order.orderDate,
          lastOrderDate: order.orderDate,
          averageCadenceDays: 0,
          dailyBurnRate: 0,
          recommendedMin: 0,
          recommendedOrderQty: 0,
          lastPrice: lineItem.unitPrice || 0,
          history: []
        });
      }

      const entry = itemMap.get(key)!;
      
      // Update basic stats
      entry.totalQuantityOrdered += lineItem.quantity;
      entry.orderCount += 1;
      
      // Update dates
      if (new Date(order.orderDate) < new Date(entry.firstOrderDate)) entry.firstOrderDate = order.orderDate;
      if (new Date(order.orderDate) > new Date(entry.lastOrderDate)) entry.lastOrderDate = order.orderDate;
      
      // Update price
      if (lineItem.unitPrice) entry.lastPrice = lineItem.unitPrice;

      // Add to history
      entry.history.push({ date: order.orderDate, quantity: lineItem.quantity });
    });
  });

  // 2. Calculate Analytics
  return Array.from(itemMap.values()).map(item => {
    // Sort history by date
    item.history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const firstDate = new Date(item.firstOrderDate);
    const lastDate = new Date(item.lastOrderDate);
    const daySpan = (lastDate.getTime() - firstDate.getTime()) / (1000 * 3600 * 24);

    // Calc Cadence (Average days between orders)
    // Needs at least 2 orders to calculate cadence
    if (item.orderCount > 1 && daySpan > 0) {
      item.averageCadenceDays = daySpan / (item.orderCount - 1);
    } else {
      item.averageCadenceDays = 30; // Default assumption if not enough data
    }

    // Calc Burn Rate (Units per day)
    // If span is 0 (single day), assume 30 day usage for the total qty
    const effectiveSpan = daySpan === 0 ? 30 : daySpan;
    item.dailyBurnRate = item.totalQuantityOrdered / effectiveSpan;

    // Calc Recommendations
    // Min (Reorder Point) = Lead Time Demand + Safety Stock
    // Assume 7 day lead time, 50% safety stock factor
    const LEAD_TIME = 7;
    const SAFETY_FACTOR = 1.5;
    item.recommendedMin = Math.ceil(item.dailyBurnRate * LEAD_TIME * SAFETY_FACTOR);

    // Order Qty (EOQ-lite)
    // Just a heuristic: Order enough for the cadence duration or 1 month, whichever is larger
    const targetDays = Math.max(item.averageCadenceDays, 30);
    item.recommendedOrderQty = Math.ceil(item.dailyBurnRate * targetDays);

    return item;
  });
};
