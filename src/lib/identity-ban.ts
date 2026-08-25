import { db } from "@/lib/db"

if (typeof window !== "undefined") {
  throw new Error("identity-ban must only run on the server")
}

/**
 * Persist the one-way identity observations already associated with an account
 * into the ban registry. This module deliberately has no next/headers import so
 * it is safe in both Next route handlers and Synnical's raw Node/tsx chat server.
 */
export async function banKnownIdentities(userId: string, reason: string, kinds: string[] = ["device", "client"]): Promise<number> {
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
