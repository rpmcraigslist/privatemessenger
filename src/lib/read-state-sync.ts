import { client } from './amplify';
import { maxIsoTimestamp } from './read-state';

const pendingWrites = new Map<string, string>();
const serverCache = new Map<string, string>();
let loadPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeUserSub: string | null = null;

const FLUSH_DELAY_MS = 400;

function cacheKey(userSub: string, readScopeKey: string): string {
  return `${userSub}:${readScopeKey}`;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingWrites();
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
        continue;
      }
      serverCache.set(cacheKey(activeUserSub, readScopeKey), data.lastReadAt);
    } catch (err) {
      console.error('failed to persist read cursor', err);
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
  const key = cacheKey(userSub, readScopeKey);
  const current = serverCache.get(key) ?? null;
  const merged = maxIsoTimestamp(current, lastReadAt);
  if (!merged) return;
  serverCache.set(key, merged);
  pendingWrites.set(readScopeKey, merged);
  scheduleFlush();
}

export async function loadServerReadState(userSub: string): Promise<void> {
  if (loadPromise && activeUserSub === userSub) {
    return loadPromise;
  }

  activeUserSub = userSub;
  loadPromise = (async () => {
    serverCache.clear();
    pendingWrites.clear();

    try {
      const { data, errors } = await client.queries.listMyReadCursors();
      if (errors?.length) {
        console.error('failed to load read cursors', errors[0]?.message);
        return;
      }
      for (const row of data ?? []) {
        if (!row?.readScopeKey || !row?.lastReadAt) continue;
        serverCache.set(
          cacheKey(userSub, row.readScopeKey),
          row.lastReadAt,
        );
      }
    } catch (err) {
      console.error('failed to load read cursors', err);
    }
  })();

  return loadPromise;
}

export function resetReadStateSync(): void {
  activeUserSub = null;
  loadPromise = null;
  serverCache.clear();
  pendingWrites.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
