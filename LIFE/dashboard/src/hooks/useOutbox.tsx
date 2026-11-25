/**
 * Session outbox provider: saves sessions write-ahead and keeps retrying from every page.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError, type Session } from '../api/client';
import {
  enqueueSession,
  getEntries,
  isOutboxAvailable,
  putEntry,
  removeQueuedSession,
  type OutboxEntry,
  type QueuedSession,
} from '../api/sessionOutbox';
import { useAuth } from './useAuth';

export const SESSIONS_SYNCED_EVENT = 'life:sessions-synced';
const RETRY_INTERVAL_MS = 30_000;

export type SaveOutcome =
  | { status: 'saved'; session: Session }
  | { status: 'queued'; reason: string }
  | { status: 'rejected'; reason: string }
  /** Neither stored locally nor accepted by the server: the data could not be kept. */
  | { status: 'failed'; reason: string };

interface OutboxContextValue {
  entries: OutboxEntry[];
  pendingCount: number;
  rejected: OutboxEntry[];
  needsSignIn: boolean;
  syncing: boolean;
  saveSession: (session: QueuedSession) => Promise<SaveOutcome>;
  syncNow: () => Promise<void>;
  discard: (clientSessionId: string) => Promise<void>;
  retry: (clientSessionId: string) => Promise<void>;
}

const OutboxContext = createContext<OutboxContextValue | null>(null);

type SendResult =
  | { kind: 'saved'; session: Session }
  | { kind: 'retry'; reason: string; stop: boolean; auth?: boolean }
  | { kind: 'rejected'; reason: string };

async function send(session: QueuedSession): Promise<SendResult> {
  try {
    const response = await api.createSession(session);
    return { kind: 'saved', session: response.session };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 0) {
        return { kind: 'retry', reason: 'The server is not reachable.', stop: true };
      }
      if (error.status === 401) {
        return { kind: 'retry', reason: 'Sign in again to upload saved sessions.', stop: true, auth: true };
      }
      if (error.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') {
        return { kind: 'retry', reason: 'Change your password to upload saved sessions.', stop: true };
      }
      if (error.status >= 500 || error.status === 429) {
        return { kind: 'retry', reason: error.message, stop: true };
      }
      return { kind: 'rejected', reason: error.message };
    }
    return { kind: 'retry', reason: 'Unexpected error while uploading.', stop: true };
  }
}

export function OutboxProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isOutboxAvailable()) return;
    try {
      setEntries(await getEntries());
    } catch (error) {
      console.error('Failed to read offline sessions:', error);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!isOutboxAvailable() || syncingRef.current || !api.isAuthenticated()) return;
    syncingRef.current = true;
    setSyncing(true);
    let syncedAny = false;
    try {
      const queue = await getEntries();
      for (const entry of queue) {
        if (entry.rejection) continue;
        const result = await send(entry.session);
        if (result.kind === 'saved') {
          await removeQueuedSession(entry.session.client_session_id);
          syncedAny = true;
          setNeedsSignIn(false);
        } else if (result.kind === 'rejected') {
          await putEntry({ ...entry, attempts: entry.attempts + 1, rejection: result.reason });
        } else {
          await putEntry({ ...entry, attempts: entry.attempts + 1 });
          if (result.auth) setNeedsSignIn(true);
          if (result.stop) break;
        }
      }
    } catch (error) {
      console.error('Offline session sync failed:', error);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refresh();
      if (syncedAny) window.dispatchEvent(new Event(SESSIONS_SYNCED_EVENT));
    }
  }, [refresh]);

  const saveSession = useCallback(async (session: QueuedSession): Promise<SaveOutcome> => {
    // Without IndexedDB we can only try the server directly.
    if (!isOutboxAvailable()) {
      const result = await send(session);
      if (result.kind === 'saved') {
        window.dispatchEvent(new Event(SESSIONS_SYNCED_EVENT));
        return { status: 'saved', session: result.session };
      }
      return { status: 'rejected', reason: result.reason };
    }

    // Write-ahead: the session is safe on this computer before we touch the network.
    // If the browser refuses (private window, storage full), still try the server.
    try {
      await enqueueSession(session);
    } catch (error) {
      console.error('Could not store the session locally; uploading directly:', error);
      const direct = await send(session);
      if (direct.kind === 'saved') {
        window.dispatchEvent(new Event(SESSIONS_SYNCED_EVENT));
        return { status: 'saved', session: direct.session };
      }
      return { status: 'failed', reason: direct.reason };
    }
    const result = await send(session);

    if (result.kind === 'saved') {
      await removeQueuedSession(session.client_session_id);
      await refresh();
      window.dispatchEvent(new Event(SESSIONS_SYNCED_EVENT));
      return { status: 'saved', session: result.session };
    }

    const entry: OutboxEntry = {
      session,
      queuedAt: new Date().toISOString(),
      attempts: 1,
      rejection: result.kind === 'rejected' ? result.reason : null,
    };
    await putEntry(entry);
    if (result.kind === 'retry' && result.auth) setNeedsSignIn(true);
    await refresh();
    return result.kind === 'rejected'
      ? { status: 'rejected', reason: result.reason }
      : { status: 'queued', reason: result.reason };
  }, [refresh]);

  const discard = useCallback(async (clientSessionId: string) => {
    await removeQueuedSession(clientSessionId);
    await refresh();
  }, [refresh]);

  const retry = useCallback(async (clientSessionId: string) => {
    const entry = (await getEntries()).find(item => item.session.client_session_id === clientSessionId);
    if (!entry) return;
    await putEntry({ ...entry, rejection: null });
    await syncNow();
  }, [syncNow]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void syncNow();
    const onOnline = () => void syncNow();
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(() => void syncNow(), RETRY_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(interval);
    };
  }, [isAuthenticated, syncNow]);

  const value: OutboxContextValue = {
    entries,
    pendingCount: entries.filter(entry => !entry.rejection).length,
    rejected: entries.filter(entry => entry.rejection),
    needsSignIn,
    syncing,
    saveSession,
    syncNow,
    discard,
    retry,
  };

  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxContextValue {
  const context = useContext(OutboxContext);
  if (!context) throw new Error('useOutbox must be used within an OutboxProvider');
  return context;
}

/** Run `callback` whenever saved sessions reach the server (for auto-refreshing views). */
export function useOnSessionsSynced(callback: () => void) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    const handler = () => callbackRef.current();
    window.addEventListener(SESSIONS_SYNCED_EVENT, handler);
    return () => window.removeEventListener(SESSIONS_SYNCED_EVENT, handler);
  }, []);
}
