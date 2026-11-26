// sw.js - Service Worker for TravellerMobi PWA

const CACHE_NAME = 'travellermobi-v1.6.0';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './config.js',
    './db.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    './icons/apple-touch-icon.png',
    './js/app.js',
    './js/state.js',
    './js/utils.js',
    './js/modules/auth.js',
    './js/modules/settings.js',
    './js/modules/trips.js',
    './js/modules/places.js',
    './js/modules/expenses.js',
    './js/modules/balance.js',
    './js/modules/journal.js',
    './js/modules/dashboard.js',
    './js/modules/admin.js',
    './js/modules/admin_blog_agent.js',
    './js/modules/share.js',
    './js/modules/story_export.js',
    './js/modules/ai_assistant.js',
    './js/modules/weather.js',
    './js/modules/reservations.js',
    './js/modules/explore.js',
    './js/modules/analytics.js',
    './js/modules/legal.js'
];

// Server-rendered & dynamic paths that must NEVER be hijacked by the SPA shell
const BYPASS_PREFIXES = [
    '/api/',
    '/blog/',
    '/gizlilik',
    '/cerez-politikasi',
    '/kullanim-sartlari',
    '/hakkimizda',
    '/sitemap.xml',
    '/robots.txt'
];

// Install: Pre-cache static shell assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Non-critical asset failed to precache:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate: Clean up old cache versions immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch:
// - Bypass cross-origin, non-GET, APIs, and SSR blog/legal pages completely
// - Network-First for SPA HTML navigation (so security/UI updates arrive immediately)
// - Stale-While-Revalidate for static JS/CSS/icons
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (
        request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        BYPASS_PREFIXES.some(prefix => url.pathname === prefix || url.pathname.startsWith(prefix))
    ) {
        return;
    }

    // Network-First for HTML document navigation
    if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
        event.respondWith(
            fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const clone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
                    }
                    return networkResponse;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Stale-While-Revalidate for static assets
    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
                }
                return networkResponse;
            }).catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
