// Amazon Product Advertising API Routes
import { Router, Request, Response } from 'express';
import { amazonService } from '../services/amazon.js';

const router = Router();

// Middleware to require authentication
async function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    router: 'amazon',
    timestamp: new Date().toISOString() 
  });
});

// Enrich a single ASIN
router.get('/item/:asin', requireAuth, async (req: Request, res: Response) => {
  try {
    const { asin } = req.params;
    
    if (!asin || !/^[A-Z0-9]{10}$/i.test(asin)) {
      return res.status(400).json({ error: 'Invalid ASIN format' });
    }
    
    console.log(`🛒 Enriching single ASIN: ${asin}`);
    const data = await amazonService.enrichItemWithAmazon(asin);
    
    if (!data) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ item: data });
  } catch (error: any) {
    console.error('Amazon item fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch Amazon item' });
  }
});

// Batch enrich multiple ASINs
router.post('/items', requireAuth, async (req: Request, res: Response) => {
  try {
    const { asins } = req.body;
    
    if (!asins || !Array.isArray(asins)) {
      return res.status(400).json({ error: 'asins must be an array' });
    }
    
    // Validate and filter ASINs
    const validAsins = asins
      .filter((asin: string) => typeof asin === 'string' && /^[A-Z0-9]{10}$/i.test(asin))
      .slice(0, 50); // Limit to 50 items per request
    
    if (validAsins.length === 0) {
      return res.status(400).json({ error: 'No valid ASINs provided' });
    }
    
    console.log(`🛒 Batch enriching ${validAsins.length} ASINs`);
    const results = await amazonService.batchEnrichItems(validAsins);
    
    // Convert Map to object for JSON response
    const items: Record<string, any> = {};
    for (const [asin, data] of results) {
      items[asin] = data;
    }
    
    res.json({ 
      items,
      requested: validAsins.length,
      found: results.size,
    });
  } catch (error: any) {
    console.error('Amazon batch fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch Amazon items' });
  }
});

// Extract ASINs from text (for testing)
router.post('/extract-asins', requireAuth, async (req: Request, res: Response) => {
  try {
    const { text, subject } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    
    const asins = amazonService.extractAsinsFromEmail(text, subject || '');
    
    res.json({ asins });
  } catch (error: any) {
    console.error('ASIN extraction error:', error);
    res.status(500).json({ error: 'Failed to extract ASINs' });
  }
});

export { router as amazonRouter };
