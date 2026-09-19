export const mediaProviders = {
  anikura: { id: "anikura", label: "Anikura", origin: "https://anikura.club", homePath: "/" },
  cineb: { id: "cineb", label: "CineB", origin: "https://cineblog01film.com", homePath: "/cineb/" },
} as const

export type MediaProviderId = keyof typeof mediaProviders

export type MediaProviderStatus = {
  id: MediaProviderId
  label: string
  available: boolean
  embeddable: boolean
  reason: "available" | "redirected" | "frame-blocked" | "unreachable"
}

export function isMediaProviderId(value: string): value is MediaProviderId {
  return Object.prototype.hasOwnProperty.call(mediaProviders, value)
}

/** Builds a URL only when it stays inside the approved provider origin. */
export function providerUrl(id: MediaProviderId, path = "/"): string | null {
  try {
    const provider = mediaProviders[id]
    const url = new URL(path === "/" ? provider.homePath : path, provider.origin)
    return url.origin === provider.origin && url.pathname.startsWith("/") ? url.toString() : null
  } catch {
    return null
  }
}

function isProviderRedirect(id: MediaProviderId, location?: string | null): boolean {
  if (!location) return false
  return providerUrl(id, location) !== null
}

export function mediaProviderStatus(
  id: MediaProviderId,
  response: { status: number; location?: string | null; xFrameOptions?: string | null; contentSecurityPolicy?: string | null },
): MediaProviderStatus {
  const provider = mediaProviders[id]
  if (response.status >= 300 && response.status < 400 && !isProviderRedirect(id, response.location)) {
    return { id, label: provider.label, available: false, embeddable: false, reason: "redirected" }
  }
  if (response.status < 200 || response.status >= 400) return { id, label: provider.label, available: false, embeddable: false, reason: "unreachable" }
  const xfo = (response.xFrameOptions || "").toLowerCase()
  const csp = (response.contentSecurityPolicy || "").toLowerCase()
  const frameBlocked = /deny|sameorigin/.test(xfo) || /frame-ancestors\s+(?:'none'|none)/.test(csp)
  return { id, label: provider.label, available: true, embeddable: !frameBlocked, reason: frameBlocked ? "frame-blocked" : "available" }
}
