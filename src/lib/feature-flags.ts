import "server-only"
import { createHash } from "crypto"
import { db } from "@/lib/db"

function bucket(userId: string, key: string) {
  const digest = createHash("sha256").update(`${key}\0${userId}`).digest()
  return digest.readUInt32BE(0) % 100
}

export async function featureFlagEnabledForUser(key: string, userId: string): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({ where: { key } })
  if (!flag?.enabled) return false
  const enrollment = await db.labEnrollment.findUnique({ where: { userId_flagKey: { userId, flagKey: key } } })
  if (enrollment?.optedOut) return false
  if (enrollment?.enabled) return true
  if (flag.labOnly) return false
  const rollout = Math.max(0, Math.min(100, flag.rolloutPercent))
  return rollout >= 100 || (rollout > 0 && bucket(userId, key) < rollout)
}

export async function enabledFlagsForUser(userId: string) {
  const flags = await db.featureFlag.findMany({ where: { enabled: true }, orderBy: { name: "asc" } })
  const rows = [] as typeof flags
  for (const flag of flags) if (await featureFlagEnabledForUser(flag.key, userId)) rows.push(flag)
  return rows
}
