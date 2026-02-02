import { pool, isDatabaseConfigured, isDatabaseConnected } from '../db/index.js'
import redisClient from '../utils/redisClient.js'
import { allowInMemoryStorage, isProduction } from '../config.js'

export interface StoredUser {
  id: string
  googleId: string
  email: string
  name: string
  picture: string
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

interface StoredUserRow {
  id: string
  google_id: string
  email: string
  name: string
  picture: string
  access_token: string
  refresh_token: string
  expires_at: string | Date
}

const CACHE_KEY = (id: string) => `auth:user:${id}`

// In-memory fallback for local dev / demos
const memoryUsers = new Map<string, StoredUser>()

// Track table setup state - only try once
let tableSetupPromise: Promise<boolean> | null = null
let tableReady = false

async function ensureUsersTable(): Promise<boolean> {
  // Already done
  if (tableReady) return true

  // Already in progress
  if (tableSetupPromise) return tableSetupPromise

  // No database configured
  if (!isDatabaseConfigured()) {
    return false
  }

  // Wait for initial connection check
  let attempts = 0
  while (!isDatabaseConnected() && attempts < 10) {
    await new Promise((r) => setTimeout(r, 100))
    attempts++
  }

  if (!isDatabaseConnected()) {
    console.warn('⚠️ Database not connected after waiting; using in-memory auth')
    return false
  }

  tableSetupPromise = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          google_id TEXT NOT NULL,
          email TEXT NOT NULL,
          name TEXT DEFAULT '' NOT NULL,
          picture TEXT DEFAULT '' NOT NULL,
          access_token TEXT DEFAULT '' NOT NULL,
          refresh_token TEXT DEFAULT '' NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
      `)
      tableReady = true
      console.log('✅ Users table ready')
      return true
    } catch (err: any) {
      console.warn('⚠️ Failed to create users table:', err?.message || String(err))
      return false
    }
  })()

  return tableSetupPromise
}

function useMemory(): boolean {
  // Fast path: no DB configured at all
  if (!isDatabaseConfigured()) {
    if (isProduction && !allowInMemoryStorage) {
      throw new Error('DATABASE_URL is required for auth in production (or set ALLOW_INMEMORY_STORAGE=true)')
    }
    return true
  }
  // If table setup failed
  if (tableSetupPromise !== null && !tableReady) {
    if (isProduction && !allowInMemoryStorage) {
      throw new Error('Database unavailable for auth in production')
    }
    return true
  }
  return false
}

async function cacheUser(user: StoredUser) {
  if (!redisClient) return
  try {
    await redisClient.set(CACHE_KEY(user.id), JSON.stringify(user), 'EX', 3600)
  } catch {
    // Redis cache failure is non-fatal
  }
}

export async function saveUser(user: StoredUser): Promise<void> {
  // Try to set up table if needed (fast no-op if already done)
  const dbReady = await ensureUsersTable()

  if (!dbReady || useMemory()) {
    memoryUsers.set(user.id, user)
    await cacheUser(user)
    return
  }

  await pool.query(
    `INSERT INTO users (id, google_id, email, name, picture, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (id) DO UPDATE SET
       google_id = EXCLUDED.google_id,
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       picture = EXCLUDED.picture,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
    `,
    [
      user.id,
      user.googleId,
      user.email,
      user.name,
      user.picture,
      user.accessToken,
      user.refreshToken,
      user.expiresAt,
    ]
  )
  await cacheUser(user)
}

export async function deleteUser(userId: string): Promise<void> {
  memoryUsers.delete(userId)
  if (redisClient) {
    try {
      await redisClient.del(CACHE_KEY(userId))
    } catch {
      // Ignore redis errors
    }
  }

  if (!tableReady || useMemory()) {
    return
  }

  try {
    await pool.query('DELETE FROM users WHERE id = $1', [userId])
  } catch {
    // Ignore DB errors on delete
  }
}

export async function getUserById(userId: string): Promise<StoredUser | null> {
  // Try Redis cache first
  if (redisClient) {
    try {
      const cached = await redisClient.get(CACHE_KEY(userId))
      if (cached) {
        const parsed = JSON.parse(cached) as StoredUser
        parsed.expiresAt = new Date(parsed.expiresAt)
        return parsed
      }
    } catch {
      // Redis failure - continue to other stores
    }
  }

  // Try memory store
  const memUser = memoryUsers.get(userId)
  if (memUser) {
    return memUser
  }

  // Try database if available
  if (!tableReady || useMemory()) {
    return null
  }

  try {
    const result = await pool.query<StoredUserRow>('SELECT * FROM users WHERE id = $1', [userId])
    if (result.rowCount === 0) return null

    const row = result.rows[0]
    const user: StoredUser = {
      id: row.id,
      googleId: row.google_id,
      email: row.email,
      name: row.name,
      picture: row.picture,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    }

    // Cache for next time
    memoryUsers.set(userId, user)
    await cacheUser(user)
    return user
  } catch {
    return null
  }
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const user = await getUserById(userId)
  return user?.email || null
}
