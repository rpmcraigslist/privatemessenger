const PENDING_DEEP_LINK_KEY = 'messenger:pendingDeepLink';

export const DEEP_LINK_MESSAGE_NOT_FOUND =
  'This message no longer exists. It may have been deleted.';

export const DEEP_LINK_CONVERSATION_NOT_FOUND =
  'This conversation no longer exists. It may have been deleted.';

export type MessengerDeepLink = {
  conversationId: string;
  messageId?: string;
};

export function buildMessengerDeepLink(
  baseUrl: string,
  conversationId: string,
  messageId: string,
): string {
  const origin = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    chat: conversationId,
    message: messageId,
  });
  return `${origin}/?${params.toString()}`;
}

export function parseDeepLinkFromSearch(
  search: string,
): MessengerDeepLink | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const conversationId = params.get('chat')?.trim();
  if (!conversationId) return null;
  const messageId = params.get('message')?.trim() || undefined;
  return { conversationId, messageId };
}

/** Store ?chat=&message= from the URL before sign-in clears navigation. */
export function captureDeepLinkFromUrl(): MessengerDeepLink | null {
  if (typeof window === 'undefined') return null;

  const parsed = parseDeepLinkFromSearch(window.location.search);
  if (!parsed) return null;

  sessionStorage.setItem(PENDING_DEEP_LINK_KEY, JSON.stringify(parsed));

  const cleanUrl = `${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, '', cleanUrl);

  return parsed;
}

export function consumePendingDeepLink(): MessengerDeepLink | null {
  if (typeof window === 'undefined') return null;

  const raw = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
  if (!raw) return null;

  sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);

  try {
    const parsed = JSON.parse(raw) as MessengerDeepLink;
    if (!parsed?.conversationId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingDeepLink(): void {
  sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
}

/** True once messages are loaded and the deep-link target id is absent. */
export function isDeepLinkMessageMissing(
  focusMessageId: string | null | undefined,
  messagesSynced: boolean,
  messageIds: readonly string[],
): boolean {
  if (!focusMessageId || !messagesSynced) return false;
  return !messageIds.includes(focusMessageId);
}
