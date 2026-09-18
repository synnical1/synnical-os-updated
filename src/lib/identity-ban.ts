import { db } from "@/lib/db"

if (typeof window !== "undefined") {
  throw new Error("identity-ban must only run on the server")
}

/**
 * Persist the one-way identity observations already associated with an account
 * into the ban registry. This module deliberately has no next/headers import so
 * it is safe in both Next route handlers and Synnical's raw Node/tsx chat server.
 */
export async function banKnownIdentities(userId: string, reason: string, kinds: string[] = ["device"]): Promise<number> {
  const allowedKinds = new Set(kinds)
  const observations = await db.identityObservation.findMany({
    where: { userId, kind: { in: [...allowedKinds] } },
    select: { kind: true, valueHash: true },
  })
  for (const observation of observations) {
    await db.bannedIdentity.upsert({
      where: { kind_valueHash: { kind: observation.kind, valueHash: observation.valueHash } },
      update: { reason, sourceUserId: userId },
      create: { kind: observation.kind, valueHash: observation.valueHash, reason, sourceUserId: userId },
    })
  }
  return observations.length
}

import { createHmac } from "node:crypto"
export async function isDeviceBanned(cookieHeader: string | null | undefined, sessionHash?: string | null): Promise<boolean> {
  if (sessionHash && await db.bannedIdentity.findUnique({ where: { kind_valueHash: { kind: "device", valueHash: sessionHash } }, select: { id: true } })) return true
  const value = cookieHeader?.split(";").map(s => s.trim()).find(s => s.startsWith("synnical_device="))?.slice(16)
  if (!value || !/^[a-f0-9]{32,128}$/i.test(value)) return false
  const secret = process.env.IDENTITY_HASH_SECRET?.trim() || (process.env.NODE_ENV !== "production" ? "synnical-development-identity-secret" : "")
  if (!secret) throw new Error("IDENTITY_HASH_SECRET is required in production")
  const valueHash = createHmac("sha256", secret).update(`device\0${value}`).digest("hex")
  return Boolean(await db.bannedIdentity.findUnique({ where: { kind_valueHash: { kind: "device", valueHash } }, select: { id: true } }))
}
