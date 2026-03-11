// Jobs API - Background email processing
import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getValidAccessToken } from './auth.js';
import { 
  jobManager,
  Job,
  ProcessedOrder,
} from '../services/jobManager.js';
import { 
  extractAsinsFromEmail, 
  getAmazonItemDetails 
} from '../services/amazon.js';
import {
  consolidateOrders,
  detectEmailType,
  extractOrderNumber,
  normalizeItemName,
  logConsolidationSummary,
  RawOrderData,
} from '../utils/orderConsolidation.js';
import {
  buildSupplierJobQuery,
  expandPrioritySupplierDomains,
  getSupplierLookbackMonths,
  sanitizeSupplierDomains,
} from './jobsQueryUtils.js';
import {
  buildFinalOrderSnapshot,
  buildLiveOrderSnapshot,
} from './jobsProcessingUtils.js';
import {
  analyzeEmailWithRetry as analyzeEmailWithRetryShared,
  createGeminiExtractionModel,
  normalizeOrderDate as normalizeExtractionOrderDate,
} from '../services/emailExtraction.js';
import {
  extractImageUrlsFromHtml,
  extractUrlsFromHtml,
  extractUrlsFromText,
  isJunkUrl,
  pickBestImageUrlForItem,
  pickBestProductUrlForItem,
  uniqueStrings,
} from '../utils/urlExtraction.js';

const router = Router();

// Rate limiters - more permissive to allow page refreshes
const jobsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15, // Allow more requests for page refreshes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many job requests. Please wait a moment and try again.' },
  keyGenerator: (req: Request) => req.session?.userId || req.ip || 'anonymous',
});

const amazonLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15, // Allow more requests for retries and refreshes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Amazon processing requests. Please wait a moment and try again.' },
  keyGenerator: (req: Request) => req.session?.userId || req.ip || 'anonymous',
});

// Extract text from PDF attachments
async function extractPdfText(gmail: any, messageId: string, attachmentId: string): Promise<string> {
  try {
    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId,
    });
    
    if (!attachment.data.data) {
      return '';
    }
    
    const buffer = Buffer.from(attachment.data.data, 'base64');
    
    // Dynamic import to handle ESM/CJS compatibility
    const pdfParseModule = await import('pdf-parse') as any;
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  } catch (error) {
    console.error(`Failed to extract PDF text from attachment ${attachmentId}:`, error);
    return '';
  }
}

// Extract attachment info from email parts recursively
function findAttachments(parts: any[], attachments: Array<{ filename: string; attachmentId: string; mimeType: string }> = []): Array<{ filename: string; attachmentId: string; mimeType: string }> {
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        attachmentId: part.body.attachmentId,
        mimeType: part.mimeType || '',
      });
    }
    if (part.parts) {
      findAttachments(part.parts, attachments);
    }
  }
  return attachments;
}

// Initialize Gemini AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Prompt for humanizing Amazon product names into shop-floor friendly names
const NAME_HUMANIZATION_PROMPT = `You are a product naming assistant for a manufacturing shop floor. 
Convert verbose Amazon product names into short, practical names that workers would use.

RULES:
1. Keep the brand name if it's a recognized brand (DeWalt, Anker, 3M, etc.)
2. Keep the most important product descriptor (cable, drill, tape, etc.)
3. Keep critical specs like size/length if relevant (10ft, 1/4", 20V, etc.)
4. Remove marketing language, model numbers, compatibility lists, and color unless essential
5. Maximum 40 characters
6. Use Title Case

Examples:
- "Anker USB C Cable, PowerLine III USB A to USB C Charger Cable (10 ft), Premium Nylon USB A to USB Type C Cable for Samsung Galaxy S21, S10, Note 10, LG V20 G7 G6 and More" → "Anker USB-C Cable 10ft"
- "DEWALT 20V MAX XR Impact Driver Kit, Brushless, 1/4-Inch, 3-Speed (DCF887D2)" → "DeWalt 20V Impact Driver"
- "3M 2090 ScotchBlue Original Multi-Surface Painter's Tape, 1.88 inches x 60 yards, 2090, 1 Roll" → "3M Blue Painter's Tape 2in"
- "Amazon Basics AA 1.5 Volt Performance Alkaline Batteries - Pack of 48" → "Amazon Basics AA Batteries 48pk"

Return ONLY the shortened name, nothing else.

Product name to simplify:
`;

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Simple fallback name shortening without AI
function shortenNameFallback(name: string): string {
  if (!name || name.length <= 40) return name;
  
  // Try to get meaningful first part
  let shortened = name.split(',')[0].trim();
  
  // If still too long, try splitting by common separators
  if (shortened.length > 40) {
    shortened = name.split(' - ')[0].trim();
  }
  if (shortened.length > 40) {
    shortened = name.split('|')[0].trim();
  }
  
  // Final truncation if needed
  if (shortened.length > 40) {
    shortened = shortened.substring(0, 37) + '...';
  }
  
  return shortened;
}

// Humanize a batch of product names using Gemini
async function humanizeProductNames(
  names: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  if (names.length === 0) {
    return results;
  }
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  
  // Track if we hit rate limit - stop trying if so
  let rateLimitHit = false;
  let successCount = 0;
  
  // Process in batches of 5 to be more conservative with rate limits
  const batchSize = 5;
  
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    
    // Process each name in the batch
    for (const name of batch) {
      // Skip if already short enough or empty
      if (!name || name.length <= 40) {
        results.set(name, name);
        continue;
      }
      
      // If we hit rate limit, use fallback for all remaining
      if (rateLimitHit) {
        results.set(name, shortenNameFallback(name));
        continue;
      }
      
      try {
        const result = await model.generateContent(NAME_HUMANIZATION_PROMPT + name);
        const response = result.response;
        const humanized = response.text().trim();
        
        // Validate the response - should be short and not contain weird characters
        if (humanized && humanized.length <= 50 && !humanized.includes('\n')) {
          results.set(name, humanized);
          successCount++;
          console.log(`  📝 "${name.substring(0, 40)}..." → "${humanized}"`);
        } else {
          // Fallback: truncate and clean up
          results.set(name, shortenNameFallback(name));
        }
      } catch (error: any) {
        // Check if it's a rate limit error
        if (error?.status === 429 || error?.message?.includes('429') || error?.message?.includes('quota')) {
          console.warn(`⚠️ Gemini rate limit hit after ${successCount} names - using fallback for remaining ${names.length - i} items`);
          rateLimitHit = true;
          results.set(name, shortenNameFallback(name));
        } else {
          console.error(`Failed to humanize "${name.substring(0, 30)}...":`, error?.message || error);
          results.set(name, shortenNameFallback(name));
        }
      }
      
      // Delay between requests to avoid rate limits
      await delay(200);
    }
    
    // Longer delay between batches
    if (i + batchSize < names.length && !rateLimitHit) {
      await delay(1000);
    }
  }
  
  console.log(`📝 Humanized ${successCount}/${names.length} names with AI, ${names.length - successCount} used fallback`);
  
  return results;
}

// Recursively extract text from email parts
function extractBodiesFromParts(parts: any[] | undefined): { html: string; plain: string } {
  let html = '';
  let plain = '';

  if (!parts) return { html, plain };

  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
      if (decoded.length > plain.length) {
        plain = decoded;
      }
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
      if (decoded.length > html.length) {
        html = decoded;
      }
    } else if (part.parts) {
      const nested = extractBodiesFromParts(part.parts);
      if (nested.plain.length > plain.length) {
        plain = nested.plain;
      }
      if (nested.html.length > html.length) {
        html = nested.html;
      }
    }
  }

  return { html, plain };
}

function _extractTextFromParts(parts: any[]): string {
  let text = '';
  
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      const decoded = Buffer.from(part.body.data, 'base64').toString('utf-8');
      if (decoded.length > text.length) {
        text = decoded;
      }
    } else if (part.mimeType === 'text/html' && part.body?.data && text.length === 0) {
      // Only use HTML if we don't have plain text
      text = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.parts) {
      // Recursively check nested parts
      const nestedText = _extractTextFromParts(part.parts);
      if (nestedText.length > text.length) {
        text = nestedText;
      }
    }
  }
  
  return text;
}

// Run the actual processing in the background
async function processEmailsInBackground(
  jobId: string,
  userId: string,
  accessToken: string,
  supplierDomains: string[],
  jobType: string,
) {
  const job = jobManager.getJob(jobId);
  if (!job) return;

  try {
    // Update job status
    jobManager.updateJob(jobId, { status: 'running' });
    jobManager.addJobLog(jobId, '📧 Fetching emails from Gmail...');
    jobManager.updateJobProgress(jobId, { currentTask: 'Fetching emails...' });

    // Fetch Gmail messages
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build query - ONLY for selected suppliers, EXCLUDING Amazon (handled separately)
    // Remove any Amazon domains from the list since Amazon is processed separately
    const nonAmazonDomains = supplierDomains.filter(d =>
      !d.toLowerCase().includes('amazon')
    );
    
    if (nonAmazonDomains.length === 0) {
      jobManager.addJobLog(jobId, '⚠️ No non-Amazon suppliers selected');
      jobManager.updateJob(jobId, { status: 'completed' });
      return;
    }

    const lookbackMonths = getSupplierLookbackMonths(jobType);
    const strictQuery = buildSupplierJobQuery({
      supplierDomains: nonAmazonDomains,
      jobType,
      mode: 'strict',
    });

    jobManager.addJobLog(
      jobId,
      `🔍 Processing ${nonAmazonDomains.length} suppliers: ${nonAmazonDomains.slice(0, 5).join(', ')}${nonAmazonDomains.length > 5 ? '...' : ''}`,
    );
    jobManager.addJobLog(jobId, `🧭 Query mode=strict, lookback=${lookbackMonths} months`);

    let queryMode: 'strict' | 'fallback' = 'strict';
    let messageIds: Array<{ id?: string | null }> = [];

    const strictResponse = await gmail.users.messages.list({
      userId: 'me',
      q: strictQuery,
      maxResults: 200,
    });
    messageIds = strictResponse.data.messages || [];
    jobManager.addJobLog(jobId, `📬 Strict query found ${messageIds.length} matching emails`);

    if (jobType === 'priority' && messageIds.length === 0) {
      const fallbackQuery = buildSupplierJobQuery({
        supplierDomains: nonAmazonDomains,
        jobType,
        mode: 'fallback',
      });
      queryMode = 'fallback';
      jobManager.addJobLog(jobId, '🔁 Strict query returned 0, retrying fallback query without subject filter');

      const fallbackResponse = await gmail.users.messages.list({
        userId: 'me',
        q: fallbackQuery,
        maxResults: 200,
      });
      messageIds = fallbackResponse.data.messages || [];
      jobManager.addJobLog(jobId, `📬 Fallback query found ${messageIds.length} matching emails`);
    }

    jobManager.addJobLog(jobId, `🧪 Effective query mode: ${queryMode}`);

    if (messageIds.length === 0) {
      jobManager.addJobLog(jobId, `⚠️ No order-related emails found in the last ${lookbackMonths} months`);
      jobManager.updateJob(jobId, { status: 'completed' });
      return;
    }

    // STEP 1: Fetch headers for ALL emails to sort by vendor
    jobManager.updateJobProgress(jobId, { 
      total: messageIds.length,
      currentTask: 'Fetching email headers to group by vendor...' 
    });
    
    interface EmailInfo {
      id: string;
      subject: string;
      sender: string;
      vendorDomain: string;
      date: string;
    }
    
    const emailInfos: EmailInfo[] = [];
    
    for (let i = 0; i < messageIds.length; i++) {
      const msg = messageIds[i];
      try {
        const metaMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        
        const headers = metaMsg.data.payload?.headers || [];
        const sender = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        
        // Extract domain from sender
        const domainMatch = sender.match(/@([a-zA-Z0-9.-]+)/);
        const vendorDomain = domainMatch ? domainMatch[1].toLowerCase() : 'unknown';
        
        emailInfos.push({ id: msg.id!, subject, sender, vendorDomain, date });
      } catch (error) {
        console.error(`Error fetching metadata for ${msg.id}:`, error);
      }
      
      if (i % 20 === 0) {
        jobManager.updateJobProgress(jobId, { 
          processed: i,
          currentTask: `Indexing emails ${i}/${messageIds.length}...` 
        });
      }
    }
    
    // STEP 2: Group and sort by vendor domain
    const emailsByVendor = new Map<string, EmailInfo[]>();
    for (const email of emailInfos) {
      const existing = emailsByVendor.get(email.vendorDomain) || [];
      existing.push(email);
      emailsByVendor.set(email.vendorDomain, existing);
    }
    
    // Sort vendors by email count (most emails first) and create ordered list
    const sortedVendors = Array.from(emailsByVendor.entries())
      .sort((a, b) => b[1].length - a[1].length);
    
    jobManager.addJobLog(jobId, `📊 Grouped into ${sortedVendors.length} vendors`);
    for (const [vendor, emails] of sortedVendors.slice(0, 5)) {
      jobManager.addJobLog(jobId, `   • ${vendor}: ${emails.length} emails`);
    }

    // Initialize Gemini model upfront
    const model = createGeminiExtractionModel();

    // STEP 3: Process vendor by vendor and collect raw orders for consolidation
    let totalProcessed = 0;
    const rawOrders: RawOrderData[] = []; // Collect for consolidation
    
    for (const [vendorDomain, vendorEmails] of sortedVendors) {
      const vendorName = vendorDomain.split('.')[0].charAt(0).toUpperCase() + vendorDomain.split('.')[0].slice(1);
      jobManager.addJobLog(jobId, `\n🏢 Processing ${vendorName} (${vendorEmails.length} emails)...`);
      
      for (const emailInfo of vendorEmails) {
        try {
          // Fetch full email content
          const fullMsg = await gmail.users.messages.get({
            userId: 'me',
            id: emailInfo.id,
            format: 'full',
          });
          
          const headers = fullMsg.data.payload?.headers || [];
          const getHeader = (name: string) => 
            headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

          let body = '';
          let htmlBody = '';
          let plainBody = '';
          const parts = fullMsg.data.payload?.parts || [];
          
          if (fullMsg.data.payload?.body?.data) {
            const decoded = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
            // Gmail sometimes inlines either HTML or plain text at the top level.
            if (decoded.includes('<html') || decoded.includes('<div') || decoded.includes('<table') || decoded.includes('<body')) {
              htmlBody = decoded;
            } else {
              plainBody = decoded;
            }
          } else if (parts.length > 0) {
            const extracted = extractBodiesFromParts(parts);
            htmlBody = extracted.html;
            plainBody = extracted.plain;
          }

          body = plainBody || htmlBody;
          
          if (!body || body.length < 20) {
            const snippet = fullMsg.data.snippet || '';
            body = snippet;
          }

          // Extract text from PDF attachments (invoices, order confirmations)
          const attachments = findAttachments(parts);
          const pdfAttachments = attachments.filter(a => 
            a.mimeType === 'application/pdf' || a.filename.toLowerCase().endsWith('.pdf')
          );
          
          if (pdfAttachments.length > 0) {
            for (const pdfAttachment of pdfAttachments) {
              const pdfText = await extractPdfText(gmail, emailInfo.id, pdfAttachment.attachmentId);
              if (pdfText) {
                body += `\n\n--- PDF: ${pdfAttachment.filename} ---\n${pdfText.substring(0, 15000)}`;
              }
            }
          }

          const headerDate = getHeader('Date') || emailInfo.date || '';
          const candidateProductUrls = uniqueStrings([
            ...extractUrlsFromHtml(htmlBody),
            ...extractUrlsFromText(body),
          ])
            .filter(u => !isJunkUrl(u))
            .slice(0, 50);

          const candidateImageUrls = uniqueStrings([
            ...extractImageUrlsFromHtml(htmlBody),
          ])
            .filter(u => !isJunkUrl(u))
            .slice(0, 30);

          const email = {
            id: emailInfo.id,
            subject: getHeader('Subject'),
            sender: getHeader('From'),
            date: headerDate,
            body,
          };

          // Update current email being processed
          jobManager.setJobCurrentEmail(jobId, {
            id: email.id,
            subject: email.subject,
            sender: email.sender,
            snippet: email.body.substring(0, 100) + '...',
          });
          
          jobManager.updateJobProgress(jobId, {
            processed: totalProcessed,
            currentTask: `${vendorName}: ${emailInfo.subject.substring(0, 40)}...`,
          });

          // Analyze with AI
          const result = await analyzeEmailWithRetryShared(model as any, email);
          
          // Collect raw order data for consolidation (instead of adding immediately)
          if (result.isOrder && result.items?.length > 0) {
            const rawOrder: RawOrderData = {
              id: result.emailId || email.id,
              emailId: email.id,
              subject: email.subject,
              supplier: result.supplier || vendorName,
              orderNumber: extractOrderNumber(email.subject, email.body),
              orderDate: normalizeExtractionOrderDate(result.orderDate, email.date),
              totalAmount: result.totalAmount || 0,
              items: result.items.map((item: any, idx: number) => ({
                id: `${email.id}-${idx}`,
                name: item.name || 'Unknown Item',
                normalizedName: normalizeItemName(item.name || ''),
                quantity: item.quantity || 1,
                unit: item.unit || 'ea',
                unitPrice: item.unitPrice || 0,
                asin: item.asin,
                sku: item.partNumber || item.sku,
                productUrl: pickBestProductUrlForItem(
                  { vendorDomain, itemName: item.name || '', sku: item.partNumber || item.sku },
                  candidateProductUrls
                ),
                imageUrl: pickBestImageUrlForItem({ vendorDomain }, candidateImageUrls),
              })),
              confidence: result.confidence || 0.8,
            };
            
            rawOrders.push(rawOrder);

            if (jobType === 'priority') {
              const liveSnapshot = buildLiveOrderSnapshot(rawOrders);
              jobManager.replaceJobOrders(jobId, liveSnapshot.orders);
              jobManager.updateJobProgress(jobId, { success: liveSnapshot.success });
            }
            
            // Log email type for visibility
            const emailType = detectEmailType(email.subject);
            const typeEmoji = emailType === 'order' ? '📦' : emailType === 'shipped' ? '🚚' : emailType === 'delivered' ? '✅' : '📧';
            
            // Log each item found for real-time visibility
            for (const item of result.items.slice(0, 3)) {
              const price = item.unitPrice ? `$${item.unitPrice.toFixed(2)}` : '';
              const quantity = typeof item.quantity === 'number' ? item.quantity : 1;
              const qty = quantity > 1 ? `x${quantity}` : '';
              jobManager.addJobLog(jobId, `   ${typeEmoji} ${item.name?.substring(0, 50) || 'Item'} ${qty} ${price}`);
            }
            if (result.items.length > 3) {
              jobManager.addJobLog(jobId, `   ... and ${result.items.length - 3} more items`);
            }
          }

          // Small delay between requests to avoid rate limits
          await delay(100);
          
        } catch (error: any) {
          console.error(`Failed to process email ${emailInfo.id}:`, error);
          // Log rate limit errors specifically
          if (error.message?.includes('429') || error.message?.includes('quota')) {
            jobManager.addJobLog(jobId, `   ⚠️ Rate limited - waiting...`);
            await delay(2000);
          }
        } finally {
          totalProcessed++;
          jobManager.updateJobProgress(jobId, {
            processed: totalProcessed,
            success: rawOrders.length,
          });
        }
      }
      
      // Log vendor completion
      const currentJob = jobManager.getJob(jobId);
      const ordersFound = currentJob?.progress.success || 0;
      jobManager.addJobLog(jobId, `   ✓ ${vendorName} complete (${ordersFound} total orders)`);
    }

    // STEP 4: Consolidate orders (deduplicate and calculate lead times)
    jobManager.updateJobProgress(jobId, { 
      currentTask: 'Consolidating orders and calculating lead times...' 
    });
    jobManager.addJobLog(jobId, `\n📊 Consolidating ${rawOrders.length} raw orders...`);
    
    const consolidatedOrders = consolidateOrders(rawOrders);
    logConsolidationSummary(rawOrders.length, consolidatedOrders);
    
    // Log consolidation results
    const duplicatesRemoved = rawOrders.length - consolidatedOrders.length;
    if (duplicatesRemoved > 0) {
      jobManager.addJobLog(jobId, `   🔄 Removed ${duplicatesRemoved} duplicate/related emails`);
    }
    
    const ordersWithLeadTime = consolidatedOrders.filter(o => o.leadTimeDays !== undefined);
    if (ordersWithLeadTime.length > 0) {
      const avgLeadTime = ordersWithLeadTime.reduce((sum, o) => sum + (o.leadTimeDays || 0), 0) / ordersWithLeadTime.length;
      jobManager.addJobLog(jobId, `   ⏱️ ${ordersWithLeadTime.length} orders with lead time data (avg ${avgLeadTime.toFixed(1)} days)`);
    }
    
    const finalSnapshot = buildFinalOrderSnapshot(consolidatedOrders);
    jobManager.replaceJobOrders(jobId, finalSnapshot.orders);

    // Complete
    jobManager.updateJob(jobId, { status: 'completed' });
    jobManager.setJobCurrentEmail(jobId, null);
    jobManager.updateJobProgress(jobId, { 
      processed: totalProcessed,
      success: finalSnapshot.success,
      currentTask: '✅ Complete' 
    });
    jobManager.addJobLog(jobId, `🎉 Complete: ${consolidatedOrders.length} unique orders from ${totalProcessed} emails across ${sortedVendors.length} vendors`);

  } catch (error: any) {
    console.error('Background job error:', error);
    jobManager.updateJob(jobId, { 
      status: 'failed', 
      error: error.message || 'Unknown error' 
    });
    jobManager.addJobLog(jobId, `❌ Error: ${error.message}`);
  }
}

// Middleware to require authentication
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Start a new processing job
router.post('/start', jobsLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    const { supplierDomains, jobType } = req.body as { supplierDomains?: unknown; jobType?: string };
    // Create job with specified type (defaults to 'suppliers')
    // allowConcurrent=true ensures this job won't cancel other job types
    const effectiveJobType = typeof jobType === 'string' && jobType.length > 0 ? jobType : 'suppliers';
    const sanitizedDomains = sanitizeSupplierDomains(supplierDomains);
    if (supplierDomains && sanitizedDomains.length === 0) {
      return res.status(400).json({ error: 'supplierDomains must contain valid hostnames' });
    }

    const effectiveDomains = effectiveJobType === 'priority'
      ? expandPrioritySupplierDomains(sanitizedDomains)
      : sanitizedDomains;

    console.log(`📥 /start request: userId=${userId.substring(0, 8)}, jobType=${effectiveJobType}, domains=${effectiveDomains.length}`);
    const job = jobManager.createJob(userId, { jobType: effectiveJobType, allowConcurrent: true });
    
    if (effectiveDomains.length > 0) {
      jobManager.addJobLog(job.id, `🚀 Job created for ${effectiveDomains.length} selected suppliers: ${effectiveDomains.join(', ')}`);
    } else {
      jobManager.addJobLog(job.id, '🚀 Job created, processing all suppliers...');
    }

    // Start processing in background (don't await)
    processEmailsInBackground(job.id, userId, accessToken, effectiveDomains, effectiveJobType);

    // Return immediately with job ID
    res.status(202).json({ 
      jobId: job.id,
      status: 'started',
      message: effectiveDomains.length 
        ? `Processing ${effectiveDomains.length} suppliers in background`
        : 'Processing all suppliers in background'
    });
  } catch (error: any) {
    console.error('Failed to start job:', error);
    res.status(500).json({ error: 'Failed to start processing job' });
  }
});

// Amazon-first processing: immediately start processing Amazon emails
// This runs BEFORE supplier discovery and extracts ASINs + enriches via PA API
router.post('/start-amazon', amazonLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId!;
    const accessToken = await getValidAccessToken(userId);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    // Create job specifically for Amazon
    // allowConcurrent=true ensures this job won't cancel other job types
    console.log(`📥 /start-amazon request: userId=${userId.substring(0, 8)}`);
    const job = jobManager.createJob(userId, { jobType: 'amazon', allowConcurrent: true });
    jobManager.addJobLog(job.id, '🛒 Starting Amazon-first processing...');

    // Start Amazon processing in background
    processAmazonEmailsInBackground(job.id, userId, accessToken);

    res.status(202).json({ 
      jobId: job.id,
      status: 'started',
      message: 'Amazon processing started - ASIN extraction and enrichment'
    });
  } catch (error: any) {
    console.error('Failed to start Amazon job:', error);
    res.status(500).json({ error: 'Failed to start Amazon processing' });
  }
});

// Background processor specifically for Amazon emails with ASIN extraction
// NO AI - just extract ASINs and call Product Advertising API
async function processAmazonEmailsInBackground(
  jobId: string,
  userId: string,
  accessToken: string
) {
  const job = jobManager.getJob(jobId);
  if (!job) return;

  try {
    jobManager.updateJob(jobId, { status: 'running' });
    jobManager.addJobLog(jobId, '📧 Fetching Amazon order emails...');
    jobManager.updateJobProgress(jobId, { currentTask: 'Fetching Amazon emails...' });

    // Set up Gmail client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Calculate 6 months ago
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const afterDate = sixMonthsAgo.toISOString().split('T')[0].replace(/-/g, '/');

    // Amazon-specific query - look for order/shipment emails from Amazon
    const query = `from:amazon.com subject:(order OR shipment OR shipped OR delivery) after:${afterDate}`;
    
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50, // Limit for faster processing
    });

    const messageIds = listResponse.data.messages || [];
    jobManager.addJobLog(jobId, `📬 Found ${messageIds.length} Amazon emails`);
    
    if (messageIds.length === 0) {
      jobManager.addJobLog(jobId, '⚠️ No Amazon order emails found');
      jobManager.updateJob(jobId, { status: 'completed' });
      return;
    }

    // Progress phases: 50% for email scanning, 50% for API enrichment
    // We use total = messageIds.length * 2 to account for both phases
    const emailCount = messageIds.length;
    jobManager.updateJobProgress(jobId, { 
      total: emailCount * 2, // Double for two-phase progress
      processed: 0,
      currentTask: 'Extracting ASINs from Amazon emails...' 
    });

    // Each email with ASINs becomes a raw order for consolidation
    // Structure: { emailId, subject, date, items[] }
    interface EmailOrder {
      emailId: string;
      subject: string;
      date: string;
      orderNumber?: string;
      items: { asin: string; quantity: number }[];
    }
    const emailOrders: EmailOrder[] = [];
    const allAsins: Set<string> = new Set();

    for (let i = 0; i < messageIds.length; i++) {
      const msg = messageIds[i];
      
      try {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });

        const headers = fullMsg.data.payload?.headers || [];
        const getHeader = (name: string) => 
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
        
        const subject = getHeader('subject');
        const date = getHeader('date');
        
        // Get email body - prefer HTML as Amazon ASINs are typically in href links
        let body = '';
        const payload = fullMsg.data.payload;
        
        // Recursive function to extract body from nested parts
        function extractBody(parts: any[] | undefined): { html: string; plain: string } {
          let html = '';
          let plain = '';
          
          if (!parts) return { html, plain };
          
          for (const part of parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
              html += Buffer.from(part.body.data, 'base64').toString('utf-8');
            } else if (part.mimeType === 'text/plain' && part.body?.data) {
              plain += Buffer.from(part.body.data, 'base64').toString('utf-8');
            } else if (part.parts) {
              // Recursively extract from nested parts
              const nested = extractBody(part.parts);
              html += nested.html;
              plain += nested.plain;
            }
          }
          
          return { html, plain };
        }
        
        if (payload?.body?.data) {
          body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        } else if (payload?.parts) {
          const extracted = extractBody(payload.parts);
          // Prefer HTML as it contains the actual product links with ASINs
          body = extracted.html || extracted.plain;
        }
        
        // Log sample of email for debugging
        if (body.length > 0) {
          const hasAsinInUrl = body.includes('/dp/') || body.includes('/gp/product/');
          const hasB0 = /B0[A-Z0-9]{8}/i.test(body);
          console.log(`📧 Email "${subject.substring(0, 40)}...": ${body.length} chars, hasAsinUrl=${hasAsinInUrl}, hasB0=${hasB0}`);
        }

        // Extract ASINs from this email
        const asins = extractAsinsFromEmail(body, subject);
        
        if (asins.length > 0) {
          // Try to extract quantities (best-effort)
          const qtyMatches = Array.from(body.matchAll(/(?:qty|quantity)\s*[:x]?\s*(\d+)/gi))
            .map(match => parseInt(match[1], 10))
            .filter(qty => !isNaN(qty) && qty > 0);
          
          // If we have the same number of quantities as ASINs, map them by position
          const quantities = qtyMatches.length === asins.length ? qtyMatches : [];
          const items = asins.map((asin, index) => ({
            asin,
            quantity: quantities[index] || 1,
          }));
          
          // Extract order number for consolidation
          const orderNumber = extractOrderNumber(subject, body);
          
          // Detect email type for logging
          const emailType = detectEmailType(subject);
          const typeEmoji = emailType === 'order' ? '📦' : emailType === 'shipped' ? '🚚' : emailType === 'delivered' ? '✅' : '📧';
          
          // Each email with ASINs = one raw order (will be consolidated later)
          emailOrders.push({
            emailId: msg.id!,
            subject,
            date,
            orderNumber,
            items,
          });
          items.forEach(item => allAsins.add(item.asin));
          jobManager.addJobLog(jobId, `${typeEmoji} Found ${items.length} items in: ${subject.substring(0, 50)}...`);
        }

        // Update progress (phase 1: email scanning = 0-50%)
        jobManager.updateJobProgress(jobId, {
          processed: i + 1,
          currentTask: `Scanning email ${i + 1}/${emailCount}... Found ${emailOrders.length} orders`
        });

      } catch (error) {
        console.error(`Error processing Amazon email ${msg.id}:`, error);
      }
    }

      jobManager.addJobLog(jobId, `🎯 Found ${emailOrders.length} emails with ${allAsins.size} unique items`);

    // Now enrich all unique ASINs with Amazon Product Advertising API (phase 2: 50-100%)
    if (allAsins.size > 0) {
      // Progress: 50% done with email scanning, starting API phase
      jobManager.updateJobProgress(jobId, {
        processed: emailCount, // 50% mark
        currentTask: `Calling Amazon Product Advertising API for ${allAsins.size} items...`
      });
      jobManager.addJobLog(jobId, '🛒 Calling Amazon Product Advertising API...');

      const asinArray = Array.from(allAsins);
      const enrichedData = await getAmazonItemDetails(asinArray.slice(0, 100)); // Limit to 100

      // Progress: 75% - API done
      jobManager.updateJobProgress(jobId, {
        processed: Math.floor(emailCount * 1.5), // 75% mark
        currentTask: `Got ${enrichedData.size} products, humanizing names...`
      });
      jobManager.addJobLog(jobId, `✅ Got ${enrichedData.size} products from Amazon API`);

      // Step 2: Humanize product names
      jobManager.addJobLog(jobId, '📝 Creating shop-floor friendly names...');
      
      const productNamesToHumanize = Array.from(enrichedData.values())
        .map(data => data.ItemName)
        .filter((name): name is string => !!name && name.length > 40);
      
      const humanizedNames = await humanizeProductNames(productNamesToHumanize);
      jobManager.addJobLog(jobId, `✅ Humanized ${humanizedNames.size} verbose product names`);
      
      // Progress: 90% - humanization done, building orders
      jobManager.updateJobProgress(jobId, {
        processed: Math.floor(emailCount * 1.8), // 90% mark
        currentTask: 'Building order data...'
      });

      // Build raw orders for consolidation
      const rawAmazonOrders: RawOrderData[] = [];
      
      for (const emailOrder of emailOrders) {
        const items: RawOrderData['items'] = [];
        
        for (const orderItem of emailOrder.items) {
          const data = enrichedData.get(orderItem.asin);
          const originalName = data?.ItemName;
          const humanizedName = originalName ? humanizedNames.get(originalName) : undefined;
          
          items.push({
            id: `amazon-item-${orderItem.asin}-${emailOrder.emailId}`,
            name: humanizedName || originalName || `Amazon Product ${orderItem.asin}`,
            normalizedName: normalizeItemName(humanizedName || originalName || orderItem.asin),
            quantity: orderItem.quantity || 1,
            unit: 'each',
            unitPrice: parseFloat(data?.Price?.replace(/[^0-9.]/g, '') || '0'),
            asin: orderItem.asin,
            productUrl: data?.AmazonURL,
            imageUrl: data?.ImageURL,
            amazonEnriched: data ? {
              asin: data.ASIN,
              itemName: data.ItemName,
              humanizedName: humanizedName || (originalName && originalName.length <= 40 ? originalName : undefined),
              price: data.Price,
              imageUrl: data.ImageURL,
              amazonUrl: data.AmazonURL,
              unitCount: data.UnitCount,
              unitPrice: data.UnitPrice,
              upc: data.UPC,
            } : undefined,
          });
        }

        // Parse email date
        let orderDate = new Date().toISOString().split('T')[0];
        try {
          const parsed = new Date(emailOrder.date);
          if (!isNaN(parsed.getTime())) {
            orderDate = parsed.toISOString().split('T')[0];
          }
        } catch {
          // Keep default date when parsing fails
        }

        // Create raw order for consolidation
        rawAmazonOrders.push({
          id: `amazon-${emailOrder.emailId}`,
          emailId: emailOrder.emailId,
          subject: emailOrder.subject,
          supplier: 'Amazon',
          orderNumber: emailOrder.orderNumber,
          orderDate,
          totalAmount: items.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.quantity || 1), 0),
          items,
          confidence: 1.0,
        });
      }
      
      // Consolidate Amazon orders (remove duplicates, track shipping/delivery)
      jobManager.addJobLog(jobId, `\n📊 Consolidating ${rawAmazonOrders.length} Amazon emails...`);
      const consolidatedAmazonOrders = consolidateOrders(rawAmazonOrders);
      logConsolidationSummary(rawAmazonOrders.length, consolidatedAmazonOrders);
      
      const duplicatesRemoved = rawAmazonOrders.length - consolidatedAmazonOrders.length;
      if (duplicatesRemoved > 0) {
        jobManager.addJobLog(jobId, `   🔄 Removed ${duplicatesRemoved} duplicate/shipping/delivery emails`);
      }
      
      const ordersWithLeadTime = consolidatedAmazonOrders.filter(o => o.leadTimeDays !== undefined);
      if (ordersWithLeadTime.length > 0) {
        const avgLeadTime = ordersWithLeadTime.reduce((sum, o) => sum + (o.leadTimeDays || 0), 0) / ordersWithLeadTime.length;
        jobManager.addJobLog(jobId, `   ⏱️ ${ordersWithLeadTime.length} orders with lead time data (avg ${avgLeadTime.toFixed(1)} days)`);
      }
      
      // Add consolidated orders to job
      let totalItems = 0;
      for (const consolidated of consolidatedAmazonOrders) {
        const order: ProcessedOrder = {
          id: consolidated.id,
          supplier: 'Amazon',
          orderDate: consolidated.orderDate,
          totalAmount: consolidated.totalAmount || 0,
          items: consolidated.items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice || 0,
            asin: item.asin,
            sku: item.sku,
            productUrl: item.productUrl,
            imageUrl: item.imageUrl,
            amazonEnriched: item.amazonEnriched,
          })),
          confidence: consolidated.confidence,
        };

        jobManager.addJobOrder(jobId, order);
        totalItems += consolidated.items.length;
        
        // Log order with lead time if available
        const leadTimeInfo = consolidated.leadTimeDays !== undefined ? ` (${consolidated.leadTimeDays}d lead time)` : '';
        jobManager.addJobLog(jobId, `📋 Order ${consolidated.orderDate}: ${consolidated.items.length} item${consolidated.items.length > 1 ? 's' : ''} - $${(consolidated.totalAmount || 0).toFixed(2)}${leadTimeInfo}`);
      }

      jobManager.updateJobProgress(jobId, { success: totalItems });
      jobManager.addJobLog(jobId, `🎉 Amazon complete: ${consolidatedAmazonOrders.length} unique orders, ${totalItems} items`);
    } else {
      jobManager.addJobLog(jobId, '⚠️ No ASINs found in Amazon emails');
    }

    jobManager.updateJob(jobId, { status: 'completed' });
    
  } catch (error: any) {
    console.error('Amazon processing error:', error);
    jobManager.addJobLog(jobId, `❌ Error: ${error.message}`);
    jobManager.updateJob(jobId, { status: 'failed', error: error.message });
  }
}

// Get job status (for polling)
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const jobId = req.query.jobId as string;
  
  let job: Job | undefined;
  
  if (jobId) {
    job = jobManager.getJob(jobId);
  } else {
    // Get latest job for user
    job = jobManager.getJobForUser(userId);
  }
  
  if (!job) {
    return res.json({ 
      hasJob: false,
      message: 'No active job found'
    });
  }

  res.json({
    hasJob: true,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    currentEmail: job.currentEmail,
    orders: job.orders,
    logs: job.logs.slice(0, 20), // Last 20 logs
    error: job.error,
  });
});

// Get full job results
router.get('/:jobId', requireAuth, async (req: Request, res: Response) => {
  const job = jobManager.getJob(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Verify job belongs to user
  if (job.userId !== req.session.userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json(job);
});

export { router as jobsRouter };
