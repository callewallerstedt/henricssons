/*
 * Service worker för adminpanelen (PWA).
 *
 * Medvetet minimal: adminpanelen visar färsk data och får aldrig servera
 * cachat innehåll för sidor, skript eller API-anrop. Cachen används bara för
 * appikonerna, som är statiska. Allt annat går rakt ut på nätverket.
 */
const CACHE_NAME = 'henricssons-admin-v1';
const PRECACHE_URLS = [
    '/assets/pwa/icon-192.png',
    '/assets/pwa/icon-512.png',
    '/assets/pwa/icon-maskable-512.png',
    '/assets/pwa/apple-touch-icon.png',
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Offline · Admin</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:2rem;
         background:#f6f8fb; color:#0f172a; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; text-align:center; }
  h1 { font-size:1.15rem; margin:0 0 .5rem; }
  p { margin:0 0 1.25rem; color:#64748b; font-size:.95rem; }
  button { border:0; background:#2563eb; color:#fff; font-size:1rem; font-weight:600;
           padding:.8rem 1.4rem; border-radius:10px; }
</style></head>
<body><div>
  <h1>Ingen anslutning</h1>
  <p>Adminpanelen behöver internet för att visa aktuell data.</p>
  <button onclick="location.reload()">Försök igen</button>
</div></body></html>`;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .catch(() => undefined)
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch (err) {
        return;
    }
    if (url.origin !== self.location.origin) return;

    // Navigeringar: alltid nätverk, med en enkel offline-sida som fallback.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => new Response(OFFLINE_HTML, {
                status: 503,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }))
        );
        return;
    }

    // Appikoner: cache-first (statiska filer).
    if (url.pathname.startsWith('/assets/pwa/')) {
        event.respondWith(
            caches.match(request).then((cached) => cached || fetch(request).then((response) => {
                if (response && response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
                }
                return response;
            }))
        );
    }

    // Allt annat (admin.js, API-anrop, bilder) hanteras av webbläsaren som vanligt.
});

/* ---------------- Notiser om nya inskick ----------------
 * Nyttolasten kommer från /api/push/* och innehåller kundens namn,
 * formulärtyp och en förhandsvisning av meddelandet. url pekar på
 * inskicket så att en tryckning öppnar rätt ärende direkt.
 */
self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (err) {
        payload = { title: 'Nytt inskick', body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'Nytt inskick';
    const options = {
        body: payload.body || '',
        tag: payload.tag || 'henricssons-notis',
        renotify: true,
        icon: '/assets/pwa/icon-192.png',
        badge: '/assets/pwa/icon-192.png',
        timestamp: Date.parse(payload.timestamp || '') || Date.now(),
        data: {
            url: payload.url || '/admin',
            submissionId: payload.submission_id || '',
        },
    };
    if (payload.image) options.image = payload.image;
    if (payload.type === 'submission') {
        options.actions = [{ action: 'open', title: 'Öppna inskicket' }];
    }

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/admin';
    const targetUrl = new URL(target, self.location.origin).href;

    event.waitUntil((async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            if (client.url.indexOf('/admin') !== -1 && 'focus' in client) {
                await client.focus();
                // Panelen är redan öppen – be den visa rätt inskick utan omladdning.
                if ('postMessage' in client) {
                    client.postMessage({ type: 'open-submission', url: targetUrl });
                }
                return;
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })());
});
