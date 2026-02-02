import './utils/loadEnv.js';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import RedisStore from 'connect-redis';
import * as Sentry from '@sentry/node';
import compression from 'compression';
import redisClient from './utils/redisClient.js';
import { authRouter } from './routes/auth.js';
import { gmailRouter } from './routes/gmail.js';
import { analysisRouter } from './routes/analysis.js';
import { ordersRouter } from './routes/orders.js';
import { jobsRouter } from './routes/jobs.js';
import { discoverRouter } from './routes/discover.js';
import { amazonRouter } from './routes/amazon.js';
import ardaRouter from './routes/arda.js';
import cognitoRouter from './routes/cognito.js';
import scanRouter from './routes/scan.js';
import photoRouter from './routes/photo.js';
import { cognitoService } from './services/cognito.js';
import { initializeJobManager } from './services/jobManager.js';
import { startCognitoSyncScheduler } from './services/cognitoScheduler.js';
import { appLogger, requestLogger } from './middleware/requestLogger.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { defaultLimiter, authLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { corsOrigin, env, isProduction, port } from './config.js';

// Debug: Log OAuth config status
console.log('🔐 OAuth Config:', {
  clientId: process.env.GOOGLE_CLIENT_ID ? `${process.env.GOOGLE_CLIENT_ID.substring(0, 20)}...` : '❌ MISSING',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '❌ MISSING',
  geminiKey: process.env.GEMINI_API_KEY ? '✓ Set' : '❌ MISSING',
  ardaTenant: process.env.ARDA_TENANT_ID ? '✓ Set' : '❌ MISSING',
});

const app = express();
const sentryDsn = process.env.SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
  });
}
const PORT = port;
const requiredSecrets = [
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GEMINI_API_KEY',
  'ARDA_TENANT_ID',
];
for (const key of requiredSecrets) {
  if (!process.env[key]) {
    const message = `${key} is recommended to run OrderPulse`;
    if (isProduction) {
      throw new Error(`${key} is required in production`);
    }
    console.warn(`⚠️ ${message}`);
  }
}
if (isProduction && !process.env.REDIS_URL) {
  console.warn('⚠️ REDIS_URL not set in production - sessions will not persist across restarts');
}

// Trust proxy for Railway (required for secure cookies behind reverse proxy)
if (isProduction) {
  app.set('trust proxy', 1);
}

const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
// @ts-ignore - connect-redis type issues
const sessionStore = redisClient ? new RedisStore({ client: redisClient }) : undefined;

// Core middleware
app.use(requestLogger);
app.use(securityHeaders);
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(compression());
// Increase body parser limit for large email payloads (500 emails can be ~10MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Session configuration
app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: isProduction ? 'none' : 'lax',
  },
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes (rate-limited where appropriate)
app.use('/auth', authLimiter, authRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/analyze', analysisRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/arda', ardaRouter);
app.use('/api/jobs', defaultLimiter, jobsRouter);
app.use('/api/cognito', cognitoRouter);
app.use('/api/discover', defaultLimiter, discoverRouter);
app.use('/api/amazon', amazonRouter);
app.use('/api/scan', scanRouter);
app.use('/api/barcode', scanRouter); // Also mount at /api/barcode for lookup endpoint
app.use('/api/photo', photoRouter);

// Error handler
app.use(errorHandler);

async function startServer() {
  await initializeJobManager();

  app.listen(PORT, () => {
    appLogger.info(`🚀 OrderPulse API running on http://localhost:${PORT}`);
    appLogger.info(`📧 Frontend URL: ${process.env.FRONTEND_URL}`);
    
    startCognitoSyncScheduler();
    
    const status = cognitoService.getSyncStatus();
    appLogger.info(`👥 Cognito users: ${status.userCount} loaded`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start OrderPulse API:', error);
  process.exit(1);
});

export default app;
