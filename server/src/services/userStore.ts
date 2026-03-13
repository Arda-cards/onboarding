import { pool } from '../db/index.js'
import redisClient from '../utils/redisClient.js'
import type { Pool, PoolClient } from 'pg'

export interface StoredUser {
  id: string
  googleId?: string | null
  googleEmail?: string | null
  email: string
  name: string
  picture: string
  accessToken: string
  refreshToken: string
  expiresAt: Date
  passwordHash?: string | null
}

interface StoredUserRow {
  id: string
  google_id: string | null
  google_email: string | null
  email: string
  name: string
  picture: string
  access_token: string
  refresh_token: string
  expires_at: string | Date
  password_hash: string | null
}

const CACHE_KEY = (id: string) => `auth:user:${id}`

// Ensure the users table exists (idempotent) so we have durable storage for auth users
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      google_id TEXT,
      google_email TEXT,
      email TEXT NOT NULL,
      name TEXT DEFAULT '' NOT NULL,
      picture TEXT DEFAULT '' NOT NULL,
      access_token TEXT DEFAULT '' NOT NULL,
      refresh_token TEXT DEFAULT '' NOT NULL,
      password_hash TEXT,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
    );
  `)

  // Backfill older installations where users table existed before google_email/token columns were added.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS access_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
  `)

  await pool.query(`
    UPDATE users
    SET name = COALESCE(name, ''),
        picture = COALESCE(picture, ''),
        access_token = COALESCE(access_token, ''),
        refresh_token = COALESCE(refresh_token, ''),
        created_at = COALESCE(created_at, now()),
        updated_at = COALESCE(updated_at, now()),
        expires_at = COALESCE(expires_at, now());
  `)

  await pool.query(`
    ALTER TABLE users ALTER COLUMN name SET DEFAULT '';
    ALTER TABLE users ALTER COLUMN picture SET DEFAULT '';
    ALTER TABLE users ALTER COLUMN access_token SET DEFAULT '';
    ALTER TABLE users ALTER COLUMN refresh_token SET DEFAULT '';
    ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT now();
  `)

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    CREATE INDEX IF NOT EXISTS idx_users_google_email ON users(google_email);
  `)
}

let ensureTablePromise: Promise<void> | null = null

async function ensureTableReady(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = ensureTable().catch((error) => {
      ensureTablePromise = null
      throw error
    })
  }
  return ensureTablePromise
}

// Kick table creation on module load, but do not crash process if DB is temporarily unavailable.
void ensureTableReady().catch((error) => {
  console.error('Failed to ensure auth users table on startup:', error)
})

async function cacheUser(user: StoredUser) {
  if (!redisClient) return
  await redisClient.set(CACHE_KEY(user.id), JSON.stringify(user))
}

function mapUser(row: StoredUserRow): StoredUser {
  return {
    id: row.id,
    googleId: row.google_id,
    googleEmail: row.google_email,
    email: row.email,
    name: row.name,
    picture: row.picture,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: new Date(row.expires_at),
    passwordHash: row.password_hash,
  }
}

export async function saveUser(user: StoredUser): Promise<void> {
  await ensureTableReady()
  await pool.query(
    `INSERT INTO users (id, google_id, google_email, email, name, picture, access_token, refresh_token, password_hash, expires_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (id) DO UPDATE SET
       google_id = EXCLUDED.google_id,
       google_email = EXCLUDED.google_email,
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       picture = EXCLUDED.picture,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       password_hash = EXCLUDED.password_hash,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
    `,
    [
      user.id,
      user.googleId ?? null,
      user.googleEmail ?? null,
      user.email,
      user.name,
      user.picture,
      user.accessToken,
      user.refreshToken,
      user.passwordHash ?? null,
      user.expiresAt,
    ]
  )
  await cacheUser(user)
}

export async function deleteUser(userId: string): Promise<void> {
  await ensureTableReady()
  await pool.query('DELETE FROM users WHERE id = $1', [userId])
  if (redisClient) {
    await redisClient.del(CACHE_KEY(userId))
  }
}

export async function getUserById(userId: string): Promise<StoredUser | null> {
  await ensureTableReady()
  // Redis cache first
  if (redisClient) {
    const cached = await redisClient.get(CACHE_KEY(userId))
    if (cached) {
      const parsed = JSON.parse(cached) as StoredUser
      parsed.expiresAt = new Date(parsed.expiresAt)
      return parsed
    }
  }

  const result = await pool.query<StoredUserRow>('SELECT * FROM users WHERE id = $1', [userId])
  if (result.rowCount === 0) return null

  const user = mapUser(result.rows[0])

  await cacheUser(user)
  return user
}

export async function getUserByEmail(email: string): Promise<StoredUser | null> {
  await ensureTableReady()
  const result = await pool.query<StoredUserRow>('SELECT * FROM users WHERE email = $1', [email])
  if (result.rowCount === 0) return null
  const user = mapUser(result.rows[0])
  await cacheUser(user)
  return user
}

export async function getUserByGoogleId(googleId: string): Promise<StoredUser | null> {
  await ensureTableReady()
  const result = await pool.query<StoredUserRow>('SELECT * FROM users WHERE google_id = $1', [googleId])
  if (result.rowCount === 0) return null
  const user = mapUser(result.rows[0])
  await cacheUser(user)
  return user
}

async function tableExists(tableName: string, client: Pool | PoolClient = pool): Promise<boolean> {
  const result = await client.query<{ name: string | null }>('SELECT to_regclass($1) as name', [tableName])
  return Boolean(result.rows[0]?.name)
}

export async function mergeUsers(sourceUserId: string, targetUserId: string): Promise<void> {
  if (sourceUserId === targetUserId) return
  await ensureTableReady()

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (await tableExists('orders', client)) {
      await client.query('UPDATE orders SET user_id = $1 WHERE user_id = $2', [targetUserId, sourceUserId])
    }

    if (await tableExists('provider_connections', client)) {
      await client.query(
        `DELETE FROM provider_connections
         WHERE user_id = $2
           AND provider IN (SELECT provider FROM provider_connections WHERE user_id = $1)`,
        [targetUserId, sourceUserId],
      )
      await client.query('UPDATE provider_connections SET user_id = $1 WHERE user_id = $2', [targetUserId, sourceUserId])
    }

    if (await tableExists('oauth_tokens', client)) {
      await client.query('UPDATE oauth_tokens SET user_id = $1 WHERE user_id = $2', [targetUserId, sourceUserId])
    }

    await client.query('DELETE FROM users WHERE id = $1', [sourceUserId])

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  if (redisClient) {
    await redisClient.del(CACHE_KEY(sourceUserId))
    await redisClient.del(CACHE_KEY(targetUserId))
  }
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const user = await getUserById(userId)
  return user?.email || null
}
