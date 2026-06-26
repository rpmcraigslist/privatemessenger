import { client } from './amplify';
import { maxIsoTimestamp } from './read-state';

let loadListeners = new Set<() => void>();

function notifyLoadListeners(): void {
  for (const listener of loadListeners) {
    listener();
  }
}

export function onReadStateLoaded(listener: () => void): () => void {
  loadListeners.add(listener);
  return () => {
    loadListeners.delete(listener);
  };
}

const PREFIX = 'messenger:read:';
const pendingWrites = new Map<string, string>();
const serverCache = new Map<string, string>();
let loadPromise: Promise<void> | null = null;
let flushPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeUserSub: string | null = null;

const FLUSH_DELAY_MS = 250;

function cacheKey(userSub: string, readScopeKey: string): string {
  return `${userSub}:${readScopeKey}`;
}

function scanLocalReadCursors(
  userSub: string,
  username: string,
): Map<string, string> {
  const handle = username.trim().toLowerCase();
  const prefixes = [`${PREFIX}${userSub}:`, `${PREFIX}user:${handle}:`];
  const byScope = new Map<string, string>();

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;

    let scopeKey: string | null = null;
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) {
        scopeKey = key.slice(prefix.length);
        break;
      }
    }
    if (!scopeKey) continue;

    const value = localStorage.getItem(key);
    if (!value) continue;
    byScope.set(scopeKey, maxIsoTimestamp(byScope.get(scopeKey), value) ?? value);
  }

  return byScope;
}

function mergeIntoCache(userSub: string, readScopeKey: string, lastReadAt: string): void {
  const key = cacheKey(userSub, readScopeKey);
  const merged = maxIsoTimestamp(serverCache.get(key), lastReadAt);
  if (!merged) return;
  serverCache.set(key, merged);
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushReadStateNow();
  }, FLUSH_DELAY_MS);
}

async function flushPendingWrites(): Promise<void> {
  if (pendingWrites.size === 0 || !activeUserSub) return;

  const batch = [...pendingWrites.entries()];
  pendingWrites.clear();

  for (const [readScopeKey, lastReadAt] of batch) {
    const cached = serverCache.get(cacheKey(activeUserSub, readScopeKey));
    if (cached && maxIsoTimestamp(cached, lastReadAt) === cached) {
      continue;
    }

    try {
      const { data, errors } = await client.mutations.upsertMyReadCursor({
        readScopeKey,
        lastReadAt,
      });
      if (errors?.length || !data?.lastReadAt) {
        console.error('failed to persist read cursor', errors?.[0]?.message);
        pendingWrites.set(readScopeKey, lastReadAt);
        continue;
      }
      mergeIntoCache(activeUserSub, readScopeKey, data.lastReadAt);
    } catch (err) {
      console.error('failed to persist read cursor', err);
      pendingWrites.set(readScopeKey, lastReadAt);
    }
  }
}

export function getServerLastReadAt(
  userSub: string,
  readScopeKey: string,
): string | null {
  return serverCache.get(cacheKey(userSub, readScopeKey)) ?? null;
}

export function mergeServerLastReadAt(
  userSub: string,
  readScopeKey: string,
  lastReadAt: string,
): void {
  mergeIntoCache(userSub, readScopeKey, lastReadAt);
  const merged = serverCache.get(cacheKey(userSub, readScopeKey));
  if (!merged) return;
  pendingWrites.set(readScopeKey, merged);
  scheduleFlush();
}

export async function flushReadStateNow(): Promise<void> {
  if (flushPromise) return flushPromise;
  flushPromise = flushPendingWrites().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function loadServerReadState(
  userSub: string,
  username: string,
): Promise<void> {
  if (loadPromise && activeUserSub === userSub) {
    return loadPromise;
  }

  if (activeUserSub !== userSub) {
    serverCache.clear();
    pendingWrites.clear();
  }

  activeUserSub = userSub;
  loadPromise = (async () => {
    try {
      const { data, errors } = await client.queries.listMyReadCursors();
      if (errors?.length) {
        console.error('failed to load read cursors', errors[0]?.message);
      } else {
        for (const row of data ?? []) {
          if (!row?.readScopeKey || !row?.lastReadAt) continue;
          mergeIntoCache(userSub, row.readScopeKey, row.lastReadAt);
        }
      }
    } catch (err) {
      console.error('failed to load read cursors', err);
    }

    for (const [readScopeKey, lastReadAt] of scanLocalReadCursors(
      userSub,
      username,
    )) {
      const cached = serverCache.get(cacheKey(userSub, readScopeKey));
      if (maxIsoTimestamp(cached, lastReadAt) !== cached) {
        mergeServerLastReadAt(userSub, readScopeKey, lastReadAt);
      }
    }

    notifyLoadListeners();
  })();

  return loadPromise;
}

export function resetReadStateSync(): void {
  activeUserSub = null;
  loadPromise = null;
  flushPromise = null;
  serverCache.clear();
  pendingWrites.clear();
  loadListeners.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function installReadStateFlushHooks(): () => void {
  const flush = () => {
    void flushReadStateNow();
  };

  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  return () => {
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('beforeunload', flush);
  };
}
