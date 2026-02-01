import helmet from 'helmet';

export const securityHeaders = helmet({
  contentSecurityPolicy: false, // disable strict CSP to avoid blocking inline styles in email processing; consider tightening later
  crossOriginEmbedderPolicy: false,
});
