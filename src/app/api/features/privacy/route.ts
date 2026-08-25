import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { getPrivacyConfig, invalidatePrivacyCache, privacyRulePatch, privacyViewFor, savePrivacyConfig } from "@/lib/privacy"
import { logSecurityEvent } from "@/lib/security-policy"

export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : ""

async function acceptedFriend(ownerId: string, viewerId: string) {
  return db.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: ownerId, receiverId: viewerId }, { requesterId: viewerId, receiverId: ownerId }] },
    select: { id: true },
  })
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const url = new URL(req.url)
  const previewViewerId = id(url.searchParams.get("viewerId"))
  if (previewViewerId) {
    const viewer = await db.user.findUnique({ where: { id: previewViewerId }, select: { id: true, username: true, displayName: true, pfpUrl: true } })
    if (!viewer) return fail("User not found", 404)
    return NextResponse.json({ viewer, view: await privacyViewFor(me.id, viewer.id) }, { headers: { "Cache-Control": "private, no-store" } })
  }

  const [config, friendships, rules] = await Promise.all([
    getPrivacyConfig(me.id),
    db.friendship.findMany({ where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { receiverId: me.id }] }, orderBy: { createdAt: "desc" } }),
    db.privacyRule.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" } }),
  ])
  const friendIds = friendships.map((row) => row.requesterId === me.id ? row.receiverId : row.requesterId)
  const users = friendIds.length ? await db.user.findMany({ where: { id: { in: friendIds } }, select: { id: true, username: true, displayName: true, pfpUrl: true, role: true } }) : []
  const metas = friendIds.length ? await db.friendMeta.findMany({ where: { userId: me.id, friendId: { in: friendIds } } }) : []
  const metaById = new Map(metas.map((row) => [row.friendId, row]))
  const ruleById = new Map(rules.map((row) => [row.viewerId, row]))
  return NextResponse.json({
    config,
    friends: users.map((user) => ({ ...user, closeFriend: Boolean(metaById.get(user.id)?.closeFriend), rule: ruleById.get(user.id) || null })),
  }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = typeof body.action === "string" ? body.action : ""

  if (action === "save-config") {
    const config = await savePrivacyConfig(me.id, body.config)
    await logSecurityEvent(me.id, "privacy_updated", "Account privacy defaults were updated.", { preset: config.preset })
    return NextResponse.json({ config })
  }

  if (action === "set-rule") {
    const viewerId = id(body.viewerId)
    if (!viewerId || viewerId === me.id || !await acceptedFriend(me.id, viewerId)) return fail("Friend not found", 404)
    const data = privacyRulePatch(body)
    const rule = await db.privacyRule.upsert({
      where: { userId_viewerId: { userId: me.id, viewerId } },
      update: data,
      create: { userId: me.id, viewerId, ...data },
    })
    invalidatePrivacyCache(me.id)
    await logSecurityEvent(me.id, "privacy_friend_rule", "A per-friend privacy rule was updated.", { viewerId, preset: rule.preset })
    return NextResponse.json({ rule, view: await privacyViewFor(me.id, viewerId) })
  }

  if (action === "delete-rule") {
    const viewerId = id(body.viewerId)
    if (!viewerId) return fail("Friend required")
    await db.privacyRule.deleteMany({ where: { userId: me.id, viewerId } })
    invalidatePrivacyCache(me.id)
    await logSecurityEvent(me.id, "privacy_friend_rule_removed", "A per-friend privacy override was removed.", { viewerId })
    return NextResponse.json({ ok: true, view: await privacyViewFor(me.id, viewerId) })
  }

  return fail("Unknown action", 404)
}
