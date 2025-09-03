/* Enhanced Service Worker for Vsdvpro PWA */
const CACHE_VERSION = 'v3';
// Development detection: avoid aggressive caching while running on localhost (Next.js dev server)
const IS_DEV = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const CACHE_NAME = `vsdvpro-cache-${CACHE_VERSION}`;
const API_CACHE_NAME = `vsdvpro-api-cache-${CACHE_VERSION}`;
const STATIC_CACHE_NAME = `vsdvpro-static-cache-${CACHE_VERSION}`;
const API_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Core assets to cache immediately
// Keep only truly static shell-level routes to avoid caching user / auth HTML responses
const CORE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/offline.html'
];

// Static assets patterns
const STATIC_ASSET_PATTERNS = [
  /\/_next\/static\/.+/,
  /\.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$/,
  /\/icons\/.+/
];

// API patterns
const API_PATTERNS = [
  /\/api\/.+/
];

// Install event - cache core assets
self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => 
        cache.addAll(CORE_ASSETS).catch(err => {
          console.warn('Failed to cache some core assets:', err);
          // Cache what we can
          return Promise.allSettled(
            CORE_ASSETS.map(url => cache.add(url))
          );
        })
      ),
  // Don't auto skipWaiting; wait for explicit message for controlled rollout
  (async () => {/* noop */})()
    ])
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event) => {
  console.log('Service worker activating...');
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME && key !== API_CACHE_NAME && key !== STATIC_CACHE_NAME) {
              console.log('Deleting old cache:', key);
              return caches.delete(key);
            }
          })
        )
      ),
      (async () => {
        try {
          if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
          }
        } catch(e) {}
        await self.clients.claim();
        await broadcastMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION });
      })()
    ])
  );
});

// Listen for messages (e.g., SKIP_WAITING request)
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function broadcastMessage(msg) {
  try {
    const allClients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of allClients) {
      client.postMessage(msg);
    }
  } catch (e) {
    console.warn('Broadcast failed', e);
  }
}

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // In dev, bypass SW for Next.js internals to prevent stale chunk / corrupted content issues
  if (IS_DEV) {
    // Still allow offline.html to be served if explicitly requested
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    }
    return; // Do not intercept other requests in development
  }

  // Skip non-GET requests
  if (request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return; // non http(s)

  // Skip Next.js dynamic dev websocket / HMR endpoints just in case
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // Handle API
  if (API_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(handleApiRequest(request));
    return;
  }
  // Handle static build assets
  if (STATIC_ASSET_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(handleStaticAsset(request));
    return;
  }
  // Navigations
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
});

// Handle API requests with network-first strategy
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      const headers = new Headers(networkResponse.headers);
      headers.set('X-Cache-Timestamp', Date.now().toString());
      const wrapped = new Response(await networkResponse.clone().arrayBuffer(), { status: networkResponse.status, statusText: networkResponse.statusText, headers });
      cache.put(request, wrapped.clone());
      return networkResponse;
    }
    return networkResponse;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      const ts = cached.headers.get('X-Cache-Timestamp');
      if (ts && (Date.now() - Number(ts)) <= API_CACHE_TTL) {
        return cached;
      }
    }
    return new Response(JSON.stringify({ error: 'offline', message: 'Network unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

// Handle static assets with cache-first strategy
async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // For images, return a placeholder
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#f3f4f6"/><text x="100" y="100" text-anchor="middle" dy=".3em" font-family="Arial" font-size="14" fill="#6b7280">Image unavailable</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }
    throw error;
  }
}

// Handle navigation requests with network-first strategy
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  // Preload response (if navigationPreload enabled) or network fetch
  const preloadPromise = (async () => {
    try {
      const preload = (self.registration.navigationPreload) ? await event.preloadResponse : null; // event is not in scope; ignore
      return preload;
    } catch { return null; }
  })();
  const networkFetch = (async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        cache.put(request, response.clone());
        broadcastMessage({ type: 'NAVIGATION_UPDATED', url: request.url });
      }
      return response;
    } catch (e) {
      return null;
    }
  })();

  if (cached) {
    networkFetch; // kick off in background
    return cached;
  }
  const network = await networkFetch;
  if (network) return network;
  const offlinePage = await caches.match('/offline.html');
  if (offlinePage) return offlinePage;
  const appShell = await caches.match('/');
  if (appShell) return appShell;
  return new Response(OFFLINE_FALLBACK_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

// Background sync for form submissions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Implement background sync logic here
  console.log('Background sync triggered');
}

// Push notifications (future enhancement)
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New notification from Vsdvpro',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Open App',
        icon: '/icons/icon-192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icons/icon-192.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Vsdvpro', options)
  );
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// When a new SW finishes installing and there is an existing controller, notify clients
self.addEventListener('install', () => {
  if (self.registration.waiting) {
    broadcastMessage({ type: 'NEW_VERSION_AVAILABLE', version: CACHE_VERSION });
  }
});

// Standards-mode minimal offline fallback (ensures no Quirks Mode)
const OFFLINE_FALLBACK_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Offline - Vsdvpro</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#111827;color:#f9fafb;padding:2rem}main{max-width:480px;text-align:center}h1{font-size:1.5rem;margin-bottom:.75rem}p{opacity:.8;line-height:1.4;margin:.5rem 0}code{background:#1f2937;padding:2px 6px;border-radius:4px;font-size:.85em}</style>
</head><body><main><h1>Offline</h1><p>The network is unavailable. Cached content couldn\'t be used.</p><p>Retry after reconnecting or refresh the page.</p><p><code>VSDVPRO PWA</code></p></main></body></html>`;

console.log('Vsdvpro Service Worker loaded', CACHE_VERSION, 'dev mode:', IS_DEV);
