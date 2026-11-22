// Yehulu's notifications helper. It only shows notifications and opens the
// app when one is tapped: it keeps no copy of the app (pages always load
// fresh from the internet).

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data?.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'Yehulu', {
    body: data.body || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of open) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus()
        if ('navigate' in client) await client.navigate(url)
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
