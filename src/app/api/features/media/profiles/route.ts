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
    const count = await db.featureRecord.count({ where: { userId: me.id, kind: MEDIA_PROFILE_KIND } })
    if (count >= SYNNFLIX_PROFILE_LIMIT) return fail(`You can have up to ${SYNNFLIX_PROFILE_LIMIT} profiles`, 409)
    const profile = {
      name,
      avatarKey: validSynnFlixAvatarKey(body.avatarKey),
      avatarUrl: null,
      isKids: body.isKids === true,
    }
    const record = await db.featureRecord.create({
      data: {
        userId: me.id,
        kind: MEDIA_PROFILE_KIND,
        scopeKey: "synnflix",
        title: `SynnFlix profile: ${name}`,
        dataJson: profileDataJson(profile),
      },
    })
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
    const profiles = await ensureMediaProfiles(me)
    if (profiles.length <= 1) return fail("Keep at least one profile", 409)
    const listIds = (await db.mediaList.findMany({ where: { userId: me.id, profileId: record.id }, select: { id: true } })).map((row) => row.id)
    await db.$transaction([
      ...(listIds.length ? [db.mediaListItem.deleteMany({ where: { listId: { in: listIds } } })] : []),
      db.mediaList.deleteMany({ where: { userId: me.id, profileId: record.id } }),
      db.mediaRating.deleteMany({ where: { userId: me.id, profileId: record.id } }),
      db.mediaProgress.deleteMany({ where: { userId: me.id, profileId: record.id } }),
      db.featureRecord.delete({ where: { id: record.id } }),
    ])
    const remaining = profiles.filter((profile) => profile.id !== record.id)
    const preferred = await getPreference<string | null>(me.id, ACTIVE_MEDIA_PROFILE_PREFERENCE, null)
    if (preferred === record.id) await setPreference(me.id, ACTIVE_MEDIA_PROFILE_PREFERENCE, remaining[0].id)
    return NextResponse.json({ deleted: true, lastActiveProfileId: preferred === record.id ? remaining[0].id : preferred })
  }

  return fail("Unknown action", 404)
}
