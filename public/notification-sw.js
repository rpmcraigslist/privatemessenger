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
