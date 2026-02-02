import { Router, Request, Response } from 'express';
import { amazonService } from '../services/amazon.js';

const router = Router();

function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;

  // Block obvious IPv4 private / local ranges
  const ipv4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
}

function parsePrice(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  const cleaned = str.replace(/[^0-9.]/g, '');
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

function extractUnitCountFromName(name?: string): number | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const m = lower.match(/\b(\d{1,4})\s*(count|ct|pack|pk|pcs|pieces)\b/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

function getMetaContent(html: string, key: { property?: string; name?: string }): string | undefined {
  if (!html) return undefined;
  if (key.property) {
    const re = new RegExp(`<meta[^>]*property\\s*=\\s*["']${key.property}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i');
    const m = html.match(re);
    return m?.[1]?.trim();
  }
  if (key.name) {
    const re = new RegExp(`<meta[^>]*name\\s*=\\s*["']${key.name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i');
    const m = html.match(re);
    return m?.[1]?.trim();
  }
  return undefined;
}

function extractJsonLdCandidates(html: string): any[] {
  const blocks = Array.from(
    html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ).map(m => m[1]);

  const out: any[] = [];
  for (const raw of blocks) {
    const txt = (raw || '').trim();
    if (!txt) continue;
    try {
      const parsed = JSON.parse(txt);
      out.push(parsed);
    } catch {
      // Some sites embed multiple JSON objects without valid JSON; ignore for now.
    }
  }
  return out;
}

function flattenJsonLd(node: any): any[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (typeof node !== 'object') return [];
  if (node['@graph']) return flattenJsonLd(node['@graph']);
  return [node];
}

function pickProductFromJsonLd(html: string): { name?: string; imageUrl?: string; unitPrice?: number; currency?: string; unitCount?: number } {
  const candidates = extractJsonLdCandidates(html).flatMap(flattenJsonLd);
  const product = candidates.find((c: any) => {
    const type = c?.['@type'];
    if (!type) return false;
    if (Array.isArray(type)) return type.some(t => String(t).toLowerCase() === 'product');
    return String(type).toLowerCase() === 'product';
  });

  if (!product) return {};

  const name = typeof product.name === 'string' ? product.name : undefined;
  const imageUrl =
    typeof product.image === 'string'
      ? product.image
      : Array.isArray(product.image) && typeof product.image[0] === 'string'
        ? product.image[0]
        : undefined;

  // Offers can be object or array
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  const unitPrice =
    parsePrice(offers?.price) ??
    parsePrice(offers?.lowPrice) ??
    parsePrice(offers?.highPrice);
  const currency = typeof offers?.priceCurrency === 'string' ? offers.priceCurrency : undefined;

  return {
    name,
    imageUrl,
    unitPrice,
    currency,
    unitCount: extractUnitCountFromName(name),
  };
}

router.post('/enrich', requireAuth, async (req: Request, res: Response) => {
  try {
    const { url } = req.body as { url?: unknown };
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url is required' });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: 'Only http(s) URLs are allowed' });
    }
    if (isPrivateHostname(parsed.hostname)) {
      return res.status(400).json({ error: 'URL hostname is not allowed' });
    }

    // Resolve short Amazon links (best-effort) so we can extract ASIN
    let resolvedUrl = parsed.toString();
    if (['amzn.to', 'a.co'].includes(parsed.hostname.toLowerCase())) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const head = await fetch(resolvedUrl, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
        resolvedUrl = head.url || resolvedUrl;
      } catch {
        // Ignore HEAD failures; we'll continue with the original URL.
      } finally {
        clearTimeout(timeout);
      }
    }

    const asin = amazonService.extractAsinFromUrl(resolvedUrl);
    if (asin) {
      const data = await amazonService.enrichItemWithAmazon(asin);
      if (!data) {
        return res.status(404).json({ error: 'Amazon item not found' });
      }
      return res.json({
        success: true,
        source: 'amazon',
        data: {
          name: data.ItemName,
          productUrl: data.AmazonURL || resolvedUrl,
          imageUrl: data.ImageURL,
          unitPrice: parsePrice(data.Price) ?? (typeof data.UnitPrice === 'number' ? data.UnitPrice : undefined),
          unitCount: typeof data.UnitCount === 'number' ? data.UnitCount : undefined,
          upc: data.UPC,
        },
      });
    }

    // Generic product-page enrichment (best-effort via metadata / JSON-LD)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(resolvedUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'OrderPulse/1.0 (+https://arda.cards)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }).finally(() => clearTimeout(timeout));

    const finalUrl = response.url || resolvedUrl;
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      return res.status(502).json({ error: `Failed to fetch URL (HTTP ${response.status})` });
    }
    if (!contentType.toLowerCase().includes('text/html')) {
      // Still return canonical URL; caller may use it as a validated link.
      return res.json({ success: true, source: 'generic', data: { productUrl: finalUrl } });
    }

    const html = (await response.text()).slice(0, 2_000_000);

    const jsonLd = pickProductFromJsonLd(html);
    const ogTitle = getMetaContent(html, { property: 'og:title' });
    const ogImage = getMetaContent(html, { property: 'og:image' });
    const metaPrice = getMetaContent(html, { property: 'product:price:amount' }) || getMetaContent(html, { name: 'price' });

    const name = jsonLd.name || ogTitle;
    const imageUrl = jsonLd.imageUrl || ogImage;
    const unitPrice = jsonLd.unitPrice ?? parsePrice(metaPrice);
    const unitCount = jsonLd.unitCount ?? extractUnitCountFromName(name);

    return res.json({
      success: true,
      source: 'generic',
      data: {
        name,
        productUrl: finalUrl,
        imageUrl,
        unitPrice,
        unitCount,
        currency: jsonLd.currency,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enrich URL';
    return res.status(500).json({ error: message });
  }
});

export { router as productRouter };

