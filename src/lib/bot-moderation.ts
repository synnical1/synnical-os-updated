import { db } from "./db"
import { moderateAccount, ModerationError } from "./moderation-service"
export function parseModerationCommand(text: string) {
  if (!/^@(mute|unmute|ban|unban)\b/i.test(text)) return null
  const match = /^@(mute|unmute|ban|unban)\s+@([a-z0-9_]{1,32})(?:\s+(\d+[mhd]))?(?:\s+(.+))?$/i.exec(text.trim())
  if (!match) throw new ModerationError("Use @mute @username 15m reason, @unmute @username reason, @ban @username reason, or @unban @username reason")
  const type = match[1].toUpperCase()
  const durationMin = match[3] ? Number(match[3].slice(0,-1)) * ({ m: 1, h: 60, d: 1440 }[match[3].slice(-1).toLowerCase()] || 0) : undefined
  if (type === "MUTE" && (!durationMin || durationMin > 525600)) throw new ModerationError("Mute duration must be between 1 minute and 365 days")
  if (type !== "MUTE" && durationMin !== undefined) throw new ModerationError("Only mute accepts a duration. Bans are permanent.")
  return { type, username: match[2], durationMin, reason: match[4]?.trim() || "Staff command via Synnbot" }
}
export async function runModerationCommand(actorId: string, text: string, commandNonce?: string): Promise<string | null> {
  const command = parseModerationCommand(text)
  if (!command) return null
  // SQL parameter binding and exact matching; display names never select targets.
  const users = await db.$queryRaw<Array<{ id: string; username: string }>>`SELECT id, username FROM User WHERE username = ${command.username} COLLATE NOCASE LIMIT 2`
  if (users.length !== 1) throw new ModerationError(users.length ? "Ambiguous username; select the account in User Management" : "Account not found", 404)
  await moderateAccount(actorId, { ...command, userId: users[0].id, commandNonce })
  return `${command.type.toLowerCase()} applied to @${users[0].username}${command.durationMin ? ` for ${command.durationMin} minutes` : ""}. Your action is recorded in the moderation audit.`
}
