import { db } from "@/lib/db"
import { randomBytes } from "crypto"

export const ACHIEVEMENTS = [
  { id: "first-message", name: "First Words", description: "Send your first message.", icon: "message" },
  { id: "social-five", name: "Social Circle", description: "Have five accepted friends.", icon: "users" },
  { id: "game-hour", name: "Game Time", description: "Play games for a cumulative hour.", icon: "gamepad" },
  { id: "collector-five", name: "Collector", description: "Own five shop items.", icon: "sparkles" },
  { id: "week-streak", name: "Seven Days", description: "Reach a seven-day login streak.", icon: "flame" },
  { id: "poll-voter", name: "Your Vote Counts", description: "Vote in a community poll.", icon: "vote" },
  { id: "event-rsvp", name: "Count Me In", description: "RSVP to a community event.", icon: "calendar" },
  { id: "profile-complete", name: "Made It Yours", description: "Add pronouns, a link, or a profile showcase.", icon: "user" },
] as const

export const WEEKLY_CHALLENGES = [
  { id: "weekly-messages-25", name: "Chatty Week", description: "Send 25 messages this week.", metric: "messages", target: 25, rewardCoins: 50, rewardXp: 75 },
  { id: "weekly-game-60", name: "Game Night", description: "Play 60 minutes this week.", metric: "game_seconds", target: 3600, rewardCoins: 75, rewardXp: 100 },
  { id: "weekly-social-3", name: "Stay Social", description: "Complete 3 social actions this week.", metric: "social_actions", target: 3, rewardCoins: 40, rewardXp: 60 },
] as const

export function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1)
}

export async function ensureFeatureSeeds() {
  for (const item of ACHIEVEMENTS) {
    await db.achievement.upsert({ where: { id: item.id }, update: item, create: item }).catch(() => {})
  }
  for (const item of WEEKLY_CHALLENGES) {
    await db.challenge.upsert({
      where: { id: item.id },
      update: { ...item, period: "weekly", active: true },
      create: { ...item, period: "weekly", active: true },
    }).catch(() => {})
  }
}

export async function getProgress(userId: string) {
  await ensureFeatureSeeds()
  return db.userProgress.upsert({ where: { userId }, update: {}, create: { userId } })
}

export async function addXp(userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return getProgress(userId)
  const progress = await getProgress(userId)
  const xp = progress.xp + Math.floor(amount)
  return db.userProgress.update({ where: { userId }, data: { xp, level: levelForXp(xp) } })
}

export async function earnAchievement(userId: string, achievementId: string) {
  await ensureFeatureSeeds()
  const exists = await db.achievement.findUnique({ where: { id: achievementId } })
  if (!exists) return null
  const earned = await db.userAchievement.upsert({
    where: { userId_achievementId: { userId, achievementId } },
    update: {},
    create: { userId, achievementId },
  })
  return earned
}

export async function advanceChallenge(userId: string, metric: string, amount = 1) {
  if (!Number.isFinite(amount) || amount <= 0) return
  await ensureFeatureSeeds()
  const challenges = await db.challenge.findMany({ where: { active: true, metric } })
  const periodKey = weekKey()
  for (const challenge of challenges) {
    const current = await db.challengeProgress.upsert({
      where: { challengeId_userId_periodKey: { challengeId: challenge.id, userId, periodKey } },
      update: {}, create: { challengeId: challenge.id, userId, periodKey },
    })
    if (current.completedAt) continue
    const next = Math.min(challenge.target, current.progress + Math.floor(amount))
    const completed = next >= challenge.target
    await db.challengeProgress.update({
      where: { id: current.id },
      data: { progress: next, completedAt: completed ? new Date() : null },
    })
    if (completed) {
      if (challenge.rewardCoins) {
        await db.user.update({ where: { id: userId }, data: { coins: { increment: challenge.rewardCoins } } })
        await db.currencyTransaction.create({ data: { userId, amount: challenge.rewardCoins, type: "challenge_reward", description: `Completed challenge: ${challenge.name}` } })
      }
      if (challenge.rewardXp) await addXp(userId, challenge.rewardXp)
    }
  }
}

export async function recordLogin(userId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const progress = await getProgress(userId)
  if (progress.lastLoginDay === today) return progress
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const loginStreak = progress.lastLoginDay === yesterday ? progress.loginStreak + 1 : 1
  const updated = await db.userProgress.update({ where: { userId }, data: { lastLoginDay: today, loginStreak } })
  await addXp(userId, 10)
  if (loginStreak >= 7) await earnAchievement(userId, "week-streak")
  return updated
}

export async function recordGameSeconds(userId: string, seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  if (!safe) return
  const current = await getProgress(userId)
  const total = current.totalGameSeconds + safe
  await db.userProgress.update({ where: { userId }, data: { totalGameSeconds: total } })
  await addXp(userId, Math.max(1, Math.floor(safe / 60)))
  await advanceChallenge(userId, "game_seconds", safe)
  if (total >= 3600) await earnAchievement(userId, "game-hour")
}

export async function setPreference(userId: string, key: string, value: unknown) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  return db.userPreference.upsert({
    where: { userId_key: { userId, key } },
    update: { value: serialized },
    create: { userId, key, value: serialized },
  })
}

export async function getPreference<T>(userId: string, key: string, fallback: T): Promise<T> {
  const row = await db.userPreference.findUnique({ where: { userId_key: { userId, key } } })
  if (!row) return fallback
  try { return JSON.parse(row.value) as T } catch { return row.value as unknown as T }
}

export async function logSystemEvent(level: "info" | "warn" | "error", source: string, message: string, detail?: unknown) {
  const text = detail === undefined ? null : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 8000)
  await db.systemEvent.create({ data: { level, source: source.slice(0, 120), message: message.slice(0, 1000), detail: text } }).catch(() => {})
}

export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  const match = trimmed.match(/^(\d{1,6})(s|m|h|d|w)$/)
  if (!match) return null
  const value = Number(match[1])
  const factor = match[2] === "s" ? 1000 : match[2] === "m" ? 60000 : match[2] === "h" ? 3600000 : match[2] === "d" ? 86400000 : 604800000
  const ms = value * factor
  return ms > 0 && ms <= 365 * 86400000 ? ms : null
}

export function verificationToken() {
  return `synnical-${randomBytes(18).toString("hex")}`
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}
