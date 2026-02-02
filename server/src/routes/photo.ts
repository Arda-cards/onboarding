import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// In-memory storage for photo sessions (in production, use Redis + S3)
interface CapturedPhoto {
  id: string;
  imageData: string; // Base64 data URL
  capturedAt: string;
  source: 'desktop' | 'mobile';
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean;
}

interface PhotoSession {
  photos: CapturedPhoto[];
  createdAt: string;
  lastActivity: string;
}

const photoSessions = new Map<string, PhotoSession>();

// Clean up old sessions (older than 24 hours)
const cleanupOldSessions = () => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [sessionId, session] of photoSessions.entries()) {
    if (now - new Date(session.lastActivity).getTime() > maxAge) {
      photoSessions.delete(sessionId);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// Get or create session
const getSession = (sessionId: string): PhotoSession => {
  let session = photoSessions.get(sessionId);
  if (!session) {
    session = {
      photos: [],
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    photoSessions.set(sessionId, session);
  }
  return session;
};

/**
 * GET /api/photo/session/:sessionId/photos
 * Get all photos for a session (used by desktop to poll for mobile captures)
 */
router.get('/session/:sessionId/photos', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { since } = req.query;
  
  const session = getSession(sessionId);
  
  let photos = session.photos;
  
  // Filter by timestamp if provided
  if (since && typeof since === 'string') {
    const sinceDate = new Date(since);
    photos = photos.filter(p => new Date(p.capturedAt) > sinceDate);
  }
  
  // Return photos without full image data for listing (to save bandwidth)
  const photoSummaries = photos.map(p => ({
    ...p,
    imageData: p.imageData.substring(0, 100) + '...', // Truncate for listing
    hasFullImage: true,
  }));
  
  res.json({ photos: photoSummaries });
});

/**
 * GET /api/photo/session/:sessionId/photo/:photoId
 * Get full photo data by ID
 */
router.get('/session/:sessionId/photo/:photoId', (req: Request, res: Response) => {
  const { sessionId, photoId } = req.params;
  
  const session = getSession(sessionId);
  const photo = session.photos.find(p => p.id === photoId);
  
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found' });
  }
  
  res.json({ photo });
});

/**
 * POST /api/photo/session/:sessionId/photo
 * Add a photo to a session (used by mobile capture)
 */
router.post('/session/:sessionId/photo', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { id, data, timestamp } = req.body;
  
  if (!data) {
    return res.status(400).json({ error: 'Image data is required' });
  }
  
  const session = getSession(sessionId);
  session.lastActivity = new Date().toISOString();
  
  // Create photo entry
  const photo: CapturedPhoto = {
    id: id || `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    imageData: data,
    capturedAt: timestamp || new Date().toISOString(),
    source: 'mobile',
  };
  
  // Analyze the image in the background
  analyzePhotoAsync(photo).catch(console.error);
  
  session.photos.push(photo);
  
  res.json({ success: true, photoId: photo.id });
});

/**
 * POST /api/photo/analyze
 * Analyze an image to extract text, barcodes, and suggest product info
 */
router.post('/analyze', async (req: Request, res: Response) => {
  const { imageData } = req.body;
  
  if (!imageData) {
    return res.status(400).json({ error: 'Image data is required' });
  }
  
  try {
    const analysis = await analyzeImage(imageData);
    res.json(analysis);
  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

/**
 * Analyze photo asynchronously and update the stored photo
 */
async function analyzePhotoAsync(photo: CapturedPhoto): Promise<void> {
  try {
    const analysis = await analyzeImage(photo.imageData);
    
    // Update photo with analysis results
    photo.extractedText = analysis.extractedText;
    photo.detectedBarcodes = analysis.detectedBarcodes;
    photo.suggestedName = analysis.suggestedName;
    photo.suggestedSupplier = analysis.suggestedSupplier;
    photo.isInternalItem = analysis.isInternalItem;
  } catch (error) {
    console.error('Async photo analysis error:', error);
  }
}

/**
 * Analyze an image using Gemini Vision
 */
async function analyzeImage(imageData: string): Promise<{
  extractedText?: string[];
  detectedBarcodes?: string[];
  suggestedName?: string;
  suggestedSupplier?: string;
  isInternalItem?: boolean;
}> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // Extract base64 data from data URL
    const base64Match = imageData.match(/^data:image\/\w+;base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Invalid image data format');
    }
    
    const base64Data = base64Match[1];
    const mimeType = imageData.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';
    
    const prompt = `Analyze this image of a product or item. Extract the following information:

1. **Visible Text**: List all readable text on the product, packaging, or label
2. **Barcodes**: List any visible barcodes (UPC, EAN, QR codes) - provide the numbers if readable
3. **Product Name**: Suggest a concise, shop-floor friendly name for this item (max 50 chars)
4. **Supplier/Brand**: Identify the manufacturer, brand, or supplier if visible
5. **Item Type**: Determine if this is:
   - An "external" item (commercially purchased with packaging/labels)
   - An "internal" item (internally produced/manufactured, may have handwritten labels or custom markings)

Respond in JSON format:
{
  "extractedText": ["text1", "text2", ...],
  "detectedBarcodes": ["123456789012", ...],
  "suggestedName": "Concise Product Name",
  "suggestedSupplier": "Brand or Supplier Name",
  "isInternalItem": false
}

If any field cannot be determined, omit it or use null.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
    ]);

    const response = result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        extractedText: parsed.extractedText || [],
        detectedBarcodes: parsed.detectedBarcodes || [],
        suggestedName: parsed.suggestedName,
        suggestedSupplier: parsed.suggestedSupplier,
        isInternalItem: parsed.isInternalItem,
      };
    }
    
    return {};
  } catch (error) {
    console.error('Gemini analysis error:', error);
    return {};
  }
}

export default router;
