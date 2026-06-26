self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'New message';
  const body = payload.body || '';
  const conversationId = payload.conversationId;
  const messageId = payload.messageId;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: messageId ? `message-${messageId}` : 'message',
      renotify: true,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { conversationId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'open-conversation', conversationId });
          return;
        }
      }

      const target = conversationId
        ? `/?chat=${encodeURIComponent(conversationId)}`
        : '/';
      if (self.clients.openWindow) {
        await self.clients.openWindow(target);
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'set-badge') return;
  const count = Number(event.data.count) || 0;
  if (!('setAppBadge' in self.navigator)) return;

  event.waitUntil(
    (async () => {
      try {
        if (count > 0) {
          await self.navigator.setAppBadge(count);
        } else {
          await self.navigator.clearAppBadge();
        }
      } catch {
        // Badge API is optional on this device.
      }
    })(),
  );
});
