const AD_HOSTS = [
  "2mdn.net",
  "adnxs.com",
  "adskeeper.com",
  "adsrvr.org",
  "adsterra.com",
  "adtrafficquality.google",
  "amazon-adsystem.com",
  "bet365.com",
  "bidgear.com",
  "clickadu.com",
  "criteo.com",
  "criteo.net",
  "doubleclick.net",
  "exoclick.com",
  "exosrv.com",
  "gammacdn.com",
  "googlesyndication.com",
  "googleadservices.com",
  "histats.com",
  "hilltopads.net",
  "juicyads.com",
  "mgid.com",
  "onclickalgo.com",
  "onclickperformance.com",
  "openx.net",
  "outbrain.com",
  "popadscdn.net",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "pubmatic.com",
  "realsrv.com",
  "revcontent.com",
  "rubiconproject.com",
  "serving-sys.com",
  "smartadserver.com",
  "taboola.com",
  "trafficjunky.com",
  "yllix.com",
] as const

const EMBEDDED_DESTINATIONS = new Set(["audio", "embed", "iframe", "media", "object", "track", "video"])

export type ProxyAdRequest = {
  url: unknown
  destination?: unknown
  isIframe?: unknown
  parentFrameName?: unknown
}

export function isKnownAdUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
    return AD_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

export function isEmbeddedProxyRequest(request: ProxyAdRequest): boolean {
  const destination = typeof request.destination === "string" ? request.destination.toLowerCase() : ""
  return request.isIframe === true || Boolean(request.parentFrameName) || EMBEDDED_DESTINATIONS.has(destination)
}

export function shouldBlockProxyAdRequest(request: ProxyAdRequest, enabled: boolean): boolean {
  if (!enabled || isEmbeddedProxyRequest(request)) return false
  return isKnownAdUrl(request.url)
}
