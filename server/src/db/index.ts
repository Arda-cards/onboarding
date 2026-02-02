import pg, { QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL?.trim();
const hasDatabase = Boolean(databaseUrl && databaseUrl.length > 0);

// Only create a pool if we have a DATABASE_URL - avoids connection hangs
export const pool = hasDatabase
  ? new Pool({
      connectionString: databaseUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      // Fast timeouts for local dev - don't hang forever
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10,
    })
  : (null as unknown as pg.Pool); // null pool when no DB configured

// Track if DB is actually usable
let dbConnected: boolean | null = null;

export function isDatabaseConfigured(): boolean {
  return hasDatabase;
}

export function isDatabaseConnected(): boolean {
  return dbConnected === true;
}

// Test connection on startup (only if configured)
if (hasDatabase && pool) {
  pool
    .query('SELECT 1')
    .then(() => {
      dbConnected = true;
      console.log('✅ Database connected');
    })
    .catch((err) => {
      dbConnected = false;
      console.warn('⚠️ Database connection failed:', err.message);
    });
} else {
  dbConnected = false;
  console.log('ℹ️ DATABASE_URL not set - using in-memory storage');
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (duration > 100) {
    console.log('Slow query:', { text: text.substring(0, 100), duration, rows: result.rowCount });
  }
  return result;
}
