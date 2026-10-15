// Offline support: app shell + fonts/confetti are cached after the first online visit.
const CACHE = 'bingo-v3'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.svg']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return

  // Page loads: network first (so updates arrive), fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); return res })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Everything else (hashed assets, Google Fonts, confetti): cache first, refresh in background.
  e.respondWith(
    caches.match(req).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
        return res
      }).catch(() => hit)
      return hit || fresh
    })
  )
})
