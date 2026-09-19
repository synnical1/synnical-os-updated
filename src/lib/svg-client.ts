"use client"

const SVG_CLIENT_PARAM = "synnicalClient"
const SVG_CLIENT_VALUE = "svg"
const SVG_SESSION_KEY = "synnical:svg-session:v1"

let fetchInstalled = false

export function isSvgClientRuntime(): boolean {
  if (typeof window === "undefined") return false
  try {
    return new URLSearchParams(window.location.search).get(SVG_CLIENT_PARAM) === SVG_CLIENT_VALUE
  } catch {
    return false
  }
}

export function getSvgSessionToken(): string | null {
  if (!isSvgClientRuntime()) return null
  try {
    const value = window.localStorage.getItem(SVG_SESSION_KEY)
    return value && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null
  } catch {
    return null
  }
}

export function setSvgSessionToken(token: string | null | undefined) {
  if (!isSvgClientRuntime()) return
  try {
    if (token && /^[a-f0-9]{64}$/i.test(token)) window.localStorage.setItem(SVG_SESSION_KEY, token.toLowerCase())
    else window.localStorage.removeItem(SVG_SESSION_KEY)
  } catch {}
}

export function clearSvgSessionToken() {
  if (typeof window === "undefined") return
  try { window.localStorage.removeItem(SVG_SESSION_KEY) } catch {}
}

/**
 * SVG/jsDelivr mode cannot rely on third-party cookies in modern browsers.
 * Patch same-origin Synnical API requests only, leaving assets and external
 * network traffic untouched.
 */
export function installSvgFetchAuth() {
  if (typeof window === "undefined" || fetchInstalled || !isSvgClientRuntime()) return
  fetchInstalled = true

  const nativeFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let target: URL
    try {
      const raw = input instanceof Request ? input.url : String(input)
      target = new URL(raw, window.location.href)
    } catch {
      return nativeFetch(input, init)
    }

    if (target.origin !== window.location.origin || !(target.pathname === "/api" || target.pathname.startsWith("/api/"))) {
      return nativeFetch(input, init)
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    headers.set("X-Synnical-Client", "svg")
    const token = getSvgSessionToken()
    if (token) headers.set("Authorization", `Bearer ${token}`)

    return nativeFetch(input, { ...init, headers })
  }) as typeof window.fetch
}

if (typeof window !== "undefined") installSvgFetchAuth()
