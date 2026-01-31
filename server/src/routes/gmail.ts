import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { getValidAccessToken } from './auth.js';

const router = Router();

// Middleware to require authentication
async function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Fetch Gmail messages
router.get('/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const accessToken = await getValidAccessToken(req.session.userId!);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Calculate 6 months ago for date filter
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const afterDate = sixMonthsAgo.toISOString().split('T')[0].replace(/-/g, '/');

    // Search parameters - expanded query to catch more order-related emails
    const baseQuery = req.query.q as string || 'subject:(order OR invoice OR receipt OR confirmation OR shipment OR shipping OR purchase OR payment OR transaction)';
    const query = `${baseQuery} after:${afterDate}`;
    const maxResults = parseInt(req.query.maxResults as string) || 500; // Increased default

    console.log(`📧 Searching Gmail with query: "${query}" (max: ${maxResults})`);

    // List messages matching query
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];
    console.log(`📬 Found ${messages.length} messages matching query`);


    // Fetch full message details
    const fullMessages = await Promise.all(
      messages.map(async (msg) => {
        const fullMsg = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });
        
        const headers = fullMsg.data.payload?.headers || [];
        const getHeader = (name: string) => 
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract body
        let body = '';
        const parts = fullMsg.data.payload?.parts || [];
        
        if (fullMsg.data.payload?.body?.data) {
          body = Buffer.from(fullMsg.data.payload.body.data, 'base64').toString('utf-8');
        } else {
          for (const part of parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
              break;
            } else if (part.mimeType === 'text/html' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }

        return {
          id: msg.id,
          subject: getHeader('Subject'),
          sender: getHeader('From'),
          date: getHeader('Date'),
          snippet: fullMsg.data.snippet || '',
          body,
        };
      })
    );

    res.json({ 
      messages: fullMessages,
      total: listResponse.data.resultSizeEstimate || messages.length,
    });
  } catch (error: any) {
    console.error('Gmail fetch error:', error);
    
    if (error.code === 401) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }
    
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

// Send email
router.post('/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, body' });
    }

    const accessToken = await getValidAccessToken(req.session.userId!);
    
    if (!accessToken) {
      return res.status(401).json({ error: 'Token expired, please re-authenticate' });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Create email
    const emailLines = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      body,
    ];
    const email = emailLines.join('\r\n');
    const encodedEmail = Buffer.from(email).toString('base64url');

    // Send email
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
      },
    });

    res.json({ success: true, messageId: result.data.id });
  } catch (error: any) {
    console.error('Gmail send error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

export { router as gmailRouter };
