// Arda API Routes - Proxy endpoints for frontend
import { Router, Request, Response, NextFunction } from 'express';
import { ardaService, createItemFromVelocity, syncVelocityToArda } from '../services/arda.js';
import type {
  ItemInput,
  ItemSupplyValue,
  MoneyValue,
  OrderMethod,
  PhysicalLocatorValue,
  QuantityValue,
  KanbanCardInput,
  OrderHeaderInput,
  ItemVelocityProfileInput,
} from '../services/arda.js';
import { cognitoService } from '../services/cognito.js';
import { getUserEmail } from './auth.js';

const router = Router();

// Extend session types
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

// Get user credentials from session - returns email, tenantId, and author (sub)
// Falls back to first Cognito user for demo mode when not authenticated
async function getUserCredentials(req: Request): Promise<{ email: string; tenantId: string | null; author: string | null }> {
  let email = '';
  
  // Try to get from session first
  if (req.session?.userId) {
    const sessionEmail = await getUserEmail(req.session.userId);
    if (sessionEmail) email = sessionEmail;
  }

  // Look up user in Cognito
  let cognitoUser = email ? cognitoService.getUserByEmail(email) : null;
  
  // Fallback: use kyle@arda.cards for demo mode if no session
  if (!cognitoUser) {
    const fallbackEmail = 'kyle@arda.cards';
    cognitoUser = cognitoService.getUserByEmail(fallbackEmail);
    if (cognitoUser) {
      email = fallbackEmail;
      console.log(`🎭 Using fallback user ${fallbackEmail} for demo mode`);
    }
  }
  
  return {
    email,
    tenantId: cognitoUser?.tenantId || process.env.ARDA_TENANT_ID || null,
    author: cognitoUser?.sub || null,
  };
}

// Middleware to check if user is authenticated
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : undefined;
}

function toOrderMethod(value: unknown): OrderMethod | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return undefined;

  // Map legacy OrderPulse values to Arda enum
  if (normalized === 'EMAIL') return 'EMAIL';
  if (normalized === 'ONLINE') return 'ONLINE';
  if (normalized === 'PHONE') return 'PHONE';
  if (normalized === 'IN_STORE' || normalized === 'IN-STORE') return 'IN_STORE';
  if (normalized === 'PURCHASE_ORDER' || normalized === 'PO') return 'PURCHASE_ORDER';
  if (normalized === 'RFQ') return 'RFQ';
  if (normalized === 'THIRD_PARTY' || normalized === 'THIRDPARTY') return 'THIRD_PARTY';
  if (normalized === 'PRODUCTION') return 'PRODUCTION';
  if (normalized === 'TASK') return 'TASK';

  // Backward compat from older code paths
  if (normalized === 'ORDERMECHANISM' || normalized === 'ORDER_MECHANISM') return 'OTHER';
  if (normalized === 'AUTO' || normalized === 'MANUAL') return 'OTHER';

  if ((['UNKNOWN','PURCHASE_ORDER','EMAIL','PHONE','IN_STORE','ONLINE','RFQ','PRODUCTION','TASK','THIRD_PARTY','OTHER'] as const).includes(normalized as OrderMethod)) {
    return normalized as OrderMethod;
  }
  return 'OTHER';
}

function toQuantity(amount: unknown, unit: unknown): QuantityValue | undefined {
  const a = asNumber(amount);
  const u = asTrimmedString(unit) || 'EA';
  if (a === undefined) return undefined;
  return { amount: a, unit: u };
}

function toUnitCost(value: unknown, currency: unknown): MoneyValue | undefined {
  const v = asNumber(value);
  if (v === undefined) return undefined;
  // Currency is optional in OrderPulse; Arda supports a fixed enum.
  const c = (asTrimmedString(currency) || 'USD').toUpperCase();
  const allowed = new Set([
    'USD','CAD','EUR','GBP','JPY','AUD','CNY','INR','RUB','BRL','ZAR','MXN','KRW','SGD','HKD','NZD','CHF',
  ]);
  return {
    value: v,
    currency: (allowed.has(c) ? c : 'USD') as MoneyValue['currency'],
  };
}

function normalizePrimarySupply(body: Record<string, unknown>): ItemSupplyValue {
  // If caller already provides a primarySupply object in the Arda shape, preserve it (best-effort)
  const maybePrimarySupply = body.primarySupply as unknown;
  if (maybePrimarySupply && typeof maybePrimarySupply === 'object') {
    const supplyObj = maybePrimarySupply as Record<string, unknown>;
    const supplier = asTrimmedString(supplyObj.supplier) || asTrimmedString(body.primarySupplier) || 'Unknown';
    const supply: ItemSupplyValue = {
      supplier,
      name: asTrimmedString(supplyObj.name) ?? null,
      sku: asTrimmedString(supplyObj.sku) ?? null,
      url: asTrimmedString(supplyObj.url) ?? asTrimmedString(body.primarySupplierLink) ?? null,
      orderMethod: toOrderMethod(supplyObj.orderMethod ?? body.orderMechanism) ?? null,
      orderQuantity: (supplyObj.orderQuantity && typeof supplyObj.orderQuantity === 'object')
        ? (supplyObj.orderQuantity as QuantityValue)
        : (toQuantity(body.orderQty, body.orderQtyUnit ?? body.minQtyUnit) ?? null),
      unitCost: (supplyObj.unitCost && typeof supplyObj.unitCost === 'object')
        ? (supplyObj.unitCost as MoneyValue)
        : (toUnitCost(body.unitPrice, body.currency) ?? null),
    };
    return supply;
  }

  const supplier =
    asTrimmedString(body.primarySupplier) ||
    asTrimmedString(body.supplier) ||
    asTrimmedString(body.primarySupply) || // sometimes sent as string by clients
    'Unknown';

  const supply: ItemSupplyValue = {
    supplier,
    sku: asTrimmedString(body.sku) ?? null,
    url: asTrimmedString(body.primarySupplierLink) ?? asTrimmedString(body.productUrl) ?? null,
    orderMethod: toOrderMethod(body.orderMechanism) ?? null,
    orderQuantity: toQuantity(body.orderQty, body.orderQtyUnit ?? body.minQtyUnit) ?? null,
    unitCost: toUnitCost(body.unitPrice, body.currency) ?? null,
  };

  return supply;
}

function normalizeLocator(body: Record<string, unknown>): PhysicalLocatorValue | undefined {
  const maybeLocator = body.locator as unknown;
  if (maybeLocator && typeof maybeLocator === 'object') {
    const loc = maybeLocator as Record<string, unknown>;
    const facility = asTrimmedString(loc.facility);
    if (facility) {
      return {
        facility,
        department: asTrimmedString(loc.department) ?? null,
        location: asTrimmedString(loc.location) ?? null,
        subLocation: asTrimmedString(loc.subLocation) ?? null,
      };
    }
  }

  const location = asTrimmedString(body.location);
  if (!location) return undefined;
  const facility = process.env.ARDA_FACILITY || 'Default';
  return { facility, location };
}

function normalizeItemInput(body: Record<string, unknown>): ItemInput {
  const name = asTrimmedString(body.name) || asTrimmedString(body.itemName) || '';
  const internalSKU = asTrimmedString(body.internalSKU) || asTrimmedString(body.sku) || undefined;
  const imageUrl = asTrimmedString(body.imageUrl) || undefined;
  const minQuantity =
    (body.minQuantity && typeof body.minQuantity === 'object')
      ? (body.minQuantity as QuantityValue)
      : toQuantity(body.minQty, body.minQtyUnit);

  return {
    name,
    internalSKU,
    imageUrl,
    minQuantity: minQuantity ?? null,
    locator: normalizeLocator(body) ?? null,
    primarySupply: normalizePrimarySupply(body),
  };
}

// Check if Arda is configured
router.get('/status', (req: Request, res: Response) => {
  res.json({
    configured: ardaService.isConfigured(),
    message: ardaService.isConfigured()
      ? 'Arda API is configured'
      : 'Missing ARDA_API_KEY or ARDA_TENANT_ID environment variables',
  });
});

// Debug: Look up tenant ID from email (public for testing)
router.get('/lookup-tenant', async (req: Request, res: Response) => {
  try {
    // Accept email from query param or session
    let email = req.query.email as string;
    if (!email && req.session?.userId) {
      email = (await getUserCredentials(req)).email;
    }
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email required. Pass ?email=your@email.com'
      });
    }
    
    console.log(`🔍 Looking up tenant for email: ${email}`);
    
    const tenantId = await ardaService.getTenantByEmail(email);
    
    if (tenantId) {
      res.json({
        success: true,
        email,
        tenantId,
        message: `Found tenant ID! Add this to your .env: ARDA_TENANT_ID=${tenantId}`
      });
    } else {
      res.json({
        success: false,
        email,
        tenantId: null,
        message: `No tenant found for email: ${email}. Make sure this email is registered in Arda.`
      });
    }
  } catch (error) {
    console.error('Tenant lookup error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to lookup tenant',
    });
  }
});

// Create item in Arda
router.post('/items', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const item = normalizeItemInput(body);

    // Validate required fields (Arda requires at least a name; primarySupply.supplier is required by schema)
    if (!item.name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }
    if (!item.primarySupply?.supplier) {
      return res.status(400).json({ error: 'Missing required field: primarySupply.supplier' });
    }

    const result = await ardaService.createItem(item, credentials.author!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create item error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create item in Arda',
    });
  }
});

// Create Kanban card in Arda
router.post('/kanban-cards', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }
    const cardData: KanbanCardInput = req.body;

    // Validate required fields
    if (!cardData.item || !cardData.quantity) {
      return res.status(400).json({
        error: 'Missing required fields: item and quantity are required',
      });
    }

    const result = await ardaService.createKanbanCard(cardData, credentials.author!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create kanban card error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create Kanban card in Arda',
    });
  }
});

// Create order in Arda
router.post('/orders', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }
    const orderData = req.body;

    // Map OrderPulse order to Arda OrderHeaderInput
    const order: OrderHeaderInput = {
      orderDate: {
        utcTimestamp: orderData.orderDate
          ? new Date(orderData.orderDate).getTime()
          : Date.now(),
      },
      allowPartial: orderData.allowPartial ?? false,
      expedite: orderData.expedite ?? false,
      supplierName: orderData.supplier || orderData.supplierName,
      notes: orderData.notes,
      taxesAndFees: orderData.taxesAndFees || {},
    };

    if (orderData.deliverBy) {
      order.deliverBy = { utcTimestamp: new Date(orderData.deliverBy).getTime() };
    }

    const result = await ardaService.createOrder(order, credentials.author!);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda create order error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create order in Arda',
    });
  }
});

// Bulk sync items to Arda (no auth required for demo)
router.post('/items/bulk', async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    const rawItems = (req.body as { items?: unknown })?.items;

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'items array is required',
        debug: { email: credentials.email }
      });
    }

    const invalid: Array<{ index: number; reason: string }> = [];
    const items: ItemInput[] = [];

    for (let i = 0; i < rawItems.length; i++) {
      const raw = rawItems[i];
      if (!raw || typeof raw !== 'object') {
        invalid.push({ index: i, reason: 'item must be an object' });
        continue;
      }

      const normalized = normalizeItemInput(raw as Record<string, unknown>);
      if (!normalized.name) {
        invalid.push({ index: i, reason: 'Missing required field: name' });
        continue;
      }
      if (!normalized.primarySupply?.supplier) {
        invalid.push({ index: i, reason: 'Missing required field: primarySupply.supplier' });
        continue;
      }
      items.push(normalized);
    }

    if (invalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'One or more items are invalid',
        invalid,
      });
    }

    // Check if we have valid Cognito credentials
    if (!credentials.author || !credentials.tenantId) {
      // Try to provide helpful error message
      const cognitoStatus = cognitoService.getSyncStatus();
      return res.status(400).json({
        success: false,
        error: 'Missing Cognito credentials for Arda sync',
        details: {
          email: credentials.email,
          authorFound: !!credentials.author,
          tenantIdFound: !!credentials.tenantId,
          cognitoUsersLoaded: cognitoStatus.userCount,
          message: !credentials.author 
            ? `User ${credentials.email} not found in Cognito cache. Ensure user is in Arda and run POST /api/cognito/sync.`
            : `Tenant ID not found. Set ARDA_TENANT_ID in env or ensure user has tenant in Cognito.`
        }
      });
    }

    console.log(`📤 Syncing ${items.length} items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${credentials.author}, Tenant: ${credentials.tenantId}`);

    // Sync each item with proper author from Cognito
    const results = await Promise.allSettled(
      items.map((item) => ardaService.createItem(item, credentials.author!))
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    res.json({
      success: failed === 0,
      credentials: {
        email: credentials.email,
        author: credentials.author,
        tenantId: credentials.tenantId,
      },
      summary: { total: items.length, successful, failed },
      results: results.map((r, i) => ({
        item: items[i].name,
        status: r.status,
        error: r.status === 'rejected' ? (r.reason as Error).message : undefined,
        record: r.status === 'fulfilled' ? (r as PromiseFulfilledResult<unknown>).value : undefined,
      })),
    });
  } catch (error) {
    console.error('Arda bulk sync error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to bulk sync items',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Sync velocity profiles to Arda
router.post('/sync-velocity', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }

    const { profiles, author } = req.body;

    // Validate request body
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return res.status(400).json({
        error: 'profiles array is required and must not be empty',
      });
    }

    if (!author || typeof author !== 'string') {
      return res.status(400).json({
        error: 'author string is required',
      });
    }

    // Validate each profile
    for (const profile of profiles) {
      if (!profile.displayName || !profile.supplier) {
        return res.status(400).json({
          error: 'Each profile must have displayName and supplier',
        });
      }
    }

    console.log(`📤 Syncing ${profiles.length} velocity profiles to Arda for user ${credentials.email}`);

    // Use the provided author or fall back to credentials author
    const syncAuthor = author || credentials.author!;
    const results = await syncVelocityToArda(profiles, syncAuthor);

    res.json({ results });
  } catch (error) {
    console.error('Arda sync velocity error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync velocity profiles to Arda',
    });
  }
});

// Push velocity items to Arda
router.post('/push-velocity', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }

    const { items } = req.body;

    // Validate request body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'items array is required and must not be empty',
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.displayName || !item.supplier) {
        return res.status(400).json({
          success: false,
          error: 'Each item must have displayName and supplier',
        });
      }
    }

    console.log(`📤 Pushing ${items.length} velocity items to Arda for user ${credentials.email}`);
    console.log(`   Author: ${credentials.author}, Tenant: ${credentials.tenantId}`);

    // Call syncVelocityToArda with items and credentials author
    const results = await ardaService.syncVelocityToArda(items, credentials.author);

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.json({
      success: failed === 0,
      summary: { total: items.length, successful, failed },
      results,
    });
  } catch (error) {
    console.error('Arda push velocity error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to push velocity items to Arda',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

// Sync a single item from velocity data
router.post('/sync-item', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    if (!credentials.author) {
      return res.status(400).json({ success: false, error: `User ${credentials.email} not found in Cognito` });
    }

    const { author, ...profileData } = req.body;

    // Validate required fields
    if (!profileData.displayName || !profileData.supplier) {
      return res.status(400).json({
        error: 'Missing required fields: displayName and supplier are required',
      });
    }

    // Use the provided author or fall back to credentials author
    const syncAuthor = author || credentials.author!;

    console.log(`📤 Syncing item "${profileData.displayName}" to Arda for user ${credentials.email}`);

    const result = await createItemFromVelocity(profileData as ItemVelocityProfileInput, syncAuthor);
    res.json({ success: true, record: result });
  } catch (error) {
    console.error('Arda sync item error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to sync item from velocity data',
    });
  }
});

// Get sync status (returns basic status since tracking is not yet implemented)
router.get('/sync-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const credentials = await getUserCredentials(req);
    
    // Since sync status tracking is not yet implemented, return basic status
    res.json({
      success: true,
      message: 'Sync status tracking is not yet implemented',
      user: credentials.email,
      ardaConfigured: ardaService.isConfigured(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Arda sync status error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get sync status',
    });
  }
});

export default router;
