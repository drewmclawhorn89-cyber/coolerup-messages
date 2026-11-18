import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  disableNetwork,
  doc,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export const firebaseProjectInfo = {
  projectId: firebaseConfig.projectId,
  firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
};

const WRITE_QUOTA_KEY = `coolerup_write_quota_until_${firebaseConfig.projectId}_${firebaseConfig.firestoreDatabaseId}`;
const READ_QUOTA_KEY = `coolerup_read_quota_until_${firebaseConfig.projectId}_${firebaseConfig.firestoreDatabaseId}`;

let memoryWriteQuotaUntil = 0;
let memoryReadQuotaUntil = 0;
let networkDisabledForSession = false;

const writeQuotaTripListeners = new Set<() => void>();

export class QuotaCooldownError extends Error {
  code = 'resource-exhausted';
  constructor(kind: 'read' | 'write') {
    super(`Firestore daily ${kind} quota limit exceeded; using local cache until reset.`);
    this.name = 'QuotaCooldownError';
  }
}

function getNextQuotaResetMs(): number {
  // Firebase daily free-tier quotas reset at midnight Pacific Time (~08:05 UTC)
  const now = new Date();
  const resetUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    8,
    5,
    0,
    0
  );
  if (resetUtc <= now.getTime()) {
    return resetUtc + 24 * 60 * 60 * 1000;
  }
  return resetUtc;
}

function readPersistedUntil(key: string): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writePersistedUntil(key: string, untilMs: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, String(untilMs));
  } catch {
    // Ignore storage restriction
  }
}

function disableFirestoreNetworkOnce(): void {
  if (networkDisabledForSession) return;
  networkDisabledForSession = true;
  void disableNetwork(db).catch(() => {});
}

export function isWriteQuotaPaused(): boolean {
  const until = Math.max(memoryWriteQuotaUntil, readPersistedUntil(WRITE_QUOTA_KEY));
  return Date.now() < until;
}

export function isReadQuotaPaused(): boolean {
  const until = Math.max(memoryReadQuotaUntil, readPersistedUntil(READ_QUOTA_KEY));
  return Date.now() < until;
}

export function markWriteQuotaExceeded(): void {
  const until = getNextQuotaResetMs();
  memoryWriteQuotaUntil = until;
  writePersistedUntil(WRITE_QUOTA_KEY, until);
  disableFirestoreNetworkOnce();
  for (const listener of writeQuotaTripListeners) {
    listener();
  }
  writeQuotaTripListeners.clear();
}

export function markReadQuotaExceeded(): void {
  const until = getNextQuotaResetMs();
  memoryReadQuotaUntil = until;
  writePersistedUntil(READ_QUOTA_KEY, until);
  disableFirestoreNetworkOnce();
}

export function isQuotaExceededError(error: unknown): boolean {
  if (error instanceof QuotaCooldownError) return true;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const msg = error instanceof Error ? error.message : String(error);
  return (
    code.includes('resource-exhausted') ||
    msg.includes('resource-exhausted') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('Quota exceeded') ||
    msg.includes('client is offline')
  );
}

export async function runFirestoreWrite<T>(
  operation: () => Promise<T>,
  timeoutMs = 5000
): Promise<T> {
  if (isWriteQuotaPaused() || networkDisabledForSession) {
    throw new QuotaCooldownError('write');
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let tripHandler: (() => void) | null = null;

  const guardPromise = new Promise<never>((_, reject) => {
    tripHandler = () => reject(new QuotaCooldownError('write'));
    writeQuotaTripListeners.add(tripHandler);

    timeoutId = setTimeout(() => {
      // If WriteStream enters resource-exhausted backoff, stop waiting and fall back locally
      memoryWriteQuotaUntil = Math.max(memoryWriteQuotaUntil, Date.now() + 5 * 60 * 1000);
      disableFirestoreNetworkOnce();
      reject(new QuotaCooldownError('write'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), guardPromise]);
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markWriteQuotaExceeded();
    }
    throw error;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (tripHandler) writeQuotaTripListeners.delete(tripHandler);
  }
}

export async function runFirestoreRead<T>(operation: () => Promise<T>): Promise<T> {
  if (isReadQuotaPaused() || networkDisabledForSession) {
    throw new QuotaCooldownError('read');
  }
  try {
    return await operation();
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markReadQuotaExceeded();
    }
    throw error;
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (isReadQuotaPaused()) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markReadQuotaExceeded();
      return;
    }
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
