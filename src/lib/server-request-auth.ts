import type { IncomingMessage } from "node:http"
import { isDeviceBanned } from "./identity-ban"
import { db } from "./db"
import { SESSION_COOKIE } from "./constants"
import { verifyProxyTicket } from "./proxy-ticket"

const SVG_SOCKET_ORIGINS = new Set([
  "https://cdn.jsdelivr.net",
  "https://jsdelivr.b-cdn.net",
])

export function allowedSocketOrigin(req: Pick<IncomingMessage, "headers">): boolean {
  const origin = req.headers.origin
  if (!origin) return true // Non-browser clients still need authentication.
  try {
    const url = new URL(origin)
    const sameOrigin = (url.protocol === "https:" || url.protocol === "http:") && url.host === req.headers.host
    return sameOrigin || SVG_SOCKET_ORIGINS.has(url.origin)
  } catch {
    return false
  }
}

function proxyTicketFromRequest(req: IncomingMessage) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    return verifyProxyTicket(url.searchParams.get("ticket"))
  } catch {
    return null
  }
}

export function stripProxyTicketFromRequest(req: IncomingMessage) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    if (!url.searchParams.has("ticket")) return
    url.searchParams.delete("ticket")
    req.url = `${url.pathname}${url.search}`
  } catch {}
}

export async function authenticatedProxyRequest(req: IncomingMessage): Promise<boolean> {
  if (!allowedSocketOrigin(req)) return false

  const ticket = proxyTicketFromRequest(req)
  const bearer = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || "")?.[1]

  let cookie: string | undefined
  try {
    cookie = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1)
    if (cookie) cookie = decodeURIComponent(cookie)
  } catch {
    return false
  }

  const token = bearer || cookie
  const session = ticket
    ? await db.session.findUnique({ where: { id: ticket.sid }, include: { user: { select: { role: true } } } })
    : token && /^[a-f0-9]{64}$/i.test(token)
      ? await db.session.findUnique({ where: { token }, include: { user: { select: { role: true } } } })
      : null

  if (!session || session.expiresAt.getTime() <= Date.now()) return false
  if (await isDeviceBanned(req.headers.cookie, session.deviceHash)) return false
  if (["OWNER", "HEAD_ADMIN"].includes(session.user.role)) return true

  return !await db.infraction.findFirst({
    where: {
      userId: session.userId,
      type: { in: ["BAN", "AUTO_BAN"] },
      duration: null,
    },
    select: { id: true },
  })
}
