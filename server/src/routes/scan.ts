import { Router, Request, Response } from 'express';

const router = Router();

// In-memory storage for scan sessions (in production, use Redis)
interface ScannedBarcode {
  id: string;
  barcode: string;
  barcodeType: string;
  scannedAt: string;
  source: 'desktop' | 'mobile';
  productName?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
}

interface ScanSession {
  barcodes: ScannedBarcode[];
  createdAt: string;
  lastActivity: string;
}

const scanSessions = new Map<string, ScanSession>();

// Clean up old sessions (older than 24 hours)
const cleanupOldSessions = () => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of scanSessions.entries()) {
    if (now - new Date(session.lastActivity).getTime() > maxAge) {
      scanSessions.delete(sessionId);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// Get or create session
const getSession = (sessionId: string): ScanSession => {
  let session = scanSessions.get(sessionId);
  if (!session) {
    session = {
      barcodes: [],
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    scanSessions.set(sessionId, session);
  }
  return session;
};

/**
 * GET /api/scan/session/:sessionId/barcodes
 * Get all barcodes for a session (used by desktop to poll for mobile scans)
 */
router.get('/session/:sessionId/barcodes', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { since } = req.query; // Optional: only return barcodes since this timestamp
  
  const session = getSession(sessionId);
  
  let barcodes = session.barcodes;
  
  // Filter by timestamp if provided
  if (since && typeof since === 'string') {
    const sinceDate = new Date(since);
    barcodes = barcodes.filter(b => new Date(b.scannedAt) > sinceDate);
  }
  
  res.json({ barcodes });
});

/**
 * POST /api/scan/session/:sessionId/barcode
 * Add a barcode to a session (used by mobile scanner)
 */
router.post('/session/:sessionId/barcode', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { id, data, timestamp, barcodeType } = req.body;
  
  if (!data) {
    return res.status(400).json({ error: 'Barcode data is required' });
  }
  
  const session = getSession(sessionId);
  session.lastActivity = new Date().toISOString();
  
  // Check for duplicates
  if (session.barcodes.some(b => b.barcode === data)) {
    return res.json({ success: true, duplicate: true });
  }
  
  // Look up product info
  let productInfo: { name?: string; brand?: string; imageUrl?: string; category?: string } = {};
  try {
    productInfo = await lookupBarcode(data);
  } catch (error) {
    console.error('Barcode lookup error:', error);
  }
  
  const barcode: ScannedBarcode = {
    id: id || `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    barcode: data,
    barcodeType: barcodeType || detectBarcodeType(data),
    scannedAt: timestamp || new Date().toISOString(),
    source: 'mobile',
    productName: productInfo.name,
    brand: productInfo.brand,
    imageUrl: productInfo.imageUrl,
    category: productInfo.category,
  };
  
  session.barcodes.push(barcode);
  
  res.json({ success: true, barcode });
});

/**
 * GET /api/barcode/lookup
 * Look up product information from a barcode
 */
router.get('/lookup', async (req: Request, res: Response) => {
  const { code } = req.query;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Barcode code is required' });
  }
  
  try {
    const productInfo = await lookupBarcode(code);
    
    if (productInfo.name) {
      res.json(productInfo);
    } else {
      res.status(404).json({ error: 'Product not found' });
    }
  } catch (error) {
    console.error('Barcode lookup error:', error);
    res.status(500).json({ error: 'Lookup failed' });
  }
});

/**
 * Detect barcode type from string
 */
function detectBarcodeType(barcode: string): string {
  const digits = barcode.replace(/\D/g, '');
  if (digits.length === 12) return 'UPC-A';
  if (digits.length === 13) return 'EAN-13';
  if (digits.length === 8) return 'EAN-8';
  if (digits.length === 14) return 'GTIN-14';
  return 'unknown';
}

/**
 * Look up product info from barcode using Open Food Facts or UPC Database
 */
async function lookupBarcode(barcode: string): Promise<{
  name?: string;
  brand?: string;
  imageUrl?: string;
  category?: string;
}> {
  const cleanCode = barcode.replace(/\D/g, '');
  
  // Try Open Food Facts first (free, no API key needed)
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${cleanCode}.json`
    );
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.status === 1 && data.product) {
        const product = data.product;
        return {
          name: product.product_name || product.product_name_en,
          brand: product.brands,
          imageUrl: product.image_url || product.image_front_url,
          category: product.categories?.split(',')[0]?.trim(),
        };
      }
    }
  } catch (error) {
    console.error('Open Food Facts lookup error:', error);
  }
  
  // Try UPC Item DB as fallback (free tier)
  try {
    const response = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${cleanCode}`
    );
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        return {
          name: item.title,
          brand: item.brand,
          imageUrl: item.images?.[0],
          category: item.category,
        };
      }
    }
  } catch (error) {
    console.error('UPC Item DB lookup error:', error);
  }
  
  // Return empty if nothing found
  return {};
}

export default router;
