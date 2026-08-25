import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"

type AuditActor = { id: string; username: string; role: string }
type AuditTarget = { id?: string | null; username?: string | null } | null

export type AuditEntry = {
  category: string
  action: string
  actor: AuditActor
  target?: AuditTarget
  reason?: string | null
  before?: unknown
  after?: unknown
  metadata?: unknown
}

function compactJson(value: unknown) {
  if (value === undefined || value === null) return "{}"
  try {
    const text = JSON.stringify(value)
    return text.length > 12_000 ? JSON.stringify({ truncated: true, preview: text.slice(0, 11_500) }) : text
  } catch {
    return JSON.stringify({ unserializable: true })
  }
}

export function auditData(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    category: entry.category.trim().toUpperCase().slice(0, 64),
    action: entry.action.trim().toUpperCase().slice(0, 96),
    actorIdSnapshot: entry.actor.id,
    actorUsernameSnapshot: entry.actor.username.slice(0, 64),
    actorRoleSnapshot: entry.actor.role.slice(0, 32),
    targetUserIdSnapshot: entry.target?.id || null,
    targetUsernameSnapshot: entry.target?.username?.slice(0, 64) || null,
    reason: (entry.reason || "").trim().slice(0, 1000),
    beforeJson: compactJson(entry.before),
    afterJson: compactJson(entry.after),
    metadataJson: compactJson(entry.metadata),
  }
}

export async function recordAuditLog(entry: AuditEntry) {
  return db.auditLog.create({ data: auditData(entry) })
}
