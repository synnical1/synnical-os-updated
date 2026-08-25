import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { parseStoredConnections } from "@/lib/connections"
import { privacyViewFor } from "@/lib/privacy"
import { publicIdentityExtras, visiblePersonaFor } from "@/lib/identity-profile"
import { safeJson } from "@/lib/feature-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/profile/<id>
 *
 * Public-facing profile for a *different* user, so someone can be clicked in
 * chat or the member list and have their card open. Accepts either a user id or
 * a username so links like /api/profile/sam work too.
 *
 * Only ever returns the sanitised shape from `toSafeUser` plus a couple of
 * non-sensitive public stats — never the password hash, email or session data.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const viewer = await getCurrentUser()
  if (!viewer) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  const target = await db.user.findFirst({
    where: { OR: [{ id }, { username: id }] },
  })
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  const privacy = await privacyViewFor(target.id, viewer.id)
  const safe = toSafeUser(target)
  const persona = privacy.profile ? await visiblePersonaFor(target.id, viewer.id) : null
  const personaSafe = persona ? { ...safe, displayName: persona.displayName || safe.displayName, bio: persona.bio || safe.bio, pfpUrl: persona.pfpUrl || safe.pfpUrl, bannerUrl: persona.bannerUrl || safe.bannerUrl, pfpIsGif: Boolean((persona.pfpUrl || safe.pfpUrl || "").toLowerCase().includes(".gif")), bannerIsGif: Boolean((persona.bannerUrl || safe.bannerUrl || "").toLowerCase().includes(".gif")) } : safe
  const user = privacy.profile ? personaSafe : {
    id: safe.id,
    username: safe.username,
    displayName: safe.displayName,
    bio: "",
    status: "",
    statusExpiresAt: null,
    pfpUrl: safe.pfpUrl,
    bannerUrl: null,
    pfpIsGif: safe.pfpIsGif,
    bannerIsGif: false,
    avatarDeco: safe.avatarDeco,
    profileEffect: null,
    profileThemePrimary: "#111111",
    profileThemeAccent: "#2b2b2b",
    profileThemeStyle: "solid" as const,
    role: safe.role,
    tags: [],
    muted: false,
    mutedUntil: null,
  }
  const [identityExtras, actualMessageCount] = await Promise.all([
    privacy.profile ? publicIdentityExtras(target.id, viewer.id) : Promise.resolve([]),
    privacy.stats ? db.message.count({ where: { userId: target.id, deleted: false } }) : Promise.resolve(0),
  ])
  const visitorRows = privacy.profile ? await db.featureRecord.findMany({ where: { scopeKey: target.id, kind: { in: ["profile-question", "profile-sticker"] } }, orderBy: { createdAt: "desc" }, take: 30 }) : []
  const visitorIds = [...new Set(visitorRows.map((row) => row.userId))]
  const visitorUsers = visitorIds.length ? await db.user.findMany({ where: { id: { in: visitorIds } }, select: { id: true, username: true, displayName: true, pfpUrl: true } }) : []
  const visitorById = new Map(visitorUsers.map((row) => [row.id, row]))

  return NextResponse.json({
    user,
    stats: {
      messageCount: actualMessageCount,
      joinedAt: privacy.stats ? ((target as { createdAt?: Date }).createdAt ?? null) : null,
    },
    isSelf: target.id === viewer.id,
    privateProfile: !privacy.profile,
    privacy,
    connections: privacy.connections ? parseStoredConnections(target.connectionsJson) : [],
    persona: persona ? { id: persona.id, name: persona.name, mood: persona.mood, accent: persona.accent } : null,
    identityExtras,
    visitorBoard: visitorRows.map((row) => ({ id: row.id, kind: row.kind, text: row.title, data: safeJson(row.dataJson, {}), author: visitorById.get(row.userId) || null, createdAt: row.createdAt })),
  }, { headers: { "Cache-Control": "private, no-store" } })
}
