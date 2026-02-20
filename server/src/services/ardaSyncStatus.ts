import { randomUUID } from 'node:crypto';
import redisClient from '../utils/redisClient.js';

const REDIS_KEY_PREFIX = 'orderpulse:arda:sync-status:';
const REDIS_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const RECENT_EVENT_LIMIT = 25;

export type ArdaSyncOperation =
  | 'item_create'
  | 'item_bulk_create'
  | 'kanban_card_create'
  | 'order_create'
  | 'velocity_sync'
  | 'velocity_push'
  | 'velocity_item_sync';

export interface ArdaSyncEvent {
  id: string;
  operation: ArdaSyncOperation;
  success: boolean;
  requested: number;
  successful: number;
  failed: number;
  timestamp: string;
  error?: string;
  email?: string;
  tenantId?: string;
}

export interface ArdaSyncStatusSnapshot {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  totalRequested: number;
  totalSuccessful: number;
  totalFailed: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  recent: ArdaSyncEvent[];
  updatedAt: string;
}

interface RecordSyncEventInput {
  operation: ArdaSyncOperation;
  success: boolean;
  requested?: number;
  successful?: number;
  failed?: number;
  error?: string;
  email?: string;
  tenantId?: string | null;
}

const statusCache = new Map<string, ArdaSyncStatusSnapshot>();

function nowIso(): string {
  return new Date().toISOString();
}

function createEmptyStatus(): ArdaSyncStatusSnapshot {
  return {
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    totalRequested: 0,
    totalSuccessful: 0,
    totalFailed: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    recent: [],
    updatedAt: nowIso(),
  };
}

function normalizeUserKey(userKey: string): string {
  const trimmed = userKey.trim().toLowerCase();
  return trimmed || 'anonymous';
}

function redisKeyForUser(userKey: string): string {
  return `${REDIS_KEY_PREFIX}${encodeURIComponent(normalizeUserKey(userKey))}`;
}

function safeParseStatus(payload: string | null): ArdaSyncStatusSnapshot {
  if (!payload) {
    return createEmptyStatus();
  }

  try {
    const parsed = JSON.parse(payload) as Partial<ArdaSyncStatusSnapshot>;
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent
        .filter((value): value is ArdaSyncEvent => Boolean(value && typeof value === 'object'))
        .slice(0, RECENT_EVENT_LIMIT)
      : [];

    return {
      totalAttempts: Number(parsed.totalAttempts) || 0,
      successfulAttempts: Number(parsed.successfulAttempts) || 0,
      failedAttempts: Number(parsed.failedAttempts) || 0,
      totalRequested: Number(parsed.totalRequested) || 0,
      totalSuccessful: Number(parsed.totalSuccessful) || 0,
      totalFailed: Number(parsed.totalFailed) || 0,
      lastAttemptAt: parsed.lastAttemptAt || null,
      lastSuccessAt: parsed.lastSuccessAt || null,
      lastErrorAt: parsed.lastErrorAt || null,
      recent,
      updatedAt: parsed.updatedAt || nowIso(),
    };
  } catch {
    return createEmptyStatus();
  }
}

async function loadStatus(userKey: string): Promise<ArdaSyncStatusSnapshot> {
  const normalized = normalizeUserKey(userKey);
  const cached = statusCache.get(normalized);
  if (cached) {
    return cached;
  }

  if (!redisClient) {
    const empty = createEmptyStatus();
    statusCache.set(normalized, empty);
    return empty;
  }

  try {
    const redisPayload = await redisClient.get(redisKeyForUser(normalized));
    const parsed = safeParseStatus(redisPayload);
    statusCache.set(normalized, parsed);
    return parsed;
  } catch (error) {
    console.warn('⚠️ Failed to load Arda sync status from Redis:', error);
    const empty = createEmptyStatus();
    statusCache.set(normalized, empty);
    return empty;
  }
}

async function persistStatus(userKey: string, status: ArdaSyncStatusSnapshot): Promise<void> {
  const normalized = normalizeUserKey(userKey);
  statusCache.set(normalized, status);

  if (!redisClient) {
    return;
  }

  try {
    await redisClient.setex(
      redisKeyForUser(normalized),
      REDIS_TTL_SECONDS,
      JSON.stringify(status)
    );
  } catch (error) {
    console.warn('⚠️ Failed to persist Arda sync status to Redis:', error);
  }
}

function normalizeCount(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function buildSyncEvent(input: RecordSyncEventInput): ArdaSyncEvent {
  const requested = normalizeCount(input.requested, 1);
  const successful = normalizeCount(input.successful, input.success ? requested : 0);
  const failed = normalizeCount(input.failed, Math.max(requested - successful, input.success ? 0 : 1));

  return {
    id: randomUUID(),
    operation: input.operation,
    success: input.success,
    requested,
    successful,
    failed,
    timestamp: nowIso(),
    ...(input.error ? { error: input.error } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
  };
}

export async function recordArdaSyncEvent(
  userKey: string,
  input: RecordSyncEventInput
): Promise<ArdaSyncStatusSnapshot> {
  const status = await loadStatus(userKey);
  const event = buildSyncEvent(input);

  status.totalAttempts += 1;
  status.totalRequested += event.requested;
  status.totalSuccessful += event.successful;
  status.totalFailed += event.failed;
  status.lastAttemptAt = event.timestamp;
  status.updatedAt = event.timestamp;

  if (event.success) {
    status.successfulAttempts += 1;
    status.lastSuccessAt = event.timestamp;
  } else {
    status.failedAttempts += 1;
    status.lastErrorAt = event.timestamp;
  }

  status.recent.unshift(event);
  status.recent = status.recent.slice(0, RECENT_EVENT_LIMIT);

  await persistStatus(userKey, status);
  return status;
}

export async function getArdaSyncStatus(userKey: string): Promise<ArdaSyncStatusSnapshot> {
  return loadStatus(userKey);
}

