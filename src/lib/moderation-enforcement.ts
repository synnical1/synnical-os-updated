import { db } from "./db"
import type { ModerationResult } from "./content-moderation"
import { isAutomaticBanExemptRole } from "./moderation-policy"
import { banKnownIdentities } from "./identity-ban"

async function issuerFor(userId: string): Promise<string> {
  const owner = await db.user.findFirst({ where: { role: "OWNER" }, select: { id: true } })
  return owner?.id || userId
}

export async function permanentlyBanForModeration(userId: string, result: ModerationResult): Promise<boolean> {
  const target = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (isAutomaticBanExemptRole(target?.role)) {
    await recordModerationBlock(userId, { ...result, decision: "block" })
    return false
  }
  const issuerId = await issuerFor(userId)
  await banKnownIdentities(userId, `Automatic moderation ban: ${result.code}`)
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: null } }),
    db.infraction.create({
      data: {
        userId,
        issuerId,
        type: "AUTO_BAN",
        reason: `${result.reason} [${result.code}; confidence=${result.confidence.toFixed(2)}; source=${result.source}]`,
        duration: null,
      },
    }),
    db.session.deleteMany({ where: { userId } }),
  ])
  return true
}

export async function enforceRejectedModeration(userId: string, result: ModerationResult): Promise<boolean> {
  if (result.decision === "ban") return permanentlyBanForModeration(userId, result)
  await recordModerationBlock(userId, result)
  return false
}

export async function recordModerationBlock(userId: string, result: ModerationResult): Promise<void> {
  if (result.code === "MODERATION_UNAVAILABLE") return
  const issuerId = await issuerFor(userId)
  await db.infraction.create({
    data: {
      userId,
      issuerId,
      type: "AUTO_BLOCK",
      reason: `${result.reason} [${result.code}; confidence=${result.confidence.toFixed(2)}; source=${result.source}]`,
      duration: 0,
    },
  }).catch((error) => console.error("[moderation/audit]", error))
}

export function moderationHttpStatus(result: ModerationResult, banned = result.decision === "ban"): number {
  if (result.code === "MODERATION_UNAVAILABLE") return 503
  return banned ? 403 : 422
}

export function moderationPublicError(result: ModerationResult, banned = result.decision === "ban"): { error: string; code: string } {
  const action = banned ? "Your account was permanently banned." : "This content was not published."
  return { error: `[${result.code}] ${action} ${result.reason}`, code: result.code }
}
