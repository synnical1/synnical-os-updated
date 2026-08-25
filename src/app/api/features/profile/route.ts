import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { verificationToken, earnAchievement } from "@/lib/feature-platform"
import { fetchVerificationToken } from "@/lib/profile-link-verification"
import { isMod } from "@/lib/auth"
import { userOwnsItem } from "@/lib/shop"
import { invalidatePrivacyCache, privacyViewFor } from "@/lib/privacy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function clean(value: unknown, max = 1000) { return typeof value === "string" ? value.trim().slice(0, max) : "" }
function validId(value: unknown) { const out = clean(value, 128); return /^[A-Za-z0-9_-]{1,128}$/.test(out) ? out : "" }
function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }) }

async function areFriends(a: string, b: string) {
  return Boolean(await db.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: a, receiverId: b }, { requesterId: b, receiverId: a }] }, select: { id: true } }))
}

function visibilityAllowed(value: string, isSelf: boolean, friends: boolean) {
  return isSelf || value === "everyone" || (value === "friends" && friends)
}

function safeMusic(value: string) {
  try {
    const parsed = JSON.parse(value || "{}")
    if (!parsed || typeof parsed !== "object") return null
    const provider = ["audius", "piped", "invidious"].includes(clean(parsed.provider, 24)) ? clean(parsed.provider, 24) : "audius"
    const trackId = clean(parsed.trackId, 200)
    if (!trackId || /:\/\//.test(trackId)) return null
    return { provider, trackId, title: clean(parsed.title, 200), artist: clean(parsed.artist, 200), artwork: clean(parsed.artwork, 1000) }
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const url = new URL(req.url)
  const targetId = validId(url.searchParams.get("userId")) || me.id
  const target = await db.user.findUnique({ where: { id: targetId } })
  if (!target) return fail("User not found", 404)
  const self = target.id === me.id
  const friends = self ? true : await areFriends(me.id, target.id)
  const privacy = await privacyViewFor(target.id, me.id)

  if (!self && target.visitorVisibility === "enabled" && me.visitorVisibility === "enabled") {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000)
    const recent = await db.profileVisit.findFirst({ where: { profileUserId: target.id, viewerUserId: me.id, visitedAt: { gte: dayAgo } } })
    if (!recent) await db.profileVisit.create({ data: { profileUserId: target.id, viewerUserId: me.id } }).catch(() => {})
  }

  if (!privacy.profile && !self) {
    return NextResponse.json({
      privateProfile: true,
      privacy,
      profile: {
        id: target.id, username: target.username, displayName: target.displayName,
        pfpUrl: target.pfpUrl, avatarDeco: target.avatarDeco, role: target.role,
      },
      links: [], showcases: [], achievements: [], friendMeta: null,
      visitorCount: null, visitors: [], cosmeticFavorites: [], cosmeticLoadouts: [], cosmeticWishlist: [],
      isSelf: false, areFriends: friends,
    }, { headers: { "Cache-Control": "private, no-store" } })
  }

  const [links, showcases, earned, musicActivity, friendMeta, favorites, loadouts, cosmeticWishlist] = await Promise.all([
    db.profileLink.findMany({ where: { userId: target.id, ...(self ? {} : { verifiedAt: { not: null } }) }, orderBy: { createdAt: "asc" } }),
    db.profileShowcase.findMany({ where: { userId: target.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.userAchievement.findMany({ where: { userId: target.id }, orderBy: { earnedAt: "desc" }, take: 100 }),
    db.musicActivity.findUnique({ where: { userId: target.id } }),
    self ? null : db.friendMeta.findUnique({ where: { userId_friendId: { userId: me.id, friendId: target.id } } }),
    self ? db.cosmeticFavorite.findMany({ where: { userId: me.id } }) : Promise.resolve([]),
    self ? db.cosmeticLoadout.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" } }) : Promise.resolve([]),
    self ? db.cosmeticWishlist.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ])
  const achievementRows = earned.length ? await db.achievement.findMany({ where: { id: { in: earned.map((row) => row.achievementId) } } }) : []
  const achievementById = new Map(achievementRows.map((row) => [row.id, row]))
  const shownAchievementIds = new Set(showcases.filter((row) => row.kind === "achievement").map((row) => row.refId))
  const publicAchievements = earned.filter((row) => self || shownAchievementIds.has(row.achievementId)).map((row) => ({ ...row, achievement: achievementById.get(row.achievementId) || null }))

  let visitorCount: number | null = null
  let visitors: any[] = []
  if (self && target.visitorVisibility === "enabled") {
    const rows = await db.profileVisit.findMany({ where: { profileUserId: target.id }, orderBy: { visitedAt: "desc" }, take: 100 })
    const viewerIds = [...new Set(rows.map((row) => row.viewerUserId))]
    const viewers = viewerIds.length ? await db.user.findMany({ where: { id: { in: viewerIds }, visitorVisibility: "enabled" }, select: { id: true, username: true, displayName: true, pfpUrl: true, visitorVisibility: true } }) : []
    const allowed = new Map(viewers.map((row) => [row.id, row]))
    visitors = rows.filter((row) => allowed.has(row.viewerUserId)).map((row) => ({ ...row, viewer: allowed.get(row.viewerUserId) }))
    visitorCount = new Set(visitors.map((row) => row.viewerUserId)).size
  }

  const statusExpired = Boolean(target.statusExpiresAt && target.statusExpiresAt.getTime() <= Date.now())
  return NextResponse.json({
    profile: {
      id: target.id,
      username: target.username,
      displayName: target.displayName,
      bio: target.bio,
      status: statusExpired ? "" : target.status,
      statusExpiresAt: statusExpired ? null : target.statusExpiresAt,
      pfpUrl: target.pfpUrl,
      bannerUrl: target.bannerUrl,
      avatarDeco: target.avatarDeco,
      profileEffect: target.profileEffect,
      profileThemePrimary: target.profileThemePrimary,
      profileThemeAccent: target.profileThemeAccent,
      profileThemeStyle: target.profileThemeStyle,
      role: target.role,
      pronouns: privacy.pronouns && visibilityAllowed(target.pronounsVisibility, self, friends) ? target.pronouns : "",
      pronounsVisibility: self ? target.pronounsVisibility : undefined,
      birthday: privacy.birthday && target.birthday && visibilityAllowed(target.birthdayVisibility, self, friends) ? target.birthday : null,
      birthdayVisibility: self ? target.birthdayVisibility : undefined,
      visitorVisibility: self ? target.visitorVisibility : undefined,
      profileAccentGradient: target.profileAccentGradient,
      bannerPositionX: target.bannerPositionX,
      bannerPositionY: target.bannerPositionY,
      profileMusic: safeMusic(target.profileMusic),
      gameStatus: privacy.game ? target.gameStatus : "",
      gameStatusGameId: privacy.game ? target.gameStatusGameId : null,
      gameStatusSessionId: privacy.game ? target.gameStatusSessionId : null,
      musicActivity: privacy.music && musicActivity?.shareEnabled ? musicActivity : null,
    },
    links: privacy.profile ? links.map((link) => ({ ...link, verificationToken: self ? link.verificationToken : undefined })) : [],
    showcases: privacy.profile ? showcases : [],
    achievements: privacy.profile ? publicAchievements : [],
    friendMeta,
    visitorCount,
    visitors,
    cosmeticFavorites: favorites,
    cosmeticLoadouts: loadouts,
    cosmeticWishlist,
    isSelf: self,
    areFriends: friends,
    privateProfile: !privacy.profile,
    privacy,
  }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)

  if (action === "update-profile") {
    const data: any = {}
    if (body.birthday === null || typeof body.birthday === "string") {
      const birthday = body.birthday ? clean(body.birthday, 10) : null
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return fail("Birthday must be YYYY-MM-DD")
      data.birthday = birthday
    }
    if (["everyone", "friends", "private"].includes(body.birthdayVisibility)) data.birthdayVisibility = body.birthdayVisibility
    if (typeof body.pronouns === "string") data.pronouns = clean(body.pronouns, 40)
    if (["everyone", "friends", "private"].includes(body.pronounsVisibility)) data.pronounsVisibility = body.pronounsVisibility
    if (["enabled", "private"].includes(body.visitorVisibility)) data.visitorVisibility = body.visitorVisibility
    if (typeof body.profileAccentGradient === "string") {
      const gradient = clean(body.profileAccentGradient, 180)
      if (gradient && !/^linear-gradient\([#(),.%\sa-zA-Z0-9-]+\)$/.test(gradient)) return fail("Invalid profile gradient")
      data.profileAccentGradient = gradient
    }
    if (body.bannerPositionX !== undefined) data.bannerPositionX = Math.max(0, Math.min(100, Math.round(Number(body.bannerPositionX) || 50)))
    if (body.bannerPositionY !== undefined) data.bannerPositionY = Math.max(0, Math.min(100, Math.round(Number(body.bannerPositionY) || 50)))
    if (body.statusExpiresAt === null) data.statusExpiresAt = null
    else if (body.statusExpiresAt) {
      const date = new Date(String(body.statusExpiresAt))
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.getTime() > Date.now() + 31 * 86400000) return fail("Invalid status expiry")
      data.statusExpiresAt = date
    }
    if (body.profileMusic !== undefined) {
      if (!body.profileMusic) data.profileMusic = ""
      else {
        const music = body.profileMusic
        const provider = ["audius", "piped", "invidious"].includes(clean(music.provider, 24)) ? clean(music.provider, 24) : "audius"
        const trackId = clean(music.trackId, 200)
        if (!trackId || /:\/\//.test(trackId)) return fail("Profile music requires a provider track ID, not a URL")
        data.profileMusic = JSON.stringify({ provider, trackId, title: clean(music.title, 200), artist: clean(music.artist, 200), artwork: clean(music.artwork, 1000) })
      }
    }
    const updated = await db.user.update({ where: { id: me.id }, data })
    if (updated.pronouns || updated.profileMusic || updated.profileAccentGradient) await earnAchievement(me.id, "profile-complete").catch(() => {})
    return NextResponse.json({ ok: true })
  }

  if (action === "friend-meta") {
    const friendId = validId(body.friendId)
    if (!friendId || !await areFriends(me.id, friendId)) return fail("Friend not found", 404)
    const data: any = {}
    if (typeof body.nickname === "string") data.nickname = clean(body.nickname, 60)
    if (typeof body.note === "string") data.note = String(body.note).trim().slice(0, 500)
    if (typeof body.closeFriend === "boolean") data.closeFriend = body.closeFriend
    if (typeof body.favorite === "boolean") data.favorite = body.favorite
    if (typeof body.label === "string") data.label = clean(body.label, 32)
    const row = await db.friendMeta.upsert({ where: { userId_friendId: { userId: me.id, friendId } }, create: { userId: me.id, friendId, ...data }, update: data })
    if (typeof body.closeFriend === "boolean") invalidatePrivacyCache(me.id)
    return NextResponse.json({ meta: row })
  }

  if (action === "add-link") {
    const label = clean(body.label, 40)
    let parsed: URL
    try { parsed = new URL(String(body.url || "")) } catch { return fail("Invalid URL") }
    if (parsed.protocol !== "https:") return fail("Profile links must use HTTPS")
    if (!label) return fail("Link label required")
    const count = await db.profileLink.count({ where: { userId: me.id } })
    if (count >= 8) return fail("Profile link limit reached", 409)
    const row = await db.profileLink.create({ data: { userId: me.id, label, url: parsed.toString().slice(0, 1000), domain: parsed.hostname.toLowerCase(), verificationToken: verificationToken() } })
    await earnAchievement(me.id, "profile-complete").catch(() => {})
    return NextResponse.json({ link: row })
  }

  if (action === "verify-link") {
    const linkId = validId(body.linkId)
    const link = linkId ? await db.profileLink.findFirst({ where: { id: linkId, userId: me.id } }) : null
    if (!link) return fail("Link not found", 404)
    let text: string
    try { text = await fetchVerificationToken(link.domain) } catch (error) { return fail(error instanceof Error ? error.message : "Verification failed", 422) }
    if (!text.split(/\s+/).includes(link.verificationToken)) return fail("Verification token was not found at /.well-known/synnical-verification.txt", 422)
    const updated = await db.profileLink.update({ where: { id: link.id }, data: { verifiedAt: new Date() } })
    return NextResponse.json({ link: updated })
  }

  if (action === "delete-link") {
    const linkId = validId(body.linkId)
    const result = await db.profileLink.deleteMany({ where: { id: linkId, userId: me.id } })
    return NextResponse.json({ deleted: result.count > 0 })
  }

  if (action === "showcase") {
    const kind = clean(body.kind, 40)
    const refId = clean(body.refId, 160)
    const label = clean(body.label, 120)
    const allowed = ["game", "achievement", "badge", "cosmetic"]
    if (!allowed.includes(kind) || !refId || !label) return fail("Invalid showcase item")
    if (kind === "achievement" && !await db.userAchievement.findUnique({ where: { userId_achievementId: { userId: me.id, achievementId: refId } } })) return fail("Achievement not earned", 403)
    const row = await db.profileShowcase.upsert({ where: { userId_kind_refId: { userId: me.id, kind, refId } }, update: { label, position: Math.max(0, Math.min(20, Number(body.position) || 0)) }, create: { userId: me.id, kind, refId, label, position: Math.max(0, Math.min(20, Number(body.position) || 0)) } })
    return NextResponse.json({ showcase: row })
  }

  if (action === "delete-showcase") {
    const showcaseId = validId(body.id)
    const result = await db.profileShowcase.deleteMany({ where: { id: showcaseId, userId: me.id } })
    return NextResponse.json({ deleted: result.count > 0 })
  }

  if (action === "toggle-cosmetic-favorite" || action === "toggle-cosmetic-wishlist") {
    const itemType = clean(body.itemType, 40)
    const itemId = clean(body.itemId, 160)
    if (!itemType || !itemId) return fail("Invalid cosmetic")
    const model = action.includes("wishlist") ? db.cosmeticWishlist : db.cosmeticFavorite
    const key = { userId_itemType_itemId: { userId: me.id, itemType, itemId } }
    const existing = await (model as any).findUnique({ where: key })
    if (existing) await (model as any).delete({ where: { id: existing.id } })
    else await (model as any).create({ data: { userId: me.id, itemType, itemId } })
    return NextResponse.json({ active: !existing })
  }

  if (action === "save-loadout") {
    const name = clean(body.name, 60)
    if (!name) return fail("Loadout name required")
    const count = await db.cosmeticLoadout.count({ where: { userId: me.id } })
    if (count >= 20) return fail("Loadout limit reached", 409)
    const state = { avatarDeco: clean(body.avatarDeco, 200) || null, profileEffect: clean(body.profileEffect, 200) || null, themePrimary: clean(body.themePrimary, 30), themeAccent: clean(body.themeAccent, 30), themeStyle: body.themeStyle === "gradient" ? "gradient" : "solid" }
    const row = await db.cosmeticLoadout.create({ data: { userId: me.id, name, stateJson: JSON.stringify(state) } })
    return NextResponse.json({ loadout: row })
  }

  if (action === "apply-loadout") {
    const loadoutId = validId(body.id)
    const row = loadoutId ? await db.cosmeticLoadout.findFirst({ where: { id: loadoutId, userId: me.id } }) : null
    if (!row) return fail("Loadout not found", 404)
    let state: any
    try { state = JSON.parse(row.stateJson) } catch { return fail("Loadout data is invalid", 409) }
    for (const pair of [["avatar_deco", state.avatarDeco], ["profile_effect", state.profileEffect]] as const) {
      if (!pair[1]) continue
      if (!isMod(me.role) && !await userOwnsItem(me.id, pair[0], pair[1])) return fail(`Loadout contains an unowned ${pair[0].replace("_", " ")}`, 403)
    }
    await db.user.update({ where: { id: me.id }, data: { avatarDeco: state.avatarDeco || null, profileEffect: state.profileEffect || null, profileThemePrimary: state.themePrimary || me.profileThemePrimary, profileThemeAccent: state.themeAccent || me.profileThemeAccent, profileThemeStyle: state.themeStyle === "gradient" ? "gradient" : "solid" } })
    return NextResponse.json({ ok: true })
  }

  return fail("Unknown action", 404)
}
