import { Router, Request, Response } from 'express';
import { query } from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Middleware to require authentication
function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Get all orders for current user
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT o.*, 
        COALESCE(json_agg(
          json_build_object(
            'id', oi.id,
            'name', oi.name,
            'quantity', oi.quantity,
            'unit', oi.unit,
            'unitPrice', oi.unit_price,
            'totalPrice', oi.total_price
          )
        ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.order_date DESC
    `, [req.session.userId]);

    res.json({ orders: result.rows });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Save new orders (batch)
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;

    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders must be an array' });
    }

    const savedOrders = [];

    for (const order of orders) {
      // Insert order
      const orderResult = await query(`
        INSERT INTO orders (id, user_id, original_email_id, supplier, order_date, total_amount, confidence, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          supplier = EXCLUDED.supplier,
          order_date = EXCLUDED.order_date,
          total_amount = EXCLUDED.total_amount,
          confidence = EXCLUDED.confidence,
          raw_data = EXCLUDED.raw_data
        RETURNING *
      `, [
        order.id || uuidv4(),
        req.session.userId,
        order.originalEmailId,
        order.supplier,
        order.orderDate,
        order.totalAmount,
        order.confidence,
        JSON.stringify(order),
      ]);

      const savedOrder = orderResult.rows[0];

      // Insert order items
      if (order.items && Array.isArray(order.items)) {
        // Delete existing items first
        await query('DELETE FROM order_items WHERE order_id = $1', [savedOrder.id]);

        for (const item of order.items) {
          await query(`
            INSERT INTO order_items (order_id, name, quantity, unit, unit_price, total_price)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            savedOrder.id,
            item.name,
            item.quantity,
            item.unit,
            item.unitPrice,
            item.totalPrice,
          ]);
        }
      }

      savedOrders.push(savedOrder);
    }

    res.json({ success: true, orders: savedOrders });
  } catch (error) {
    console.error('Save orders error:', error);
    res.status(500).json({ error: 'Failed to save orders' });
  }
});

// Get inventory stats (computed from orders)
router.get('/inventory', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await query(`
      SELECT 
        oi.name,
        COUNT(DISTINCT o.id) as order_count,
        SUM(oi.quantity) as total_quantity,
        MIN(o.order_date) as first_order_date,
        MAX(o.order_date) as last_order_date,
        AVG(oi.unit_price) as avg_price,
        STRING_AGG(DISTINCT o.supplier, ', ') as suppliers
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.user_id = $1
      GROUP BY oi.name
      ORDER BY order_count DESC
    `, [req.session.userId]);

    // Compute additional stats
    const inventory = result.rows.map(item => {
      const daysBetween = item.first_order_date && item.last_order_date
        ? Math.max(1, Math.ceil((new Date(item.last_order_date).getTime() - new Date(item.first_order_date).getTime()) / (1000 * 60 * 60 * 24)))
        : 1;
      
      const orderCount = parseInt(item.order_count);
      const averageCadenceDays = orderCount > 1 ? Math.round(daysBetween / (orderCount - 1)) : 30;
      const dailyBurnRate = parseFloat(item.total_quantity) / daysBetween;
      
      return {
        name: item.name,
        totalQuantityOrdered: parseFloat(item.total_quantity),
        orderCount,
        firstOrderDate: item.first_order_date,
        lastOrderDate: item.last_order_date,
        averageCadenceDays,
        dailyBurnRate: Math.round(dailyBurnRate * 100) / 100,
        recommendedMin: Math.ceil(dailyBurnRate * 7), // 1 week buffer
        recommendedOrderQty: Math.ceil(dailyBurnRate * averageCadenceDays),
        lastPrice: parseFloat(item.avg_price) || 0,
        suppliers: item.suppliers,
      };
    });

    res.json({ inventory });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ error: 'Failed to get inventory' });
  }
});

// Delete order
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await query(`
      DELETE FROM orders WHERE id = $1 AND user_id = $2
    `, [req.params.id, req.session.userId]);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

export { router as ordersRouter };
