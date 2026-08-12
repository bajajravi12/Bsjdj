// AARVI Production Messenger Service Worker for Push Notifications and PWA
const CACHE_NAME = 'aarvi-messenger-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // If an AARVI window/tab is already open, focus it and post a message
      for (const client of clientList) {
        if ('focus' in client) {
          try {
            await client.focus();
          } catch {}
          if (chatId) {
            client.postMessage({ type: 'OPEN_CHAT', chatId });
          }
          return;
        }
      }
      // If no window is open, open a new window to AARVI
      if (self.clients.openWindow) {
        const targetUrl = chatId ? `/?chatId=${encodeURIComponent(chatId)}` : '/';
        return await self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Handle push event if backend sends Web Push payloads
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    const title = data.title || 'AARVI Messenger';
    const options = {
      body: data.body || 'New encrypted message received',
      icon: data.icon || '/icon.png',
      badge: '/icon.png',
      tag: data.tag || (data.chatId ? `aarvi-chat-${data.chatId}` : 'aarvi-msg'),
      data: {
        chatId: data.chatId,
        messageId: data.messageId,
      },
      vibrate: [100, 50, 100],
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    console.error('[SW] Push payload parse error:', e);
  }
});
