import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference, setPreference } from "@/lib/feature-platform"
import {
  ACTIVE_MEDIA_PROFILE_PREFERENCE,
  MEDIA_PROFILE_KIND,
  ensureMediaProfiles,
  ownedMediaProfile,
  profileDataJson,
  profileFromRecord,
} from "@/lib/synnflix-profiles-server"
import { unlink } from "node:fs/promises"
import path from "node:path"
import { uploadsDir } from "@/lib/uploads"
import { SYNNFLIX_PROFILE_LIMIT, validSynnFlixAvatarKey } from "@/lib/synnflix-profiles"

export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const cleanName = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 24) : ""

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const profiles = await ensureMediaProfiles(me)
  const preferred = await getPreference<string | null>(me.id, ACTIVE_MEDIA_PROFILE_PREFERENCE, null)
  const lastActiveProfileId = profiles.some((profile) => profile.id === preferred) ? preferred : profiles[0].id
  return NextResponse.json({ profiles, lastActiveProfileId, limit: SYNNFLIX_PROFILE_LIMIT }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = typeof body.action === "string" ? body.action : ""

  if (action === "select") {
    const record = await ownedMediaProfile(me.id, body.profileId)
    if (!record) return fail("Profile not found", 404)
    await setPreference(me.id, ACTIVE_MEDIA_PROFILE_PREFERENCE, record.id)
    return NextResponse.json({ profile: profileFromRecord(record) })
  }

  if (action === "create") {
    const name = cleanName(body.name)
    if (!name) return fail("Profile name required")
    const profile = {
      name,
      avatarKey: validSynnFlixAvatarKey(body.avatarKey),
      avatarUrl: null,
      isKids: body.isKids === true,
    }
    const record = await db.$transaction(async (tx) => {
      const count = await tx.featureRecord.count({ where: { userId: me.id, kind: MEDIA_PROFILE_KIND } })
      if (count >= SYNNFLIX_PROFILE_LIMIT) return null
      return tx.featureRecord.create({
      data: {
        userId: me.id,
        kind: MEDIA_PROFILE_KIND,
        scopeKey: "synnflix",
        title: `SynnFlix profile: ${name}`,
        dataJson: profileDataJson(profile),
      },
      })
    })
    if (!record) return fail(`You can have up to ${SYNNFLIX_PROFILE_LIMIT} profiles`, 409)
    return NextResponse.json({ profile: profileFromRecord(record) })
  }

  if (action === "update") {
    const record = await ownedMediaProfile(me.id, body.profileId)
    if (!record) return fail("Profile not found", 404)
    const current = profileFromRecord(record)
    const name = cleanName(body.name)
    if (!name) return fail("Profile name required")
    const profile = {
      ...current,
      name,
      avatarKey: validSynnFlixAvatarKey(body.avatarKey),
      avatarUrl: body.keepUploadedAvatar === true ? current.avatarUrl : null,
      isKids: body.isKids === true,
    }
    const updated = await db.featureRecord.update({
      where: { id: record.id },
      data: { title: `SynnFlix profile: ${name}`, dataJson: profileDataJson(profile) },
    })
    return NextResponse.json({ profile: profileFromRecord(updated) })
  }

  if (action === "delete") {
    const record = await ownedMediaProfile(me.id, body.profileId)
    if (!record) return fail("Profile not found", 404)
    const result = await db.$transaction(async (tx) => {
      const profiles = await tx.featureRecord.findMany({ where: { userId: me.id, kind: MEDIA_PROFILE_KIND }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
      if (!profiles.some((profile) => profile.id === record.id)) return { error: "Profile not found", status: 404 } as const
      if (profiles.length <= 1) return { error: "Keep at least one profile", status: 409 } as const
      const listIds = (await tx.mediaList.findMany({ where: { userId: me.id, profileId: record.id }, select: { id: true } })).map((row) => row.id)
      await tx.mediaListItem.deleteMany({ where: { listId: { in: listIds } } })
      await tx.mediaList.deleteMany({ where: { userId: me.id, profileId: record.id } })
      await tx.mediaRating.deleteMany({ where: { userId: me.id, profileId: record.id } })
      await tx.mediaProgress.deleteMany({ where: { userId: me.id, profileId: record.id } })
      await tx.featureRecord.deleteMany({ where: { userId: me.id, scopeKey: { startsWith: `${record.id}:` }, kind: { in: ["media-journal", "scene-note", "media-bingo"] } } })
      await tx.featureRecord.delete({ where: { id: record.id } })
      const remaining = profiles.filter((profile) => profile.id !== record.id)
      const where = { userId_key: { userId: me.id, key: ACTIVE_MEDIA_PROFILE_PREFERENCE } }
      const preference = await tx.userPreference.findUnique({ where })
      const lastActiveProfileId = remaining.find((profile) => profile.id === preference?.value)?.id || remaining[0].id
      await tx.userPreference.upsert({ where, update: { value: lastActiveProfileId }, create: { userId: me.id, key: ACTIVE_MEDIA_PROFILE_PREFERENCE, value: lastActiveProfileId } })
      return { lastActiveProfileId } as const
    })
    if (result.error) return fail(result.error, result.status)
    const avatar = profileFromRecord(record).avatarUrl?.split("/").pop()
    if (avatar?.startsWith(`${me.id}-synnflix-${record.id}-`) && !avatar.includes("..")) await unlink(path.join(uploadsDir(), avatar)).catch(() => {})
    return NextResponse.json({ deleted: true, lastActiveProfileId: result.lastActiveProfileId })
  }

  return fail("Unknown action", 404)
}
