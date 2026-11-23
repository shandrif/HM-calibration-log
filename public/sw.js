/* HM Calibration Log service worker: offline shell + expiry notifications. */
const CACHE = 'hm-shell-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    // network first, cached shell when offline
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    // hashed files never change: cache first
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
  }
});

const LABELS = {
  en: { espresso_hot: 'Espresso · Hot', espresso_cold: 'Espresso · Cold', espresso: 'Espresso', hot_drip: 'Hot drip', iced_drip: 'Iced drip', ethiopian: 'Ethiopian', brazilian: 'Brazilian', expired: 'expired', title: 'Batch expired', body: 'Open the board to start a new batch.', okTitle: 'HM Calibration Log', okBody: 'Notifications are working on this device.' },
  ar: { espresso_hot: 'إسبريسو · ساخن', espresso_cold: 'إسبريسو · بارد', espresso: 'إسبريسو', hot_drip: 'مقطّرة ساخنة', iced_drip: 'مقطّرة مثلّجة', ethiopian: 'إثيوبي', brazilian: 'برازيلي', expired: 'منتهية', title: 'دفعة منتهية', body: 'افتح اللوحة لبدء دفعة جديدة.', okTitle: 'سجل المعايرة', okBody: 'الإشعارات تعمل على هذا الجهاز.' },
};

function label(L, slot) {
  const [st, bean] = slot.split(':');
  return bean ? `${L[st]} · ${L[bean]}` : L[st];
}

self.addEventListener('push', (e) => {
  e.waitUntil(
    (async () => {
      const lang = (self.navigator.language || 'en').startsWith('ar') ? 'ar' : 'en';
      const L = LABELS[lang];
      let title = L.title;
      let body = L.body;
      try {
        const res = await fetch('/api/state', { credentials: 'same-origin' });
        if (res.ok) {
          const s = await res.json();
          const now = s.now;
          const latest = {};
          for (const b of s.batches) if (!b.v && (!latest[b.s] || latest[b.s].t < b.t)) latest[b.s] = b;
          const expired = Object.values(latest).filter((b) => b.x <= now && now - b.x < 10 * 60 * 1000);
          if (expired.length) body = expired.map((b) => `${label(L, b.s)} — ${L.expired}`).join('\n');
          else {
            // nothing expired just now: this was a test from the More screen
            title = L.okTitle;
            body = L.okBody;
          }
        }
      } catch {
        /* show generic text */
      }
      await self.registration.showNotification(title, {
        body,
        tag: 'hm-expired',
        renotify: true,
        requireInteraction: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [300, 120, 300, 120, 300],
      });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    }),
  );
});
