import { createHmac, randomBytes } from "crypto"
import { cookies } from "next/headers"
import type { NextRequest } from "next/server"
import { db } from "@/lib/db"

if (typeof window !== "undefined") {
  throw new Error("request-identity must only run on the server")
}

const DEVICE_COOKIE = "synnical_device"
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2

type IdentityKind = "ip" | "device" | "client"
type IdentityHash = { kind: IdentityKind; valueHash: string }

function identitySecret(): string {
  const configured = process.env.IDENTITY_HASH_SECRET?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV !== "production") return "synnical-development-identity-secret"
  throw new Error("IDENTITY_HASH_SECRET is required in production")
}

function hashIdentity(kind: IdentityKind, raw: string): string {
  return createHmac("sha256", identitySecret()).update(`${kind}\0${raw}`).digest("hex")
}

async function deviceCookieValue(req: NextRequest): Promise<string> {
  const store = await cookies()
  const existing = store.get(DEVICE_COOKIE)?.value?.trim() || req.cookies.get(DEVICE_COOKIE)?.value?.trim()
  if (existing && /^[a-f0-9]{32,128}$/i.test(existing)) return existing
  const value = randomBytes(32).toString("hex")
  store.set(DEVICE_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_MAX_AGE_SECONDS,
  })
  return value
}

async function hashesForRequest(req: NextRequest): Promise<IdentityHash[]> {
  const hashes: IdentityHash[] = []
  const device = await deviceCookieValue(req)
  hashes.push({ kind: "device", valueHash: hashIdentity("device", device) })
  return hashes
}

export async function rememberRequestIdentity(userId: string, req: NextRequest): Promise<void> {
  const hashes = await hashesForRequest(req)
  for (const { kind, valueHash } of hashes) {
    await db.identityObservation.upsert({
      where: { userId_kind_valueHash: { userId, kind, valueHash } },
      update: { lastSeenAt: new Date() },
      create: { userId, kind, valueHash },
    })
  }
}

export async function bannedRequestIdentity(req: NextRequest): Promise<{ banned: boolean; kind?: string }> {
  const hashes = await hashesForRequest(req)
  if (!hashes.length) return { banned: false }
  const match = await db.bannedIdentity.findFirst({
    where: { OR: hashes.map(({ kind, valueHash }) => ({ kind, valueHash })) },
    select: { kind: true },
  })
  return match ? { banned: true, kind: match.kind } : { banned: false }
}

export async function requestDeviceHash(req: NextRequest): Promise<string> {
  return hashIdentity("device", await deviceCookieValue(req))
}
