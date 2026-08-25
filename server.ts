// Synnical custom server — runs Next.js + Socket.IO + Stratus cloud-gaming
// API + Wisp proxy server on ONE port. Designed for VPS deployment with
// Nginx + PM2.
//
// IMPORTANT: this MUST be the first import. Next.js loads .env for code inside
// the app, but server.ts boots outside of Next and calls validateEnv() before
// app.prepare() runs. Without this, a PM2/systemd start on a clean VPS dies
// with "Missing required environment variable: DATABASE_URL" even though .env
// is sitting right there.
import "dotenv/config"

import { createServer, type IncomingMessage, type ServerResponse } from "http"
import { createRequire } from "module"
import type { Duplex } from "stream"
import next from "next"
import { attachChat } from "./src/lib/chat-server"
import { validateEnv } from "./src/lib/env"
import { existsSync } from "fs"
import { resolve } from "path"
import { createBlockedUdpSocketClass, createSocks5TcpSocketClass, parseSocks5Url } from "./src/lib/wisp-socks"

// Stratus + wisp ship as CommonJS. Load via createRequire so we keep
// server.ts as ESM.
const require = createRequire(import.meta.url)

// Validate environment before starting
const env = validateEnv()

const dev = process.env.NODE_ENV !== "production"
const hostname = process.env.HOSTNAME || "127.0.0.1"
const port = env.PORT
const SYNNICAL_SVG_ALLOWED_ORIGINS = new Set([
  "https://cdn.jsdelivr.net",
  "https://jsdelivr.b-cdn.net",
])

// ---------------------------------------------------------------------------
// Stratus cloud-gaming API
// ---------------------------------------------------------------------------
//
// Stratus mounts an Express sub-app under STRATUS_BASE_PATH (default
// /api/games). All stratus endpoints live at /api/games/cloud/v1/... and the
// WebSocket signaling endpoint lives at /api/games/cloud/v1/signal/:uuid.

// Cloud gaming is a first-class Synnical panel. Enable Stratus by default when
// the operator has not explicitly disabled it; missing/invalid sites.json still
// fails closed below instead of exposing a half-configured provider.
const STRATUS_BASE_PATH = "/api/games"
const STRATUS_ENABLED = (process.env.STRATUS_ENABLED ?? "true") !== "false"
const STRATUS_SITES_PATH =
  process.env.STRATUS_SITES_PATH || resolve(process.cwd(), "stratus", "sites.json")
const STRATUS_PUBLIC_DIR =
  process.env.STRATUS_PUBLIC_DIR || resolve(process.cwd(), "stratus", "public")

// ---------------------------------------------------------------------------
// Wisp proxy server (for Scramjet)
// ---------------------------------------------------------------------------
//
// Scramjet is an interception-based web proxy that runs as a service worker
// in the browser. It connects to a Wisp server via WebSocket to actually
// fetch upstream content. We mount the Wisp server at /wisp/ so the browser
// can connect to wss://host/wisp/ without CORS issues.

const WISP_ENABLED = (process.env.WISP_ENABLED ?? "true") !== "false"
const WISP_PATH = process.env.WISP_PATH || "/wisp"
const WISP_NL_PATH = process.env.WISP_NL_PATH || "/wisp-nl"
const WISP_NL_SOCKS5_URL = process.env.SYNNICAL_NL_SOCKS5_URL?.trim() || ""

interface StratusHandle {
  app: import("express").Express
  basePath: string
  handleUpgrade: (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => boolean
  shutdown: () => void
}

let stratus: StratusHandle | null = null
let wispRouteRequest: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null
let wispNlRouteRequest: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null

// Initialise Stratus
if (STRATUS_ENABLED) {
  if (!existsSync(STRATUS_SITES_PATH)) {
    console.warn(
      `> Stratus: sites.json not found at ${STRATUS_SITES_PATH}. ` +
        `Cloud gaming API is DISABLED. Copy stratus/sites.json.example to stratus/sites.json and configure it.`,
    )
  } else {
    try {
      const { createStratusApp } = require("./stratus/api.js") as {
        createStratusApp: (opts: {
          basePath: string
          sitesPath: string
          publicDir: string
        }) => StratusHandle
      }
      stratus = createStratusApp({
        basePath: STRATUS_BASE_PATH,
        sitesPath: STRATUS_SITES_PATH,
        publicDir: STRATUS_PUBLIC_DIR,
      })
    } catch (e) {
      console.error("> Stratus: failed to initialize — cloud gaming API disabled.", e)
    }
  }
}

// Initialise Wisp server
if (WISP_ENABLED) {
  try {
    // @mercuryworkshop/wisp-js exports `server` with `routeRequest`.
    // The package uses an "exports" map — require("@mercuryworkshop/wisp-js/server")
    // resolves to dist/wisp-server.cjs under CommonJS.
    const wispModule = require("@mercuryworkshop/wisp-js/server") as {
      server: {
        routeRequest: (req: IncomingMessage, socket: Duplex, head: Buffer, options?: Record<string, unknown>) => void
        options: any
      }
    }
    // Configure: trust X-Forwarded-For from the nginx proxy (127.0.0.1).
    if (wispModule.server?.options) {
      wispModule.server.options.parse_real_ip = true
      wispModule.server.options.parse_real_ip_from = ["127.0.0.1", "::1"]
    }
    wispRouteRequest = (req, socket, head) => {
      wispModule.server.routeRequest(req as any, socket as any, head as any)
    }

    if (WISP_NL_SOCKS5_URL) {
      try {
        // Parse once at startup so a malformed operator secret can never turn
        // the Netherlands toggle into a silent direct-connection fallback.
        parseSocks5Url(WISP_NL_SOCKS5_URL)
        const NetherlandsTCPSocket = createSocks5TcpSocketClass(WISP_NL_SOCKS5_URL)
        const BlockedUdpSocket = createBlockedUdpSocketClass()
        wispNlRouteRequest = (req, socket, head) => {
          wispModule.server.routeRequest(req as any, socket as any, head as any, {
            TCPSocket: NetherlandsTCPSocket,
            UDPSocket: BlockedUdpSocket,
          })
        }
      } catch (error) {
        console.error("> Wisp Netherlands route: invalid SYNNICAL_NL_SOCKS5_URL; route disabled.", error)
      }
    }
  } catch (e) {
    console.error("> Wisp: failed to initialize — proxy browser will not work.", e)
  }
}

async function main() {
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()
  await app.prepare()

  // Dispatch table for HTTP requests:
  //   /api/games/cloud/*  -> stratus express sub-app
  //   everything else     -> Next.js request handler
  let stratusDispatcher: ((req: IncomingMessage, res: ServerResponse) => void) | null = null
  if (stratus) {
    const express = require("express") as typeof import("express")
    const wrapper = (express as any).default ? (express as any).default() : (express as any)()
    wrapper.use(STRATUS_BASE_PATH, stratus.app)
    stratusDispatcher = (req, res) => wrapper(req as any, res as any)
  }

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : ""
    const requestUrl = req.url || "/"
    const svgApiRequest =
      SYNNICAL_SVG_ALLOWED_ORIGINS.has(requestOrigin) &&
      (requestUrl === "/api" || requestUrl.startsWith("/api/") || requestUrl.startsWith("/api?"))

    if (svgApiRequest) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin)
      res.setHeader("Access-Control-Allow-Credentials", "true")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Synnical-Client, Range")
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Retry-After")
      res.setHeader("Vary", "Origin")

      if (req.method === "OPTIONS") {
        res.statusCode = 204
        res.end()
        return
      }
    }
    const url = req.url || "/"
    if (stratusDispatcher && url.startsWith(`${STRATUS_BASE_PATH}/cloud/`)) {
      stratusDispatcher(req, res)
      return
    }
    handle(req, res)
  })

  // WebSocket upgrade handler.
  //
  // Three WS consumers share this server:
  //   1. Stratus signaling — /api/games/cloud/v1/signal/<uuid>
  //   2. Wisp proxy server — /wisp/
  //   3. Socket.IO chat    — /socket.io/
  //
  // We install ONE upgrade handler that dispatches by URL prefix. Socket.IO
  // also installs its own listener via attachChat() below; we capture those
  // listeners and fall through to them for anything we don't handle.
  const preExistingListeners = httpServer.listeners("upgrade").slice()
  httpServer.removeAllListeners("upgrade")

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url || ""

    // 1. Stratus signaling WS
    if (stratus && url.startsWith(`${STRATUS_BASE_PATH}/cloud/v1/signal/`)) {
      if (stratus.handleUpgrade(req, socket, head)) return
    }

    // 2a. Optional Netherlands-routed Wisp proxy. This path exists only when
    // the operator configured a real SOCKS5 endpoint in the Netherlands.
    if (wispNlRouteRequest && (url === WISP_NL_PATH || url.startsWith(`${WISP_NL_PATH}/`))) {
      wispNlRouteRequest(req, socket, head)
      return
    }

    // 2b. Direct Wisp proxy WS
    if (wispRouteRequest && (url === WISP_PATH || url.startsWith(`${WISP_PATH}/`))) {
      wispRouteRequest(req, socket, head)
      return
    }

    // 3. Fall through to Socket.IO / Next.js
    for (const l of preExistingListeners) {
      try { (l as any)(req, socket, head) } catch {}
    }
  })

  // Attach Socket.IO for real-time chat
  attachChat(httpServer)

  httpServer.listen(port, hostname, () => {
    console.log(`> Synnical ready on http://${hostname}:${port} (production=${!dev})`)
    console.log(`> Socket.IO path: ${env.NEXT_PUBLIC_SOCKET_URL}`)
    if (stratus) {
      console.log(`> Stratus cloud-gaming API mounted at ${STRATUS_BASE_PATH}/cloud/v1/*`)
    } else {
      console.log(`> Stratus cloud-gaming API: DISABLED`)
    }
    if (wispRouteRequest) {
      console.log(`> Wisp proxy server mounted at ${WISP_PATH}/`)
    } else {
      console.log(`> Wisp proxy server: DISABLED`)
    }
    if (wispNlRouteRequest) {
      console.log(`> Wisp Netherlands SOCKS5 route mounted at ${WISP_NL_PATH}/`)
    } else {
      console.log(`> Wisp Netherlands SOCKS5 route: NOT CONFIGURED`)
    }
  })

  // Clean shutdown
  const shutdown = (sig: string) => {
    console.log(`\n> ${sig} received, shutting down...`)
    try { stratus?.shutdown() } catch {}
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
}

main().catch((e) => {
  console.error("Failed to start server:", e)
  process.exit(1)
})
