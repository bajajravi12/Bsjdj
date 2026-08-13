// AARVI Production Messenger Service Worker for Push Notifications, PWA Standalone Launch & Offline Caching
const CACHE_NAME = 'aarvi-messenger-v2';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-icon.png'
];

// Install Event: Skip waiting and precache core shell assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache partial error (non-fatal):', err);
      });
    })
  );
});

// Activate Event: Claim clients and purge stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting obsolete cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

// Fetch Event: Handle requests with PWA offline fallback while NEVER caching API / private auth responses
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. NEVER cache API routes, WebSockets/SSE, or non-GET requests
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/api/') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return;
  }

  // 2. Navigation / SPA HTML requests: Network first with cached index.html fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          const cachedIndex = await cache.match('/');
          if (cachedIndex) return cachedIndex;
          const cachedReq = await cache.match(request);
          return cachedReq || new Response('AARVI Offline Mode', { status: 503, headers: { 'Content-Type': 'text/html' } });
        })
    );
    return;
  }

  // 3. Static Assets (.js, .css, images, fonts, manifest): Stale-While-Revalidate / Cache First
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
          }
          return networkResponse;
        }).catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
});

// Handle notification click event: Focus or open standalone window
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
      // If no window is open, open a new window to AARVI standalone app
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
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
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
