import "server-only"
import { cookies, headers } from "next/headers"
import { randomBytes, scryptSync, timingSafeEqual } from "crypto"
import type { NextRequest } from "next/server"
import { logSecurityEvent } from "@/lib/security-policy"
import { db } from "@/lib/db"
import { SESSION_COOKIE, SESSION_MAX_AGE_MS } from "@/lib/constants"

const SVG_CLIENT_ORIGINS = new Set([
  "https://cdn.jsdelivr.net",
  "https://jsdelivr.b-cdn.net",
])

export function isTrustedSvgClient(req: NextRequest): boolean {
  return (
    req.headers.get("x-synnical-client") === "svg" &&
    SVG_CLIENT_ORIGINS.has(req.headers.get("origin") || "")
  )
}

async function requestSessionToken(): Promise<string | null> {
  const authorization = (await headers()).get("authorization")
  if (authorization !== null) {
    const bearer = /^Bearer\s+([a-f0-9]{64})$/i.exec(authorization.trim())
    return bearer?.[1]?.toLowerCase() || null
  }

  return (await cookies()).get(SESSION_COOKIE)?.value || null
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  if (!salt || !hash) return false
  const hashBuf = Buffer.from(hash, "hex")
  const testBuf = scryptSync(password, salt, 64)
  if (hashBuf.length !== testBuf.length) return false
  return timingSafeEqual(hashBuf, testBuf)
}

export function normalizeSecurityAnswer(answer: string): string {
  return answer.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB")
}

export function hashSecurityAnswer(answer: string): string {
  return hashPassword(normalizeSecurityAnswer(answer))
}

export function verifySecurityAnswer(answer: string, stored: string): boolean {
  const normalized = normalizeSecurityAnswer(answer)
  if (!normalized) return false
  return verifyPassword(normalized, stored)
}

export function newToken(): string {
  return randomBytes(32).toString("hex")
}

export async function isUserPermanentlyBanned(userId: string): Promise<boolean> {
  const target = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (target?.role === "OWNER" || target?.role === "HEAD_ADMIN") return false
  const infraction = await db.infraction.findFirst({
    where: {
      userId,
      type: { in: ["BAN", "AUTO_BAN"] },
      duration: null,
    },
    select: { id: true },
  })
  return Boolean(infraction)
}

function sessionDeviceName(req?: NextRequest): string {
  if (!req) return "Browser session"
  const platform = (req.headers.get("sec-ch-ua-platform") || "").replaceAll('"', '').trim()
  const ua = req.headers.get("user-agent") || ""
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser"
  const os = platform || (/CrOS/i.test(ua) ? "ChromeOS" : /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "")
  return `${browser}${os ? ` on ${os}` : ""}`.slice(0, 80)
}

export async function createSession(userId: string, req?: NextRequest): Promise<string> {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS)
  const userAgent = (req?.headers.get("user-agent") || "").slice(0, 500)
  const deviceName = sessionDeviceName(req)
  await db.session.create({ data: { token, userId, expiresAt, deviceName, userAgent, lastSeenAt: new Date() } })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  })
  return token
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = await requestSessionToken()
  if (token) {
    const existing = await db.session.findUnique({ where: { token }, select: { userId: true } }).catch(() => null)
    await db.session.deleteMany({ where: { token } }).catch(() => {})
    if (existing?.userId) await logSecurityEvent(existing.userId, "logout", "This browser session signed out.").catch(() => {})
  }
  store.delete(SESSION_COOKIE)
}

export async function getCurrentSession() {
  const store = await cookies()
  const token = await requestSessionToken()
  if (!token) return null
  const session = await db.session.findUnique({ where: { token }, include: { user: true } })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    store.delete(SESSION_COOKIE)
    return null
  }
  if (await isUserPermanentlyBanned(session.user.id)) {
    await db.session.deleteMany({ where: { userId: session.user.id } }).catch(() => {})
    store.delete(SESSION_COOKIE)
    return null
  }
  if (session.lastSeenAt.getTime() < Date.now() - 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
  }
  return session
}

export async function getCurrentUser() {
  const session = await getCurrentSession()
  return session?.user || null
}
