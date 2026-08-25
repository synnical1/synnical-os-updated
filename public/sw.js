/* Synnical Scramjet 2 service-worker entrypoint. */
const SYNNICAL_PROXY_RUNTIME = "sj2-alpha2-controller14-synnical-os-20260821-wiring2"
const SYNNICAL_PROXY_PREFIX = "/~/sj/"
importScripts(`/controller/controller.sw.js?synnical-runtime=${SYNNICAL_PROXY_RUNTIME}`)

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

if (!self.$scramjetController) {
  throw new Error("Scramjet controller worker failed to load")
}

function controllerHasRoute(url) {
  try {
    return self.$scramjetController.shouldRoute({ request: { url } })
  } catch {
    return false
  }
}

self.addEventListener("message", (event) => {
  const probe = event.data?.$synnical$controllerRouteProbe
  const port = event.ports?.[0]
  if (!probe || !port || typeof probe.url !== "string") return
  let url
  try { url = new URL(probe.url) } catch { return port.postMessage({ routed: false }) }
  const eligible = url.origin === self.location.origin && url.pathname.startsWith(SYNNICAL_PROXY_PREFIX)
  port.postMessage({ routed: eligible && controllerHasRoute(url.href) })
})

async function recoverAndRoute(event) {
  if (self.$scramjetController.shouldRoute(event)) return self.$scramjetController.route(event)

  // A browser may keep the service worker alive while its in-memory controller
  // ports are lost. Ask every live Synnical page to reattach, then keep this
  // navigation pending briefly instead of leaking it into Next.js as a 404.
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  for (const client of clients) client.postMessage({ $controller$swrevive: {} })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (self.$scramjetController.shouldRoute(event)) return self.$scramjetController.route(event)
  }
  return new Response("Synnical Browser is reconnecting. Retry the page once.", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  })
}

self.addEventListener("fetch", (event) => {
  if (self.$scramjetController.shouldRoute(event)) {
    event.respondWith(self.$scramjetController.route(event))
    return
  }
  const url = new URL(event.request.url)
  if (url.origin === self.location.origin && url.pathname.startsWith(SYNNICAL_PROXY_PREFIX)) {
    event.respondWith(recoverAndRoute(event))
  }
})
