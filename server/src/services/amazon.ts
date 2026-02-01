// Amazon Product Advertising API Integration
// Uses the Affimation proxy API for simplified access

interface AmazonItemResponse {
  ASIN: string;
  ItemName?: string;
  Price?: string;
  ImageURL?: string;
  AmazonURL?: string;
  Quantity?: string;
  Units?: string;
  UnitCount?: number;
  UnitPrice?: number;
  UPC?: string;
}

interface AmazonApiResponse {
  items?: AmazonItemResponse[];
  error?: string;
}

// API Configuration - loaded from environment variables
const AMAZON_API_CONFIG = {
  url: process.env.AMAZON_API_URL || 'https://api.affimation.com/V2/item',
  apiKey: process.env.AMAZON_API_KEY || '',
  accessKey: process.env.AMAZON_ACCESS_KEY || '',
  secretKey: process.env.AMAZON_SECRET_KEY || '',
  partnerTag: process.env.AMAZON_PARTNER_TAG || 'arda06-20',
};

// ASIN pattern: B followed by 9 alphanumeric, or 10 digits
const ASIN_PATTERN = /\b(B0[A-Z0-9]{8}|[0-9]{10})\b/gi;

// Extract ASINs from email content
export function extractAsinsFromEmail(emailBody: string, emailSubject: string): string[] {
  const text = `${emailSubject} ${emailBody}`;
  const matches = text.match(ASIN_PATTERN) || [];
  
  // Deduplicate and filter
  const asins = [...new Set(matches)]
    .filter(asin => {
      // Filter out common false positives (phone numbers, zip codes, etc.)
      if (/^[0-9]{10}$/.test(asin)) {
        // 10-digit numbers are more likely to be false positives
        // Only accept if it appears near Amazon-related context
        const context = text.toLowerCase();
        return context.includes('amazon') || context.includes('asin');
      }
      return true;
    });
  
  return asins;
}

// Extract ASINs from Amazon product URLs
export function extractAsinFromUrl(url: string): string | null {
  // Patterns for Amazon product URLs
  const patterns = [
    /amazon\.com\/dp\/([A-Z0-9]{10})/i,
    /amazon\.com\/gp\/product\/([A-Z0-9]{10})/i,
    /amazon\.com\/.*\/dp\/([A-Z0-9]{10})/i,
    /amzn\.to\/([A-Z0-9]+)/i,  // Short links (would need redirect follow)
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

// Fetch item details from Amazon API
export async function getAmazonItemDetails(asins: string[]): Promise<Map<string, AmazonItemResponse>> {
  const results = new Map<string, AmazonItemResponse>();
  
  if (asins.length === 0) {
    return results;
  }
  
  // Check if credentials are configured
  if (!AMAZON_API_CONFIG.apiKey || !AMAZON_API_CONFIG.accessKey || !AMAZON_API_CONFIG.secretKey) {
    console.warn('⚠️ Amazon API credentials not configured');
    return results;
  }
  
  try {
    console.log(`🛒 Fetching Amazon data for ${asins.length} ASINs:`, asins);
    
    const response = await fetch(AMAZON_API_CONFIG.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': AMAZON_API_CONFIG.apiKey,
      },
      body: JSON.stringify({
        itemids: asins,
        access_key: AMAZON_API_CONFIG.accessKey,
        secret_key: AMAZON_API_CONFIG.secretKey,
        partner_tag: AMAZON_API_CONFIG.partnerTag,
        Resources: [
          'ItemInfo.ProductInfo',
          'ItemInfo.TechnicalInfo',
          'ItemInfo.ExternalIds',
          'ItemInfo.Title',
          'Images.Primary.Large',
          'Offers.Listings.Price',
        ],
      }),
    });
    
    if (!response.ok) {
      console.error('Amazon API error:', response.status, response.statusText);
      return results;
    }
    
    const data = await response.json() as AmazonApiResponse;
    
    if (data.items) {
      for (const item of data.items) {
        if (item.ASIN) {
          results.set(item.ASIN, item);
          console.log(`  ✓ ${item.ASIN}: ${item.ItemName?.substring(0, 50)}...`);
        }
      }
    }
    
    console.log(`✅ Got Amazon data for ${results.size}/${asins.length} items`);
  } catch (error) {
    console.error('Amazon API fetch error:', error);
  }
  
  return results;
}

// Enrich a single item with Amazon data
export async function enrichItemWithAmazon(asin: string): Promise<AmazonItemResponse | null> {
  const results = await getAmazonItemDetails([asin]);
  return results.get(asin) || null;
}

// Batch enrich multiple items
export async function batchEnrichItems(asins: string[]): Promise<Map<string, AmazonItemResponse>> {
  // API may have rate limits, so batch in groups of 10
  const batchSize = 10;
  const allResults = new Map<string, AmazonItemResponse>();
  
  for (let i = 0; i < asins.length; i += batchSize) {
    const batch = asins.slice(i, i + batchSize);
    const results = await getAmazonItemDetails(batch);
    
    for (const [asin, data] of results) {
      allResults.set(asin, data);
    }
    
    // Rate limit: wait 1 second between batches
    if (i + batchSize < asins.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return allResults;
}

export const amazonService = {
  extractAsinsFromEmail,
  extractAsinFromUrl,
  getAmazonItemDetails,
  enrichItemWithAmazon,
  batchEnrichItems,
};
