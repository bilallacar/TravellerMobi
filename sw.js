// sw.js - Service Worker for TravellerMobi PWA

const CACHE_NAME = 'travellermobi-v1.0.4';

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
    './js/modules/share.js',
    './js/modules/story_export.js'
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

// Activate: Clean up old cache versions
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

// Fetch: Stale-While-Revalidate for app assets; Network-First for API/Supabase calls
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Bypass caching for non-GET requests, Supabase backend calls, auth endpoints, or live exchange rate APIs
    if (request.method !== 'GET' || 
        url.hostname.includes('supabase.co') || 
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('openexchangerates.org') ||
        url.hostname.includes('open.er-api.com') ||
        url.hostname.includes('frankfurter.app') ||
        url.pathname.includes('/rest/v1/') ||
        url.pathname.includes('/auth/v1/')) {
        return;
    }

    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
            // Fetch from network in background to update cache
            const fetchPromise = fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // If offline and request is for page navigation, fallback to index.html
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });

            // Return cached response immediately if available, otherwise wait for network
            return cachedResponse || fetchPromise;
        })
    );
});
