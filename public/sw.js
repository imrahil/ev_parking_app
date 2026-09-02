// Notification-only service worker.
//
// Deliberately has NO fetch handler and does no precaching: the app is served
// from GitHub Pages and a caching SW is how you end up shipping a stale bundle
// forever. This exists purely so Web Push has somewhere to land.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data?.text() }
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'A charger is free', {
      body: data.body ?? '',
      // Relative to the SW's scope, so this survives the /ev_parking_app/ subpath
      icon: './icons/icon-192.png',
      // Android draws the status-bar badge from this file's ALPHA channel only,
      // as a flat silhouette. It must be a transparent PNG with just the glyph
      // opaque — handing it an opaque icon gives you a solid white rectangle.
      badge: './icons/badge-96.png',
      // One notification per station — a re-fired watch replaces, not stacks
      tag: data.tag,
      renotify: Boolean(data.tag),
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const scope = self.registration.scope

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if (client.url.startsWith(scope)) return client.focus()
      }
      return self.clients.openWindow(scope)
    })(),
  )
})
