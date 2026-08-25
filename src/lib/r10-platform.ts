import { createHash, randomBytes } from "crypto"
import { db } from "@/lib/db"

export const SOCIAL_SPACE_KINDS = new Set(["hangout", "birthday", "game", "study", "late-night", "squad", "movie-night", "music-room"])
export const SOCIAL_ITEM_KINDS = new Set([
  "reaction", "mood", "score", "clipboard", "drawing", "whiteboard", "canvas",
  "timer", "countdown", "jukebox", "file-link", "trivia", "truth-dare", "question",
  "team", "vote", "note", "recap", "challenge", "match", "memory", "schedule",
])

export function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""
}

export function cleanMultiline(value: unknown, max = 5000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

export function validId(value: unknown): string {
  const id = cleanText(value, 128)
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : ""
}

export function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  if (value && typeof value === "object") return value as T
  return fallback
}

export function boundedJson(value: unknown, max = 20_000): string {
  try {
    const raw = JSON.stringify(value ?? {})
    return raw.length <= max ? raw : JSON.stringify({ truncated: true })
  } catch {
    return "{}"
  }
}

export function inviteCode(): string {
  return randomBytes(5).toString("base64url").toUpperCase()
}

export async function acceptedFriend(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false
  return Boolean(await db.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: a, receiverId: b }, { requesterId: b, receiverId: a }] },
    select: { id: true },
  }))
}

export async function spaceMembership(spaceId: string, userId: string) {
  return db.socialSpaceMember.findUnique({ where: { spaceId_userId: { spaceId, userId } } })
}

export async function canReadSpace(spaceId: string, userId: string) {
  const space = await db.socialSpace.findUnique({ where: { id: spaceId } })
  if (!space || space.status !== "active") return null
  if (space.ownerId === userId) return { space, role: "owner" }
  const member = await spaceMembership(spaceId, userId)
  if (member) return { space, role: member.role }
  return null
}

export async function touchSpaceMember(spaceId: string, userId: string) {
  await db.socialSpaceMember.updateMany({ where: { spaceId, userId }, data: { lastSeenAt: new Date() } })
}

export async function closeExpiredSpaces(now = new Date()) {
  const expired = await db.socialSpace.findMany({
    where: { status: "active", expiresAt: { lte: now } }, select: { id: true }, take: 100,
  })
  if (!expired.length) return 0
  await db.socialSpace.updateMany({ where: { id: { in: expired.map((row) => row.id) } }, data: { status: "closed", archivedAt: now } })
  return expired.length
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
