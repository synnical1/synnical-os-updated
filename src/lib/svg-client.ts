"use client"

const SVG_CLIENT_PARAM = "synnicalClient"
const SVG_CLIENT_VALUE = "svg"
const SVG_SESSION_KEY = "synnical:svg-session:v1"
const SVG_HANDOFF_TYPE = "synnical-svg-session"
const SVG_HANDOFF_PATH = "/api/auth/svg-handoff?synnicalClient=svg"

let fetchInstalled = false
let recoveryInstalled = false
let recoveryAttempted = false
let popupFallback = false

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
 * SVG/jsDelivr mode runs Synnical in a third-party iframe. Existing Synnical
 * sessions use a SameSite cookie, so browsers correctly withhold that cookie
 * from the iframe. Recover the already-authenticated first-party session only
 * after a real user gesture:
 *
 * 1. Prefer the Storage Access API when the browser supports it.
 * 2. If storage access is unavailable/denied, use a same-origin top-level popup
 *    handoff. Top-level navigation may read the existing Lax session cookie,
 *    then the handoff page sends the short-lived session token only back to the
 *    same-origin Synnical iframe via postMessage.
 *
 * Once a bearer token is recovered we reload the iframe exactly once. Chat REST
 * requests, Socket.IO auth, and Browser proxy-ticket requests then all use the
 * same bearer session instead of repeatedly failing with 401s.
 */
export function installSvgSessionRecovery() {
  if (
    typeof window === "undefined" ||
    recoveryInstalled ||
    !isSvgClientRuntime() ||
    getSvgSessionToken()
  ) return

  recoveryInstalled = true
  let handoffPopup: Window | null = null

  const cleanup = () => {
    document.removeEventListener("pointerdown", recoverFromGesture, true)
    document.removeEventListener("keydown", recoverFromGesture, true)
    window.removeEventListener("message", onMessage)
  }

  const finish = (token: string) => {
    setSvgSessionToken(token)
    cleanup()
    try { handoffPopup?.close() } catch {}
    window.location.reload()
  }

  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (handoffPopup && event.source !== handoffPopup) return
    const data = event.data as { type?: unknown; token?: unknown } | null
    if (
      !data ||
      data.type !== SVG_HANDOFF_TYPE ||
      typeof data.token !== "string" ||
      !/^[a-f0-9]{64}$/i.test(data.token)
    ) return
    finish(data.token.toLowerCase())
  }

  const openHandoffPopup = () => {
    handoffPopup = window.open(
      SVG_HANDOFF_PATH,
      "synnical-svg-session-handoff",
      "popup,width=460,height=260,resizable=yes,scrollbars=no",
    )
    if (!handoffPopup) recoveryAttempted = false
  }

  const recoverFromGesture = (event: Event) => {
    if (!event.isTrusted || recoveryAttempted || getSvgSessionToken()) return
    recoveryAttempted = true

    if (!popupFallback) {
      const storageDocument = document as Document & {
        requestStorageAccess?: () => Promise<void>
      }
      if (typeof storageDocument.requestStorageAccess === "function") {
        // Call immediately while transient user activation is still present.
        storageDocument.requestStorageAccess().then(
          () => window.location.reload(),
          () => {
            // The next genuine gesture uses the top-level session bridge.
            popupFallback = true
            recoveryAttempted = false
          },
        )
        return
      }
      popupFallback = true
    }

    openHandoffPopup()
  }

  window.addEventListener("message", onMessage)
  document.addEventListener("pointerdown", recoverFromGesture, true)
  document.addEventListener("keydown", recoverFromGesture, true)
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

if (typeof window !== "undefined") {
  installSvgFetchAuth()
  installSvgSessionRecovery()
}
