import "server-only"
import { db } from "@/lib/db"
import { getPreference, setPreference } from "@/lib/feature-platform"
import { validSynnFlixAvatarKey, type SynnFlixProfile } from "@/lib/synnflix-profiles"

export const MEDIA_PROFILE_KIND = "media-profile"
export const ACTIVE_MEDIA_PROFILE_PREFERENCE = "media.active-profile.v1"

type ProfileOwner = {
  id: string
  username: string
  displayName: string
  pfpUrl?: string | null
}

type ProfileData = {
  name?: unknown
  avatarKey?: unknown
  avatarUrl?: unknown
  isKids?: unknown
}

function parseData(value: string): ProfileData {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as ProfileData : {}
  } catch {
    return {}
  }
}

export function profileFromRecord(record: { id: string; dataJson: string; createdAt?: Date; updatedAt?: Date }): SynnFlixProfile {
  const data = parseData(record.dataJson)
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 24) : "Profile"
  const avatarUrl = typeof data.avatarUrl === "string" && data.avatarUrl.startsWith("/api/uploads/") ? data.avatarUrl.slice(0, 500) : null
  return {
    id: record.id,
    name,
    avatarKey: validSynnFlixAvatarKey(data.avatarKey),
    avatarUrl,
    isKids: data.isKids === true,
    ...(record.createdAt ? { createdAt: record.createdAt.toISOString() } : {}),
    ...(record.updatedAt ? { updatedAt: record.updatedAt.toISOString() } : {}),
  }
}

export async function migrateLegacyMediaState(userId: string, profileId: string) {
  await db.$transaction([
    db.mediaList.updateMany({ where: { userId, profileId: "" }, data: { profileId } }),
    db.mediaRating.updateMany({ where: { userId, profileId: "" }, data: { profileId } }),
    db.mediaProgress.updateMany({ where: { userId, profileId: "" }, data: { profileId } }),
  ])
}

export async function ensureMediaProfiles(user: ProfileOwner): Promise<SynnFlixProfile[]> {
  let records = await db.featureRecord.findMany({
    where: { userId: user.id, kind: MEDIA_PROFILE_KIND },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 20,
  })
  if (!records.length) {
    const created = await db.featureRecord.create({
      data: {
        userId: user.id,
        kind: MEDIA_PROFILE_KIND,
        scopeKey: "synnflix",
        title: "Default SynnFlix profile",
        dataJson: JSON.stringify({
          name: (user.displayName || user.username || "Profile").trim().slice(0, 24),
          avatarKey: "avatar-001",
          avatarUrl: user.pfpUrl?.startsWith("/api/uploads/") ? user.pfpUrl : null,
          isKids: false,
        }),
      },
    })
    records = [created]
    await setPreference(user.id, ACTIVE_MEDIA_PROFILE_PREFERENCE, created.id)
  }
  await migrateLegacyMediaState(user.id, records[0].id)
  return records.map(profileFromRecord)
}

export async function resolveMediaProfile(user: ProfileOwner, requested: unknown): Promise<SynnFlixProfile> {
  const profiles = await ensureMediaProfiles(user)
  const requestedId = typeof requested === "string" ? requested.trim().slice(0, 128) : ""
  if (requestedId) {
    const match = profiles.find((profile) => profile.id === requestedId)
    if (match) return match
  }
  const preferred = await getPreference<string | null>(user.id, ACTIVE_MEDIA_PROFILE_PREFERENCE, null)
  return profiles.find((profile) => profile.id === preferred) || profiles[0]
}

export async function ownedMediaProfile(userId: string, profileId: unknown) {
  const id = typeof profileId === "string" ? profileId.trim().slice(0, 128) : ""
  if (!id) return null
  return db.featureRecord.findFirst({ where: { id, userId, kind: MEDIA_PROFILE_KIND } })
}

export function profileDataJson(profile: Pick<SynnFlixProfile, "name" | "avatarKey" | "avatarUrl" | "isKids">): string {
  return JSON.stringify({
    name: profile.name.trim().slice(0, 24),
    avatarKey: validSynnFlixAvatarKey(profile.avatarKey),
    avatarUrl: profile.avatarUrl?.startsWith("/api/uploads/") ? profile.avatarUrl.slice(0, 500) : null,
    isKids: profile.isKids === true,
  })
}
