"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { PROXY_RUNTIME_VERSION, proxyAsset as versionedAsset } from "@/lib/proxy-runtime"
import { readSetting } from "@/lib/settings-runtime"

// ---------------------------------------------------------------------------
// Scramjet controller loader + lifecycle hook
// ---------------------------------------------------------------------------
//
// Scramjet is an interception-based web proxy. It works by:
//   1. Loading scramjet.js (IIFE that sets globalThis.$scramjet)
//   2. Loading controller.api.js (IIFE that sets globalThis.$scramjetController)
//   3. Registering a service worker at /sw.js
//   4. Creating a Controller instance with a wisp transport
//
// The wisp transport connects to our wisp server at /wisp/ (mounted in
// server.ts) which handles the actual upstream HTTP/TCP proxying.
//
// This hook dynamically loads the scripts (so they don't bloat every page),
// registers the SW, and creates a singleton Controller instance.

declare global {
  interface Window {
    $scramjet?: any
    $scramjetController?: any
    __synnicalProxyRuntimeReady?: string
  }
}

type ControllerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; controller: any }
  | { status: "error"; error: string }

let controllerPromise: Promise<any> | null = null
const SERVICE_WORKER_URL = versionedAsset("/sw.js")

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded?
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      if (existing.getAttribute("data-loaded") === "true") return resolve()
      existing.addEventListener("load", () => resolve())
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)))
      return
    }
    const s = document.createElement("script")
    s.src = src
    s.async = false // preserve order
    s.onload = () => {
      s.setAttribute("data-loaded", "true")
      resolve()
    }
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}

async function loadScramjetScripts(): Promise<void> {
  // Check for insecure origin — Service Workers require HTTPS or localhost.
  // This is the #1 cause of Scramjet failures on remote deployments.
  if (typeof location !== "undefined") {
    const isSecure = location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.hostname === "[::1]"
    if (!isSecure) {
      throw new Error(
        "Scramjet requires HTTPS to register its Service Worker.\n" +
        "Your server is running on plain HTTP at " + location.hostname + ".\n\n" +
        "To fix this, set up HTTPS with one of these options:\n" +
        "1. Use Caddy (recommended) — it auto-provisions free Let's Encrypt certificates.\n" +
        "   Install Caddy, then run: caddy reverse-proxy --from your-domain.com --to localhost:3000\n" +
        "2. Use Cloudflare Tunnel — free, no domain needed:\n" +
        "   cloudflared tunnel --url http://localhost:3000\n" +
        "3. Use nginx with a self-signed certificate (for testing only).\n" +
        "4. SSH tunnel: ssh -L 80:localhost:3000 root@your-server, then access via http://localhost\n\n" +
        "The proxy browser will not work until HTTPS is configured.",
      )
    }
  }

  // Load the assets directly. Four HEAD preflights used to run before this and
  // made a cold Browser open noticeably slower on high-latency connections;
  // script/import failures below already identify the exact missing asset.
  await loadScript(versionedAsset("/scramjet/scramjet.js"))
  await loadScript(versionedAsset("/scramjet/controller.js"))
  if (!window.$scramjet) throw new Error("Scramjet core failed to initialise — the script loaded but globalThis.$scramjet is not set. The scramjet.js file may be corrupted or incompatible.")
  if (!window.$scramjetController) throw new Error("Scramjet controller failed to initialise — the script loaded but globalThis.$scramjetController is not set. The controller.js file may be corrupted or incompatible.")
}

function isCurrentProxyWorker(worker: ServiceWorker | null): worker is ServiceWorker {
  if (!worker) return false
  try {
    return new URL(worker.scriptURL).searchParams.get("synnical-runtime") === PROXY_RUNTIME_VERSION
  } catch {
    return false
  }
}

async function registerServiceWorker(): Promise<ServiceWorker> {
  if (!("serviceWorker" in navigator)) {
    throw new Error(
      "Service Workers are not supported in this browser. " +
      "Scramjet requires SW support to intercept and proxy requests. " +
      "Try Chrome, Edge, or Firefox.",
    )
  }

  // Double-check secure context (SW registration will silently fail otherwise)
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error(
      "Cannot register Service Worker: the page is not in a secure context. " +
      "Service Workers require HTTPS or localhost. " +
      "Deploy with TLS or access via http://localhost:3000.",
    )
  }

  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
      scope: "/",
      type: "classic",
      // Proxy upgrades must not reuse an old cached worker or old Scramjet
      // imports; those version mismatches surface as unexplained 404s.
      updateViaCache: "none",
    })
    // Registering an existing script may return before its update check has
    // completed. Await it so the controller bundle and its imported worker can
    // never change underneath an already-rendered Browser frame.
    await reg.update().catch((error) => {
      console.debug("[Scramjet] Service Worker update check failed:", error)
    })
  } catch (e: any) {
    throw new Error(
      `Service Worker registration failed: ${e?.message || e}. ` +
      `This usually means /sw.js is missing, the page is not HTTPS, ` +
      `or the SW has a syntax error. Check the browser console for details.`,
    )
  }

  // navigator.serviceWorker.ready is the upstream lifecycle gate: registration
  // alone does not mean an active worker exists yet. Keep it bounded so a
  // damaged worker produces a useful UI error instead of hanging Browser.
  await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
      "Scramjet service worker did not become ready within 12 seconds.",
    )), 12_000)),
  ])

  const pendingUpgrade = reg.installing || reg.waiting
  const controlledWorker = navigator.serviceWorker.controller
  const activeWorker = reg.active
  const controllerIsActive = !activeWorker || controlledWorker === activeWorker
  if (isCurrentProxyWorker(controlledWorker) && !pendingUpgrade && controllerIsActive) {
    return controlledWorker
  }
  // An active worker is not enough: until navigator.serviceWorker.controller
  // points at this version, iframe navigations to /~/ can bypass Scramjet and
  // hit the normal Synnical app, which Chromium then rejects inside the frame.
  // Wait for clients.claim()/controllerchange before creating any proxy frame.
  return new Promise((resolve, reject) => {
    let candidate: ServiceWorker | null = reg.installing || reg.waiting || reg.active

    const cleanup = () => {
      clearTimeout(timeout)
      candidate?.removeEventListener("statechange", onStateChange)
      navigator.serviceWorker.removeEventListener("controllerchange", onChange)
      reg.removeEventListener("updatefound", onUpdateFound)
    }

    const resolveIfReady = (): boolean => {
      const controlled = navigator.serviceWorker.controller
      const upgrade = reg.installing || reg.waiting
      const active = reg.active
      const upgradeStillPending = Boolean(
        upgrade && upgrade !== controlled && upgrade.state !== "redundant",
      )
      const activeNotControlling = Boolean(active && active !== controlled)
      if (isCurrentProxyWorker(controlled) && !upgradeStillPending && !activeNotControlling) {
        cleanup()
        resolve(controlled)
        return true
      }
      return false
    }

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(
        "The current Scramjet 2 worker did not take control within 12 seconds. " +
        "Retry Browser; no site data needs to be cleared.",
      ))
    }, 12_000)

    const onChange = () => { resolveIfReady() }

    const onStateChange = () => {
      if (candidate?.state === "activated") resolveIfReady()
    }

    const onUpdateFound = () => {
      candidate?.removeEventListener("statechange", onStateChange)
      candidate = reg.installing || reg.waiting || reg.active
      candidate?.addEventListener("statechange", onStateChange)
      resolveIfReady()
    }

    navigator.serviceWorker.addEventListener("controllerchange", onChange)
    reg.addEventListener("updatefound", onUpdateFound)
    candidate?.addEventListener("statechange", onStateChange)
    resolveIfReady()
  })
}

async function loadLibcurlTransport(): Promise<any> {
  // Dynamic import of the libcurl transport ESM module served from /public.
  // We use `new Function` to construct the import() call at runtime so the
  // bundler (Turbopack/webpack) can't statically analyse the path and try
  // to resolve it at build time. The module is served from
  // /public/scramjet/libcurl.mjs.
  const url = versionedAsset("/scramjet/libcurl.mjs")
  const dynamicImport = new Function("u", "return import(u)") as (u: string) => Promise<any>
  const mod = await dynamicImport(url)
  return mod.LibcurlClient || mod.default
}

function probeControllerRoute(worker: ServiceWorker, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    let settled = false
    const finish = (routed: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      channel.port1.close()
      resolve(routed)
    }
    const timeout = setTimeout(() => finish(false), 750)
    channel.port1.onmessage = (event) => finish(event.data?.routed === true)
    channel.port1.start()
    worker.postMessage({ $synnical$controllerRouteProbe: { url } }, [channel.port2])
  })
}

async function ensureControllerRoute(worker: ServiceWorker, controller: any): Promise<boolean> {
  const prefix = typeof controller?.prefix === "string" ? controller.prefix : ""
  if (!prefix.startsWith("/~/sj/")) throw new Error("Scramjet controller returned an invalid route prefix.")
  const probeUrl = new URL(`${prefix}__synnical_route_probe__`, location.origin).href

  // The upstream five-second revive guard can leave a freshly restarted worker
  // without the controller port that `controller.wait()` originally used.
  // Probe the active worker and reattach deterministically before reporting
  // Browser as ready.
  controller.guardServiceWorkerRevive = false
  let recovered = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await probeControllerRoute(worker, probeUrl)) return recovered
    if (typeof controller.setupMessagePort === "function") controller.setupMessagePort()
    recovered = true
    await new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)))
  }
  throw new Error("Scramjet service worker did not attach the controller route.")
}

export async function ensureScramjetControllerRoute(controller: any): Promise<boolean> {
  const controlledWorker = navigator.serviceWorker.controller
  const worker = isCurrentProxyWorker(controlledWorker)
    ? controlledWorker
    : controller?.serviceWorkerController
  if (!isCurrentProxyWorker(worker)) {
    throw new Error("The current Scramjet service worker is not controlling this page.")
  }

  // A browser is allowed to stop and recreate an otherwise-active service
  // worker between visits. Its in-memory route table disappears when that
  // happens, so readiness at app startup is not a permanent guarantee. Keep
  // the controller pointed at the current worker and verify the route at the
  // exact point where the user navigates.
  if (controller.serviceWorkerController !== worker) {
    controller.serviceWorkerController = worker
  }
  return ensureControllerRoute(worker, controller)
}

function getWispUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  const privacyRoute = readSetting<string>("browser.vpnCountry", "direct")
  if (privacyRoute === "netherlands") {
    // Never silently fall back to the direct route when the user explicitly
    // selected the Netherlands route. If the server has no configured Dutch
    // SOCKS5 egress this socket fails, and Settings reports it unavailable.
    return `${proto}://${location.host}/wisp-nl/`
  }

  // External Wisp overrides remain a direct-route operator feature.
  const override = process.env.NEXT_PUBLIC_WISP_URL
  if (override && override.trim().length > 0) {
    return override.endsWith("/") ? override : `${override}/`
  }
  return `${proto}://${location.host}/wisp/`
}

async function initController(): Promise<any> {
  if (controllerPromise) return controllerPromise

  controllerPromise = (async () => {
    // Scripts, service-worker activation and the transport module are
    // independent prerequisites. Start them together so a cold navigation
    // pays the slowest cost once instead of adding all three delays.
    const [, sw, LibcurlClient] = await Promise.all([
      loadScramjetScripts(),
      registerServiceWorker(),
      loadLibcurlTransport(),
    ])

    // Publish readiness only after the versioned worker is active so browser
    // frames never race an older Scramjet service worker after an update.
    window.__synnicalProxyRuntimeReady = PROXY_RUNTIME_VERSION
    window.dispatchEvent(new CustomEvent("synnical-proxy-runtime-ready", {
      detail: { version: PROXY_RUNTIME_VERSION },
    }))

    // A separate WebSocket precheck used to add as much as
    // five seconds while deliberately ignoring its own result. The transport
    // is the authoritative connection test and exposes its actual error.
    const websocket = getWispUrl()
    // libcurl-transport v2 names this option `websocket`. Keep `wisp` too for
    // compatibility with older locally bundled builds during a rolling update.
    const transport = new LibcurlClient({ websocket, wisp: websocket })

    // 4. Create controller
    const { Controller } = window.$scramjetController
    const controller = new Controller({
      serviceworker: sw,
      transport,
      config: {
        scramjetPath: versionedAsset("/scramjet/scramjet.js"),
        wasmPath: versionedAsset("/scramjet/scramjet.wasm"),
        injectPath: versionedAsset("/controller/controller.inject.js"),
      },
    })

    // Wait for controller to be ready, with a timeout
    await Promise.race([
      controller.wait(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(
          "Controller initialization timed out (15s). " +
          "This can happen if the Wisp WebSocket connection is unstable, " +
          "the WASM file is corrupted, or the service worker is not intercepting requests. " +
          "Check the browser console for detailed errors.",
        )), 15_000),
      ),
    ])
    await ensureScramjetControllerRoute(controller)
    return controller
  })()

  return controllerPromise
}

// Start the singleton during client-module evaluation. Browser is mounted in the
// initial Synnical shell, so waiting for React's first effect adds avoidable cold
// navigation latency. The hook below attaches UI state to this same promise.
if (typeof window !== "undefined") {
  void initController().catch(() => {})
}

export function useScramjetController() {
  const [state, setState] = useState<ControllerState>({ status: "idle" })

  useEffect(() => {
    let cancelled = false

    // Browser is mounted from the initial app shell, so warm the proxy as soon
    // as React has painted. Waiting for requestIdleCallback added up to 800 ms
    // to a user's very first search for no benefit. The singleton keeps this a
    // one-time cost for the whole Synnical session.
    setState({ status: "loading" })
    void initController()
      .then((controller) => {
        if (!cancelled) setState({ status: "ready", controller })
      })
      .catch((e) => {
        console.error("[Scramjet] Warm-up failed:", e)
        if (!cancelled) setState({ status: "error", error: e?.message || String(e) })
      })

    return () => { cancelled = true }
  }, [])

  const retry = useCallback(() => {
    // Retry clears a failed singleton and rebuilds every proxy prerequisite.
    controllerPromise = null
    setState({ status: "loading" })
    initController()
      .then((controller) => setState({ status: "ready", controller }))
      .catch((e) => {
        console.error("[Scramjet] Retry failed:", e)
        setState({ status: "error", error: e?.message || String(e) })
      })
  }, [])

  return { ...state, retry }
}

// ---------------------------------------------------------------------------
// Per-frame hook: manages a Scramjet Frame attached to an iframe element
// ---------------------------------------------------------------------------

export function useScramjetFrame(
  controller: any | null,
  iframeRef: React.RefObject<HTMLIFrameElement>,
  onNavigate?: (url: string) => void,
) {
  const frameRef = useRef<any>(null)

  useEffect(() => {
    if (!controller || !iframeRef.current) return

    // Create a new frame for this iframe. Browser frames intentionally run
    // only Synnical's core Scramjet pipeline; optional injected runtimes are
    // not part of Synnical OS.
    const frame = controller.createFrame(iframeRef.current, { plugins: [] })
    frameRef.current = frame

    return () => {
      // Clean up the frame when the component unmounts
      try {
        iframeRef.current.src = "about:blank"
      } catch {}
      frameRef.current = null
    }
  }, [controller, iframeRef])

  const navigate = useCallback((url: string) => {
    if (!frameRef.current) return
    let fullUrl = url
    if (!/^https?:\/\//i.test(fullUrl)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(fullUrl)) fullUrl = "https://" + fullUrl
      else fullUrl = "https://duckduckgo.com/?q=" + encodeURIComponent(fullUrl)
    }
    frameRef.current.go(fullUrl)
  }, [])

  const back = useCallback(() => frameRef.current?.back(), [])
  const forward = useCallback(() => frameRef.current?.forward(), [])
  const reload = useCallback(() => frameRef.current?.reload(), [])

  return { navigate, back, forward, reload, frame: frameRef }
}
