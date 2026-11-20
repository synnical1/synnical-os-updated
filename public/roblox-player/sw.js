// Service worker for /blox/. Roblox's web client talks to *.roblox.com and
// *.rbxcdn.com with ordinary fetch/XHR, from the page and from its pthread
// workers. Those hosts may be unreachable from here, so every cross-origin
// request is handed to a page in this scope, which sends it over Wisp
// (host.js) with the Roblox session attached, and the reply comes back here.
// Same-origin requests are left alone: the server already sends the
// cross-origin isolation headers the engine's SharedArrayBuffer needs.

const SCOPE = new URL(self.registration.scope);
const PINNED_FLAGS = new URL("engine/PinnedFlags.json", SCOPE).href;
// WasmPlayer.js loads the engine's flags from here. The engine on disk is one
// pinned version, so it gets the flags fetched alongside it, not whatever
// Roblox's live flags are for a newer engine.
const FLAGS_URL = /^https:\/\/clientsettingscdn\.roblox\.com\/v2\/settings\/application\/WebClientApp(?:\/bucket\/[^?#]*)?(?:[?#]|$)/;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);
const RELAY_TIMEOUT_MS = 120_000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!/^https?:/.test(request.url) || new URL(request.url).origin === self.location.origin) return;
  event.respondWith(crossOrigin(request, event.clientId));
});

async function crossOrigin(request, clientId) {
  if (request.method === "GET" && FLAGS_URL.test(request.url)) {
    const pinned = await fetch(PINNED_FLAGS, { cache: "no-cache" }).catch(() => null);
    if (pinned?.ok) return reply(200, "", [["content-type", "application/json"]], await pinned.arrayBuffer());
  }
  try {
    const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
    const result = await relay(clientId, {
      url: request.url,
      method: request.method,
      headers: [...request.headers],
      body,
    });
    return reply(result.status, result.statusText, result.headers, result.body);
  } catch (error) {
    return reply(502, "Bad Gateway", [["content-type", "application/json"]], JSON.stringify({ error: String(error?.message || error) }));
  }
}

function reply(status, statusText, headers, body) {
  const out = new Headers(headers);
  // The page is cross-origin isolated (COEP require-corp): without this, any
  // no-cors load (an <img>) of a relayed response would be blocked.
  out.set("cross-origin-resource-policy", "cross-origin");
  // The engine fetches with credentials and reads headers such as
  // x-csrf-token, so answer as Roblox would to its own site.
  out.set("access-control-allow-origin", self.location.origin);
  out.set("access-control-allow-credentials", "true");
  const names = [...new Set([...out.keys()])].join(", ");
  if (names) out.set("access-control-expose-headers", names);
  return new Response(NULL_BODY.has(status) ? null : body, { status, statusText, headers: out });
}

// A page of ours in this scope. Requests from the engine's workers carry the
// worker's client id, so fall back to any window.
async function relayPage(clientId) {
  const own = clientId ? await self.clients.get(clientId) : null;
  if (own?.type === "window") return own;
  const pages = await self.clients.matchAll({ type: "window" });
  const page = pages.find((client) => client.frameType === "top-level") ?? pages[0];
  if (!page) throw new Error("no page to relay through");
  return page;
}

async function relay(clientId, message) {
  const page = await relayPage(clientId);
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("relay timed out"));
    }, RELAY_TIMEOUT_MS);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      if (data.ok) resolve(data);
      else reject(new Error(data.error));
    };
    const transfer = message.body ? [channel.port2, message.body] : [channel.port2];
    page.postMessage({ type: "blox-fetch", ...message }, transfer);
  });
}
