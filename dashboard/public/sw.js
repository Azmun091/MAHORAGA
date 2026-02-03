/**
 * MAHORAGA PWA Service Worker
 * Handles offline functionality and caching for the trading dashboard.
 */

const SW_VERSION = '1.0.1';

// Cache name for offline assets
const CACHE_NAME = `mahoraga-v${SW_VERSION}`;

// Assets to cache on install (relative to scope)
const ASSETS_TO_CACHE = [
  '/mahoraga/',
  '/mahoraga/index.html',
];

// Install event - set up the service worker and cache assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing MAHORAGA service worker version:', SW_VERSION);
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching assets');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[SW] Failed to cache some assets:', err);
      });
    }).then(() => {
      // Skip waiting to activate immediately
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating MAHORAGA service worker');
  
  event.waitUntil(
    Promise.all([
      // Claim all clients immediately
      self.clients.claim(),
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('mahoraga-') && name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      }),
      // Clear all API-related caches to ensure fresh data
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            return caches.open(cacheName).then((cache) => {
              return cache.keys().then((keys) => {
                return Promise.all(
                  keys
                    .filter((request) => {
                      const url = new URL(request.url);
                      return url.pathname.includes('/api/') || url.pathname.includes('/mahoraga/api/');
                    })
                    .map((request) => {
                      console.log('[SW] Deleting cached API response:', request.url);
                      return cache.delete(request);
                    })
                );
              });
            });
          })
        );
      }),
    ])
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);
  
  // Never cache API endpoints - always fetch fresh data
  const isApiRequest = url.pathname.includes('/api/') || url.pathname.includes('/mahoraga/api/');
  
  if (isApiRequest) {
    // For API requests, always fetch from network, never cache
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          return response;
        })
        .catch(() => {
          // If network fails, return error response
          return new Response(
            JSON.stringify({ error: 'Network error', ok: false }),
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // For static assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached version if available
      if (cachedResponse) {
        return cachedResponse;
      }

      // Fetch from network
      return fetch(event.request)
        .then((response) => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response for caching
          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          // If network fails and we have a cached version, return it
          // Otherwise, return a fallback page
          if (event.request.destination === 'document') {
            return caches.match('/mahoraga/index.html');
          }
        });
    })
  );
});

// Push event - handle incoming push notifications (future enhancement)
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  if (!event.data) {
    console.warn('[SW] Push event has no data');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    console.error('[SW] Failed to parse push data:', e);
    return;
  }

  const { title, body, icon, badge } = data;

  const options = {
    body: body || '',
    icon: icon || '/mahoraga/icon-192.png',
    badge: badge || '/mahoraga/icon-72.png',
    tag: 'mahoraga-notification',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/mahoraga/',
      timestamp: Date.now(),
    },
  };

  event.waitUntil(
    self.registration.showNotification(title || 'MAHORAGA', options)
  );
});

// Notification click event - handle user interaction
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  
  event.notification.close();

  const notificationData = event.notification.data || {};
  const targetUrl = notificationData.url || '/mahoraga/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Open new window if none exists
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
