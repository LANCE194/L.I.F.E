/**
 * IndexedDB outbox for completed sessions.
 * Every session is written here BEFORE it is sent to the server and removed only after the
 * server confirms it, so no session is lost if the server is down, the network drops, or the
 * sign-in expires. Only metrics are stored — never camera frames.
 */

import type { SessionCreateRequest } from './types';

export type QueuedSession = SessionCreateRequest & { client_session_id: string };

export interface OutboxEntry {
  session: QueuedSession;
  queuedAt: string;
  attempts: number;
  /** Set when the server rejected the session (e.g. missing consent); needs a person to decide. */
  rejection: string | null;
}

const DATABASE_NAME = 'life-offline';
const STORE_NAME = 'sessions';
const DATABASE_VERSION = 1;

export function isOutboxAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!isOutboxAvailable()) {
    return Promise.reject(new Error('Offline session storage is not available in this browser'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'client_session_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open offline session storage'));
    request.onblocked = () => reject(new Error('Offline session storage upgrade is blocked by another tab'));
  });
}

// Stored records are the session fields plus an "_outbox" metadata object.
type StoredRecord = QueuedSession & {
  _outbox?: { queuedAt: string; attempts: number; rejection: string | null };
};

function toEntry(record: StoredRecord): OutboxEntry {
  const { _outbox, ...session } = record;
  return {
    session,
    queuedAt: _outbox?.queuedAt ?? new Date(0).toISOString(),
    attempts: _outbox?.attempts ?? 0,
    rejection: _outbox?.rejection ?? null,
  };
}

function toRecord(entry: OutboxEntry): StoredRecord {
  return {
    ...entry.session,
    _outbox: { queuedAt: entry.queuedAt, attempts: entry.attempts, rejection: entry.rejection },
  };
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result: T | undefined;
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage error'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage write was aborted'));
    });
  } finally {
    database.close();
  }
}

export async function putEntry(entry: OutboxEntry): Promise<void> {
  await withStore('readwrite', store => store.put(toRecord(entry)));
}

export async function enqueueSession(session: QueuedSession): Promise<void> {
  await putEntry({ session, queuedAt: new Date().toISOString(), attempts: 0, rejection: null });
}

export async function getEntries(): Promise<OutboxEntry[]> {
  const records = await withStore<StoredRecord[]>('readonly', store => store.getAll());
  return (records ?? []).map(toEntry).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function removeQueuedSession(clientSessionId: string): Promise<void> {
  await withStore('readwrite', store => store.delete(clientSessionId));
}
