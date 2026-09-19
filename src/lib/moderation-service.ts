import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { canModerate } from "@/lib/auth"
import { canModerateTarget, roleRank } from "@/lib/roles"
import { AUTO_PUNISHMENTS } from "@/lib/constants"
import { publishModeration } from "./moderation-events"
import { auditData } from "@/lib/audit-log"

export class ModerationError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
export const staffRank = (role: string) => roleRank(role)
export function mayModerate(actor: { id: string; role: string }, target: { id: string; role: string }) {
  return actor.id !== target.id && canModerateTarget(actor.role, target.role)
}
export async function moderateAccount(actorId: string, body: { userId?: unknown; type?: unknown; reason?: unknown; durationMin?: unknown; commandNonce?: string }) {
  const me = await db.user.findUnique({ where: { id: actorId } })
  if (!me || !canModerate(me.role)) throw new ModerationError("Only staff can moderate accounts", 403)
  const userId = typeof body.userId === "string" ? body.userId : ""
  const type = typeof body.type === "string" ? body.type.toUpperCase() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : ""
  if (!userId || !["WARN", "MUTE", "BAN", "UNMUTE", "UNBAN"].includes(type) || !reason) throw new ModerationError("Target, action and reason are required")
  if (body.durationMin != null && (typeof body.durationMin !== "number" || !Number.isInteger(body.durationMin) || body.durationMin < 1 || body.durationMin > 525600)) throw new ModerationError("Duration must be 1–525600 whole minutes")
  if (type !== "MUTE" && body.durationMin != null) throw new ModerationError("Only mutes support a duration; bans are permanent")
  const durationMin = typeof body.durationMin === "number" ? body.durationMin : undefined
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) throw new ModerationError("User not found", 404)
  if (!mayModerate(me, target)) throw new ModerationError("You cannot moderate yourself or an equal or higher role", 403)
  const receiptId = body.commandNonce ? createHash("sha256").update(`moderation-command\0${actorId}\0${body.commandNonce}`).digest("hex") : null
  const transaction = async <T,>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => db.$transaction(async tx => {
    if (receiptId) {
      const receipt = await tx.featureRecord.findUnique({ where: { id: receiptId } })
      if (receipt) {
        const saved = JSON.parse(receipt.dataJson)
        if (saved.target !== userId || saved.type !== type) throw new ModerationError("Command nonce was already used for another action", 409)
        return saved.result as T
      }
    }
    // Recheck roles under the write transaction so concurrent demotion cannot authorize a stale action.
    const [actorNow, targetNow] = await Promise.all([tx.user.findUnique({ where: { id: actorId } }), tx.user.findUnique({ where: { id: userId } })])
    if (!actorNow || !targetNow || !mayModerate(actorNow, targetNow)) throw new ModerationError("Moderation permission changed", 403)
    const result = await operation(tx)
    if (receiptId) await tx.featureRecord.create({ data: { id: receiptId, userId: actorId, kind: "moderation-command", dataJson: JSON.stringify({ target: userId, type, result }) } })
    return result
  })
  if (type === "UNMUTE" || type === "UNBAN") {
    const result = await transaction(async tx => {
      const banWhere = { userId, type: { in: ["BAN", "AUTO_BAN"] }, duration: null }
      if (type === "UNBAN") {
        if (!await tx.infraction.findFirst({ where: banWhere })) throw new ModerationError("This account is not banned", 409)
        await tx.infraction.updateMany({ where: banWhere, data: { duration: 0 } })
        // A shared device stays blocked until every associated account ban is revoked.
        const identities = await tx.bannedIdentity.findMany({ where: { sourceUserId: userId } })
        for (const identity of identities) {
          const observations = await tx.identityObservation.findMany({ where: { kind: identity.kind, valueHash: identity.valueHash } })
          const otherBan = await tx.infraction.findFirst({ where: { userId: { in: observations.map(row => row.userId) }, type: { in: ["BAN", "AUTO_BAN"] }, duration: null } })
          if (otherBan) await tx.bannedIdentity.update({ where: { id: identity.id }, data: { sourceUserId: otherBan.userId } })
          else await tx.bannedIdentity.delete({ where: { id: identity.id } })
        }
      } else {
        if (await tx.infraction.findFirst({ where: banWhere })) throw new ModerationError("Unban this account before unmuting it", 409)
        await tx.infraction.updateMany({ where: { userId, type: { in: ["MUTE", "AUTO_MUTE"] } }, data: { duration: 0 } })
      }
      const mutes = type === "UNBAN" ? await tx.infraction.findMany({ where: { userId, type: { in: ["MUTE", "AUTO_MUTE"] } } }) : []
      const active = mutes.filter(row => row.duration === null || row.createdAt.getTime() + row.duration * 60000 > Date.now())
      const muted = active.length > 0
      const mutedUntil = !muted || active.some(row => row.duration === null) ? null : new Date(Math.max(...active.map(row => row.createdAt.getTime() + row.duration! * 60000)))
      await tx.user.update({ where: { id: userId }, data: { muted, mutedUntil } })
      const infraction = await tx.infraction.create({ data: { userId, issuerId: me.id, type, reason, duration: 0 } })
      await tx.auditLog.create({ data: auditData({ category: "MODERATION", action: type === "UNBAN" ? "USER_UNBANNED" : "USER_UNMUTED", actor: me, target, reason, before: { muted: target.muted }, after: { muted, mutedUntil } }) })
      return { infraction, muted, mutedUntil }
    })
    publishModeration(userId, type)
    return { ok: true, ...result }
  }

  const result = await transaction(async (tx) => {
    const fresh = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  const newWarnCount = type === "WARN" ? fresh.warnCount + 1 : fresh.warnCount
  const automatic = type === "WARN"
    ? newWarnCount >= AUTO_PUNISHMENTS.WARN_THRESHOLD_PERM_BAN ? { type: "AUTO_BAN", duration: null as number | null, message: `User auto-banned (${newWarnCount} warnings)` }
      : newWarnCount >= AUTO_PUNISHMENTS.WARN_THRESHOLD_24H_MUTE ? { type: "AUTO_MUTE", duration: 1440, message: `User auto-muted for 24h (${newWarnCount} warnings)` }
      : newWarnCount >= AUTO_PUNISHMENTS.WARN_THRESHOLD_1H_MUTE ? { type: "AUTO_MUTE", duration: 60, message: `User auto-muted for 1h (${newWarnCount} warnings)` }
      : null
    : null

  const now = Date.now()
  const directMuteUntil = type === "MUTE" && durationMin ? new Date(now + durationMin * 60_000) : null
  const autoMuteUntil = automatic?.type === "AUTO_MUTE" && automatic.duration ? new Date(now + automatic.duration * 60_000) : null


    const infraction = await tx.infraction.create({ data: { userId, issuerId: me.id, type, reason, duration: durationMin || null } })

    if (type === "WARN") await tx.user.update({ where: { id: userId }, data: { warnCount: newWarnCount } })
    if (type === "MUTE") await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: directMuteUntil } })
    if (type === "BAN") {
      await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: null } })
      await tx.session.deleteMany({ where: { userId } })
    }

    await tx.auditLog.create({ data: auditData({
      category: "MODERATION",
      action: type === "WARN" ? "WARNING_ISSUED" : type === "MUTE" ? "USER_MUTED" : "USER_BANNED",
      actor: me,
      target: { id: target.id, username: target.username },
      reason,
      before: { warnCount: target.warnCount, muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null },
      after: type === "WARN"
        ? { warnCount: newWarnCount }
        : type === "MUTE"
          ? { muted: true, mutedUntil: directMuteUntil?.toISOString() || null }
          : { muted: true, mutedUntil: null, sessionsRevoked: true },
      metadata: { infractionId: infraction.id, durationMin: durationMin ?? null },
    }) })

    if (automatic) {
      const autoReason = automatic.type === "AUTO_BAN"
        ? `Automatic ban: ${newWarnCount} warnings reached`
        : `Automatic ${automatic.duration === 1440 ? "24h" : "1h"} mute: ${newWarnCount} warnings`
      await tx.infraction.create({ data: { userId, issuerId: me.id, type: automatic.type, reason: autoReason, duration: automatic.duration } })
      if (automatic.type === "AUTO_BAN") {
        await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: null } })
        await tx.session.deleteMany({ where: { userId } })
      } else {
        await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: autoMuteUntil } })
      }
      await tx.auditLog.create({ data: auditData({
        category: "MODERATION",
        action: automatic.type === "AUTO_BAN" ? "AUTO_BAN_TRIGGERED" : "AUTO_MUTE_TRIGGERED",
        actor: me,
        target: { id: target.id, username: target.username },
        reason: autoReason,
        before: { warnCount: target.warnCount, muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null },
        after: automatic.type === "AUTO_BAN"
          ? { warnCount: newWarnCount, muted: true, mutedUntil: null, sessionsRevoked: true }
          : { warnCount: newWarnCount, muted: true, mutedUntil: autoMuteUntil?.toISOString() || null },
        metadata: { trigger: "warn-threshold", durationMin: automatic.duration },
      }) })
    }

    if (type === "BAN" || automatic?.type === "AUTO_BAN") {
      const observations = await tx.identityObservation.findMany({ where: { userId, kind: "device" } })
      for (const observation of observations) await tx.bannedIdentity.upsert({
        where: { kind_valueHash: { kind: "device", valueHash: observation.valueHash } },
        update: { reason, sourceUserId: userId },
        create: { kind: "device", valueHash: observation.valueHash, reason, sourceUserId: userId },
      })
    }
    return { infraction, autoPunishment: automatic ? { type: automatic.type, message: automatic.message } : null }
  })

  publishModeration(userId, type === "BAN" || result.autoPunishment?.type === "AUTO_BAN" ? "BAN" : type)
  return { ok: true, ...result }
}
