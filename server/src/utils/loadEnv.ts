// Load environment variables from .env file in development
import { config } from 'dotenv';

// Only load .env in non-production (Railway sets env vars directly)
if (process.env.NODE_ENV !== 'production' && !process.env.RAILWAY_ENVIRONMENT) {
  config();
}
