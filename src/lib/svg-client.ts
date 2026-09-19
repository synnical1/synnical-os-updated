"use client"

const SVG_CLIENT_PARAM = "synnicalClient"
const SVG_CLIENT_VALUE = "svg"
const SVG_SESSION_KEY = "synnical:svg-session:v1"
const SVG_HANDOFF_TYPE = "synnical-svg-session"
const SVG_HANDOFF_PATH = "/api/auth/svg-handoff?synnicalClient=svg"

let fetchInstalled = false
let recoveryInstalled = false
let recoveryAttempted = false

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
 * from the iframe.
 *
 * On the first real user gesture, open a same-origin top-level handoff window.
 * Top-level navigation can read the existing Lax session cookie. The handoff
 * endpoint sends the session token only back to the same-origin Synnical iframe
 * via postMessage, then closes immediately. We store that token and reload the
 * iframe once so Chat REST, Socket.IO and Browser proxy-ticket requests all use
 * the same bearer session.
 *
 * If a browser blocks the popup, fall back to the Storage Access API while the
 * user activation is still live.
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

  const recoverFromGesture = (event: Event) => {
    if (!event.isTrusted || recoveryAttempted || getSvgSessionToken()) return
    recoveryAttempted = true

    handoffPopup = window.open(
      SVG_HANDOFF_PATH,
      "synnical-svg-session-handoff",
      "popup,width=460,height=260,resizable=yes,scrollbars=no",
    )

    if (handoffPopup) return

    // Popup blocked: immediately use the same user activation for storage
    // access instead of leaving Chat/Browser in a permanent 401 loop.
    const storageDocument = document as Document & {
      requestStorageAccess?: () => Promise<void>
    }
    if (typeof storageDocument.requestStorageAccess === "function") {
      storageDocument.requestStorageAccess().then(
        () => window.location.reload(),
        () => { recoveryAttempted = false },
      )
      return
    }

    recoveryAttempted = false
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
