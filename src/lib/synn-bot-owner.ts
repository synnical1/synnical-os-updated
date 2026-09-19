// This is loaded by both Next route handlers and the custom Socket.IO server.
// Do not use Next's `server-only` sentinel here: PM2 runs that server through
// tsx, while the runtime guard still prevents browser imports.
if (typeof window !== "undefined") throw new Error("synn-bot-owner is server-only")

import { createHash, randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { auditData } from "@/lib/audit-log"
import { aiProviderStatus } from "@/lib/ai-provider-pool"
import { SYNNICAL_APPS } from "@/lib/app-registry"

const OWNER_RECORD = "__synn_bot_owner__"
const APP_CONTROL_KIND = "synn-bot-app-control"
const TAG_KIND = "synn-bot-managed-tag"
const OPERATION_KIND = "synn-bot-owner-operation"

type Actor = { id: string; username: string; role: string }
export type OwnerBotContext = Actor & { channelId: string; sourceMessageId?: string; replyToUserId?: string | null }
export type AppControl = { appId: string; enabled: boolean; maintenance: boolean; allowedRoles: string[] }
export type OwnerBotResult = { reply: string; deletedMessageIds?: string[] } | null

type OwnerOperation = {
  id: string
  action: "app-control" | "tag-create" | "tag-assign" | "credits" | "tag-and-credits" | "purge" | "channel-create"
  title: string
  before: unknown
  after: unknown
  undo: Record<string, unknown>
  createdAt: string
}

const safeJson = <T,>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}
const clean = (value: string, max = 500) => value.trim().replace(/\s+/g, " ").slice(0, max)
const plainTag = (value: string) => value.replace(/[^a-z0-9 -]/gi, "").trim().slice(0, 24)
const slug = (value: string) => plainTag(value).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 24)
const roleName = (role: string) => role.trim().toUpperCase().replace(/\s+/g, "_")

function appFromText(text: string) {
  const lower = text.toLowerCase()
  return SYNNICAL_APPS.find((app) => lower.includes(app.label.toLowerCase()) || app.aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))) || null
}

function tagToken(label: string, icon: string, colour: string) {
  return `custom:${slug(label)}:${icon}:${colour}`.slice(0, 96)
}

function parseTags(value: string) {
  const parsed = safeJson<unknown>(value, [])
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string").slice(0, 16) : []
}

function parseColour(text: string) {
  const match = text.match(/\b(pink|red|orange|amber|yellow|green|blue|cyan|purple|violet|white|gray|grey)\b/i)
  return (match?.[1].toLowerCase() || "violet").replace("grey", "gray")
}

function parseIcon(text: string) {
  if (/\bheart\b/i.test(text)) return "heart"
  if (/\bcrown\b/i.test(text)) return "crown"
  if (/\bstar\b/i.test(text)) return "star"
  if (/\bshield\b/i.test(text)) return "shield"
  if (/\bcode\b/i.test(text)) return "code"
  return "tag"
}

async function verifiedOwner(ctx: OwnerBotContext): Promise<Actor | null> {
  const actor = await db.user.findUnique({ where: { id: ctx.id }, select: { id: true, username: true, role: true } })
  return actor?.role === "OWNER" ? actor : null
}

async function saveOperation(actor: Actor, channelId: string, op: OwnerOperation) {
  const id = `owner-op-${createHash("sha256").update(op.id).digest("hex")}`
  await db.featureRecord.upsert({
    where: { id },
    update: { title: op.title, dataJson: JSON.stringify(op), visibility: "private" },
    create: { id, userId: actor.id, kind: OPERATION_KIND, scopeKey: channelId, title: op.title, dataJson: JSON.stringify(op), visibility: "private" },
  })
  return id
}

async function writeAudit(actor: Actor, action: string, reason: string, before: unknown, after: unknown, metadata: unknown) {
  await db.auditLog.create({ data: auditData({ category: "SYNN_BOT_OWNER", action, actor, reason, before, after, metadata }) })
}

export async function getGlobalAppControls(): Promise<AppControl[]> {
  const rows = await db.featureRecord.findMany({ where: { userId: OWNER_RECORD, kind: APP_CONTROL_KIND }, orderBy: { updatedAt: "desc" } })
  const seen = new Set<string>()
  const controls: AppControl[] = []
  for (const row of rows) {
    if (seen.has(row.scopeKey)) continue
    seen.add(row.scopeKey)
    const parsed = safeJson<Partial<AppControl>>(row.dataJson, {})
    if (!SYNNICAL_APPS.some((app) => app.id === row.scopeKey)) continue
    controls.push({
      appId: row.scopeKey,
      enabled: parsed.enabled !== false,
      maintenance: parsed.maintenance === true,
      allowedRoles: Array.isArray(parsed.allowedRoles) ? parsed.allowedRoles.filter((role): role is string => typeof role === "string").slice(0, 8) : [],
    })
  }
  return controls
}

async function getAppControl(appId: string): Promise<AppControl> {
  const row = await db.featureRecord.findFirst({ where: { userId: OWNER_RECORD, kind: APP_CONTROL_KIND, scopeKey: appId }, orderBy: { updatedAt: "desc" } })
  const parsed = row ? safeJson<Partial<AppControl>>(row.dataJson, {}) : {}
  return { appId, enabled: parsed.enabled !== false, maintenance: parsed.maintenance === true, allowedRoles: Array.isArray(parsed.allowedRoles) ? parsed.allowedRoles.filter((role): role is string => typeof role === "string").slice(0, 8) : [] }
}

async function setAppControl(appId: string, next: AppControl) {
  const existing = await db.featureRecord.findFirst({ where: { userId: OWNER_RECORD, kind: APP_CONTROL_KIND, scopeKey: appId }, orderBy: { updatedAt: "desc" } })
  if (existing) return db.featureRecord.update({ where: { id: existing.id }, data: { title: `App control: ${appId}`, dataJson: JSON.stringify(next), visibility: "public" } })
  return db.featureRecord.create({ data: { userId: OWNER_RECORD, kind: APP_CONTROL_KIND, scopeKey: appId, title: `App control: ${appId}`, dataJson: JSON.stringify(next), visibility: "public" } })
}

async function lastManagedTag() {
  const row = await db.featureRecord.findFirst({ where: { userId: OWNER_RECORD, kind: TAG_KIND }, orderBy: { updatedAt: "desc" } })
  return row ? safeJson<{ label?: string; token?: string }>(row.dataJson, {}) : null
}

async function findUser(raw: string) {
  const username = raw.trim().replace(/^@/, "").toLowerCase()
  return /^[a-z0-9_][a-z0-9_.-]{1,31}$/i.test(username) ? db.user.findUnique({ where: { username } }) : null
}

export async function undoOwnerOperation(actor: Actor, channelId: string): Promise<OwnerBotResult> {
  const row = await db.featureRecord.findFirst({ where: { userId: actor.id, kind: OPERATION_KIND, scopeKey: channelId }, orderBy: { updatedAt: "desc" } })
  if (!row) return { reply: "I don’t have a reversible Owner operation in this channel yet." }
  const op = safeJson<OwnerOperation>(row.dataJson, null as never)
  if (!op?.action || !(op.undo && typeof op.undo === "object")) return { reply: "That operation is missing its restore data, so I left everything unchanged." }

  if (op.action === "app-control") {
    const before = op.undo.control as AppControl | undefined
    if (!before?.appId) return { reply: "That app restore point is invalid, so I left it unchanged." }
    await setAppControl(before.appId, before)
  } else if (op.action === "credits") {
    const targetId = String(op.undo.targetId || "")
    const coins = Number(op.undo.coins)
    if (!targetId || !Number.isInteger(coins)) return { reply: "That credit restore point is invalid, so I left it unchanged." }
    await db.user.update({ where: { id: targetId }, data: { coins } })
  } else if (op.action === "tag-and-credits") {
    const targetId = String(op.undo.targetId || "")
    const coins = Number(op.undo.coins)
    const tags = Array.isArray(op.undo.tags) ? op.undo.tags.filter((tag): tag is string => typeof tag === "string") : null
    if (!targetId || !Number.isInteger(coins) || !tags) return { reply: "That combined restore point is invalid, so I left it unchanged." }
    await db.user.update({ where: { id: targetId }, data: { coins, tags: JSON.stringify(tags) } })
  } else if (op.action === "tag-assign") {
    const targetId = String(op.undo.targetId || "")
    const tags = Array.isArray(op.undo.tags) ? op.undo.tags.filter((tag): tag is string => typeof tag === "string") : null
    if (!targetId || !tags) return { reply: "That tag restore point is invalid, so I left it unchanged." }
    await db.user.update({ where: { id: targetId }, data: { tags: JSON.stringify(tags) } })
  } else if (op.action === "tag-create") {
    const tagId = String(op.undo.tagRecordId || "")
    if (!tagId) return { reply: "That tag restore point is invalid, so I left it unchanged." }
    await db.featureRecord.deleteMany({ where: { id: tagId, userId: OWNER_RECORD, kind: TAG_KIND } })
  } else if (op.action === "purge") {
    const messageIds = Array.isArray(op.undo.messageIds) ? op.undo.messageIds.filter((id): id is string => typeof id === "string") : []
    if (!messageIds.length) return { reply: "There were no deleted messages in that restore point." }
    await db.message.updateMany({ where: { id: { in: messageIds }, channelId }, data: { deleted: false } })
  } else if (op.action === "channel-create") {
    const id = String(op.undo.channelId || "")
    if (!id) return { reply: "That channel restore point is invalid, so I left it unchanged." }
    await db.channel.deleteMany({ where: { id, messages: { none: {} } } })
  } else return { reply: "That action cannot be restored automatically." }

  await db.featureRecord.update({ where: { id: row.id }, data: { kind: "synn-bot-owner-operation-undone", title: `Undone: ${op.title}` } })
  await writeAudit(actor, "OWNER_OPERATION_UNDONE", `Undo: ${op.title}`, op.after, op.before, { operationId: row.id, sourceChannelId: channelId })
  return { reply: `Restored the last Owner change: ${op.title}.` }
}

export function providerIdentityReply() {
  const providers = aiProviderStatus()
  const configured = providers.filter((provider) => provider.configured)
  if (!configured.length) return "Synn Bot has no configured completion provider right now."
  return `Synn Bot is using the live Synnical completion pool: ${configured.map((provider) => provider.name).join(", ")}.`
}

export async function getOwnerBotOperations(actorId: string) {
  const rows = await db.featureRecord.findMany({ where: { userId: actorId, kind: OPERATION_KIND }, orderBy: { updatedAt: "desc" }, take: 30 })
  return rows.map((row) => ({ ...safeJson<OwnerOperation>(row.dataJson, { id: row.id, action: "app-control", title: row.title, before: {}, after: {}, undo: {}, createdAt: row.updatedAt.toISOString() }), id: row.id }))
}

/**
 * Deterministic natural-language adapter for the Owner-only administration
 * surface. It intentionally exposes no SQL, shell, network or secret access.
 */
export async function runOwnerJarvisRequest(input: string, ctx: OwnerBotContext): Promise<OwnerBotResult> {
  const text = clean(input, 2_000)
  if (!text) return null
  const lower = text.toLowerCase()
  if (/^(?:\/)?(?:provider|provider status|what provider are you using(?: right now)?\??)$/i.test(text)) return { reply: providerIdentityReply() }
  const actor = await verifiedOwner(ctx)
  if (!actor) return null

  if (/^(?:\/)?(?:undo(?: that| it)?|restore(?: it| that)?|bring it back)$/i.test(lower)) return undoOwnerOperation(actor, ctx.channelId)

  const tagMatch = text.match(/\b(?:make|create)\s+(?:a\s+)?tag\s+(?:called|named)\s+([a-z0-9][a-z0-9 _-]{1,23})/i)
  if (tagMatch) {
    const label = plainTag(tagMatch[1])
    if (!label) return { reply: "Give the tag a short name, like “Donator”." }
    const icon = parseIcon(text), colour = parseColour(text), token = tagToken(label, icon, colour)
    const existing = await db.featureRecord.findFirst({ where: { userId: OWNER_RECORD, kind: TAG_KIND, scopeKey: slug(label) }, orderBy: { updatedAt: "desc" } })
    const record = existing
      ? await db.featureRecord.update({ where: { id: existing.id }, data: { title: label, dataJson: JSON.stringify({ label, icon, colour, token, enabled: true }), visibility: "public" } })
      : await db.featureRecord.create({ data: { userId: OWNER_RECORD, kind: TAG_KIND, scopeKey: slug(label), title: label, dataJson: JSON.stringify({ label, icon, colour, token, enabled: true }), visibility: "public" } })
    const op: OwnerOperation = { id: ctx.sourceMessageId || randomUUID(), action: "tag-create", title: `Created ${label} tag`, before: existing ? safeJson(existing.dataJson, {}) : null, after: { label, icon, colour, token }, undo: { tagRecordId: record.id }, createdAt: new Date().toISOString() }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_TAG_CREATED", `Created ${label} tag`, op.before, op.after, { via: "synn-bot", sourceChannelId: ctx.channelId })
    return { reply: `Done — created the ${label} tag with a ${colour} glow and ${icon} icon. Use “give @user the ${label} tag” to assign it.` }
  }

  const creditMatch = text.match(/\b(?:give|add)\s+@?([a-z0-9_][a-z0-9_.-]{1,31})\b[\s\S]{0,80}?\b(\d{1,7})(k)?\s+credits?\b/i)
  if (creditMatch) {
    const target = await findUser(creditMatch[1])
    const amount = Number(creditMatch[2]) * (creditMatch[3] ? 1_000 : 1)
    if (!target || !Number.isSafeInteger(amount) || amount < 1 || amount > 10_000_000) return { reply: "I need one real user and a credit amount between 1 and 10,000,000." }
    const latestTag = /\btag\s+i\s+just\s+made\b/i.test(text) ? await lastManagedTag() : null
    const beforeTags = parseTags(target.tags)
    const nextTags = latestTag?.label && latestTag.token ? [...beforeTags.filter((tag) => !tag.startsWith(`custom:${slug(latestTag.label!)}:`)), latestTag.token].slice(-16) : beforeTags
    const updated = await db.user.update({ where: { id: target.id }, data: { coins: { increment: amount }, ...(latestTag?.token ? { tags: JSON.stringify(nextTags) } : {}) } })
    const op: OwnerOperation = {
      id: ctx.sourceMessageId || randomUUID(), action: latestTag?.token ? "tag-and-credits" : "credits",
      title: `${latestTag?.label ? `Assigned ${latestTag.label} and added` : "Added"} ${amount.toLocaleString()} credits to @${target.username}`,
      before: { coins: target.coins, tags: beforeTags }, after: { coins: updated.coins, tags: nextTags }, undo: { targetId: target.id, coins: target.coins, tags: beforeTags }, createdAt: new Date().toISOString(),
    }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_CREDITS_GRANTED", op.title, op.before, op.after, { via: "synn-bot", targetUserId: target.id })
    return { reply: `Done — ${latestTag?.label ? `assigned ${latestTag.label} and gave` : "gave"} @${target.username} ${amount.toLocaleString()} credits. Their balance is now ${updated.coins.toLocaleString()}.` }
  }

  const assignMatch = text.match(/\b(?:give|assign)\s+@?([a-z0-9_][a-z0-9_.-]{1,31})\s+(?:the\s+)?(?:tag\s+)?([a-z0-9][a-z0-9 _-]{1,23}|i just made)\b/i)
  if (assignMatch) {
    const target = await findUser(assignMatch[1])
    const requested = clean(assignMatch[2], 24)
    const managed = requested.toLowerCase() === "i just made"
      ? await lastManagedTag()
      : await db.featureRecord.findFirst({ where: { userId: OWNER_RECORD, kind: TAG_KIND, scopeKey: slug(requested) }, orderBy: { updatedAt: "desc" } }).then((row) => row ? safeJson<{ label?: string; token?: string }>(row.dataJson, {}) : null)
    if (!target || !managed?.token || !managed.label) return { reply: target ? "I couldn’t find that managed tag. Create it first, or say “give @user the tag i just made”." : "I couldn’t find that user." }
    const label = managed.label
    const token = managed.token
    const beforeTags = parseTags(target.tags)
    const nextTags = [...beforeTags.filter((tag) => !tag.startsWith(`custom:${slug(label)}:`)), token].slice(-16)
    await db.user.update({ where: { id: target.id }, data: { tags: JSON.stringify(nextTags) } })
    const op: OwnerOperation = { id: ctx.sourceMessageId || randomUUID(), action: "tag-assign", title: `Assigned ${managed.label} to @${target.username}`, before: { tags: beforeTags }, after: { tags: nextTags }, undo: { targetId: target.id, tags: beforeTags }, createdAt: new Date().toISOString() }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_TAG_ASSIGNED", op.title, op.before, op.after, { via: "synn-bot", tag: managed.label, targetUserId: target.id })
    return { reply: `Done — assigned the ${managed.label} tag to @${target.username}.` }
  }

  const app = appFromText(text)
  if (app && /\b(?:delete|disable|hide|remove|bring back|restore|enable|show|under construction|maintenance)\b/i.test(lower)) {
    const before = await getAppControl(app.id)
    const restoring = /\b(?:bring back|restore|enable|show)\b/i.test(lower)
    const maintenance = /\b(?:under construction|maintenance)\b/i.test(lower)
    const restricted = /\b(?:beta testers?|admins?|mods?|owners?)\b/i.test(lower)
    const roles = restricted ? Array.from(lower.matchAll(/\b(owner|head admin|admin|mod|beta tester)\b/g)).map((match) => roleName(match[1])) : []
    const after: AppControl = restoring ? { appId: app.id, enabled: true, maintenance: false, allowedRoles: [] } : { appId: app.id, enabled: restricted || !/\b(?:delete|disable|hide|remove)\b/i.test(lower), maintenance, allowedRoles: roles }
    await setAppControl(app.id, after)
    const op: OwnerOperation = { id: ctx.sourceMessageId || randomUUID(), action: "app-control", title: `${after.enabled ? "Updated" : "Disabled"} ${app.label}`, before, after, undo: { control: before }, createdAt: new Date().toISOString() }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_APP_CONTROL", op.title, before, after, { via: "synn-bot", appId: app.id })
    if (!after.enabled) return { reply: `${app.label} is now disabled for everyone and hidden from the launcher. I saved a restore point; say “undo that” or “bring ${app.label} back” to restore it.` }
    if (after.maintenance) return { reply: `${app.label} is now in an Owner-managed under-construction state. The previous app configuration is saved for undo.` }
    return { reply: `${app.label} is enabled again with its standard visibility restored.` }
  }

  const channelMatch = text.match(/\b(?:make|create)\s+(?:a\s+)?([a-z0-9_-]{2,48})\s+channel\b/i)
  if (channelMatch) {
    const name = channelMatch[1].toLowerCase()
    const announcement = /\bannouncement\b/i.test(lower)
    const allowedRoles = /\badmin(?:s)?\s+only\b/i.test(lower) ? JSON.stringify(["OWNER", "HEAD_ADMIN", "ADMIN"]) : JSON.stringify(["OWNER", "HEAD_ADMIN", "ADMIN", "MOD", "MEMBER"])
    const channel = await db.channel.create({ data: { name, creatorId: actor.id, isAnnouncement: announcement, allowedRoles } }).catch(() => null)
    if (!channel) return { reply: `I couldn’t create #${name}; that channel name is already in use or invalid.` }
    const op: OwnerOperation = { id: ctx.sourceMessageId || randomUUID(), action: "channel-create", title: `Created #${name}`, before: null, after: { id: channel.id, name, allowedRoles }, undo: { channelId: channel.id }, createdAt: new Date().toISOString() }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_CHANNEL_CREATED", op.title, null, op.after, { via: "synn-bot" })
    return { reply: `Done — created #${name}${allowedRoles.includes("MEMBER") ? "" : " for admins only"}.` }
  }

  if (/\bpurge\b|\bdelete\s+(?:the\s+)?last\s+\d+\s+messages?\b/i.test(lower)) {
    const requested = Number(text.match(/\b(?:last\s+)?(\d{1,3})\s+messages?\b/i)?.[1] || 100)
    const take = Math.max(1, Math.min(100, requested))
    const messages = await db.message.findMany({ where: { channelId: ctx.channelId, deleted: false, userId: { not: null } }, orderBy: { createdAt: "desc" }, take, select: { id: true } })
    if (!messages.length) return { reply: "There are no live messages here to purge." }
    const ids = messages.map((message) => message.id)
    await db.message.updateMany({ where: { id: { in: ids } }, data: { deleted: true } })
    const op: OwnerOperation = { id: ctx.sourceMessageId || randomUUID(), action: "purge", title: `Purged ${ids.length} message${ids.length === 1 ? "" : "s"} from this channel`, before: { deleted: false }, after: { deleted: true, ids }, undo: { messageIds: ids }, createdAt: new Date().toISOString() }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_CHANNEL_PURGE", op.title, op.before, op.after, { via: "synn-bot", channelId: ctx.channelId })
    return { reply: `Purged ${ids.length} message${ids.length === 1 ? "" : "s"} from this channel. I saved a restore point.`, deletedMessageIds: ids }
  }

  return null
}
