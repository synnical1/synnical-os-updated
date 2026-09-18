import type { IncomingMessage } from "node:http"
import { isDeviceBanned } from "./identity-ban"
import { db } from "./db"
import { SESSION_COOKIE } from "./constants"

export function allowedSocketOrigin(req: Pick<IncomingMessage, "headers">): boolean {
  const origin = req.headers.origin
  if (!origin) return true // Non-browser clients still need authentication.
  try {
    const url = new URL(origin)
    return (url.protocol === "https:" || url.protocol === "http:") && url.host === req.headers.host
  } catch { return false }
}

export async function authenticatedProxyRequest(req: IncomingMessage): Promise<boolean> {
  if (!allowedSocketOrigin(req) || await isDeviceBanned(req.headers.cookie)) return false
  const bearer = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || "")?.[1]
  let cookie: string | undefined
  try {
    cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1)
    if (cookie) cookie = decodeURIComponent(cookie)
  } catch { return false }
  const token = bearer || cookie
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return false
  const session = await db.session.findUnique({ where: { token }, include: { user: { select: { role: true } } } })
  if (!session || session.expiresAt.getTime() <= Date.now() || await isDeviceBanned(req.headers.cookie, session.deviceHash)) return false
  if (["OWNER", "HEAD_ADMIN"].includes(session.user.role)) return true
  return !await db.infraction.findFirst({ where: { userId: session.userId, type: { in: ["BAN", "AUTO_BAN"] }, duration: null }, select: { id: true } })
}
