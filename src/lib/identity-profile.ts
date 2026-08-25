import { db } from "./db"
import { safeJson } from "./feature-platform"

export type PersonaAudience = { everyone?: boolean; closeFriends?: boolean; userIds?: string[] }

function audience(value: string): PersonaAudience {
  const parsed = safeJson<PersonaAudience>(value, {})
  return {
    everyone: parsed.everyone === true,
    closeFriends: parsed.closeFriends === true,
    userIds: Array.isArray(parsed.userIds) ? parsed.userIds.filter((x) => typeof x === "string").slice(0, 100) : [],
  }
}

export async function visiblePersonaFor(targetId: string, viewerId: string) {
  const personas = await db.persona.findMany({ where: { userId: targetId }, orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }], take: 30 })
  if (!personas.length) return null
  if (targetId === viewerId) return personas.find((p) => p.isActive) || personas[0]
  const explicit = personas.find((p) => audience(p.audienceJson).userIds?.includes(viewerId))
  if (explicit) return explicit
  const close = await db.friendMeta.findUnique({ where: { userId_friendId: { userId: targetId, friendId: viewerId } }, select: { closeFriend: true } })
  if (close?.closeFriend) {
    const closePersona = personas.find((p) => audience(p.audienceJson).closeFriends)
    if (closePersona) return closePersona
  }
  return personas.find((p) => p.isActive && audience(p.audienceJson).everyone !== false)
    || personas.find((p) => audience(p.audienceJson).everyone)
    || null
}

export async function publicIdentityExtras(targetId: string, viewerId: string) {
  const records = await db.featureRecord.findMany({
    where: {
      kind: { in: ["profile-icebreaker", "profile-skill", "profile-shelf", "profile-riddle"] },
      userId: targetId,
      visibility: { in: ["public", "friends"] },
    },
    orderBy: { updatedAt: "desc" }, take: 80,
  })
  const friendship = targetId === viewerId ? true : Boolean(await db.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: targetId, receiverId: viewerId }, { requesterId: viewerId, receiverId: targetId }] }, select: { id: true } }))
  return records.filter((row) => row.visibility === "public" || friendship).map((row) => {
    const data = safeJson<Record<string, unknown>>(row.dataJson, {})
    if (row.kind === "profile-riddle") delete data.answer
    return { id: row.id, kind: row.kind, title: row.title, data, updatedAt: row.updatedAt }
  })
}

export function accountSerial(createdAt: Date, id: string) {
  const year = createdAt.getUTCFullYear()
  const tail = id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase().padStart(6, "0")
  return `SYN-${year}-${tail}`
}
