import { RawEmail, GoogleUserProfile } from '../types';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const USER_INFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v1/userinfo';

export const validateToken = async (accessToken: string): Promise<boolean> => {
  try {
    const res = await fetch(`${USER_INFO_ENDPOINT}?alt=json`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch {
    return false;
  }
};

export const fetchUserProfile = async (accessToken: string): Promise<GoogleUserProfile | null> => {
  try {
    const res = await fetch(`${USER_INFO_ENDPOINT}?alt=json`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.error("Failed to fetch user profile", e);
    return null;
  }
};

export const sendGmailEmail = async (
  accessToken: string, 
  to: string, 
  subject: string, 
  body: string,
  cc?: string,
  bcc?: string
): Promise<boolean> => {
  // Gmail API requires a base64url encoded RFC 2822 message
  const emailLines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    body
  ].filter(line => line !== null);
  
  const emailContent = emailLines.join('\r\n');
  const encodedEmail = btoa(unescape(encodeURIComponent(emailContent)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const res = await fetch(`${GMAIL_API_BASE}/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: encodedEmail
      })
    });
    
    return res.ok;
  } catch (error) {
    console.error("Failed to send email", error);
    return false;
  }
};

const decodeBase64 = (data: string) => {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(base64);
  } catch (e) {
    console.error("Failed to decode base64", e);
    return "";
  }
};

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  payload: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

const parseGmailResponse = (message: GmailMessage): RawEmail => {
  const headers = message.payload.headers || [];
  const getHeader = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  
  const subject = getHeader('Subject') || '(No Subject)';
  const sender = getHeader('From') || 'Unknown Sender';
  const date = getHeader('Date') || new Date().toISOString(); 
  
  let body = '';
  
  const findBody = (parts: GmailPart[]): string => {
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data);
      }
      if (part.parts) {
        const found = findBody(part.parts);
        if (found) return found;
      }
    }
    return '';
  };

  if (message.payload.body?.data) {
    body = decodeBase64(message.payload.body.data);
  } else if (message.payload.parts) {
    body = findBody(message.payload.parts);
  } else {
    body = message.snippet || "";
  }

  return {
    id: message.id,
    subject,
    sender,
    date,
    snippet: message.snippet || "",
    body
  };
};

export const fetchGmailMessages = async (accessToken: string, query: string = 'subject:(order OR invoice OR receipt)'): Promise<RawEmail[]> => {
  const listRes = await fetch(`${GMAIL_API_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=10`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!listRes.ok) throw new Error('Failed to list messages');
  
  const listData = await listRes.json();
  const messages = listData.messages || [];
  
  const detailPromises = messages.map(async (msg: { id: string }) => {
    try {
      const detailRes = await fetch(`${GMAIL_API_BASE}/messages/${msg.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const detail = await detailRes.json();
      return parseGmailResponse(detail);
    } catch (e) {
      console.error(`Failed to fetch message ${msg.id}`, e);
      return null;
    }
  });
  
  const rawEmails = await Promise.all(detailPromises);
  return rawEmails.filter((e): e is RawEmail => e !== null);
};
