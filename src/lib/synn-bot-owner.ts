// This is loaded by both Next route handlers and the custom Socket.IO server.
// Do not use Next's `server-only` sentinel here: PM2 runs that server through
// tsx, while the runtime guard still prevents browser imports.
if (typeof window !== "undefined") throw new Error("synn-bot-owner is server-only")

import { createHash, randomUUID } from "node:crypto"
import { db } from "@/lib/db"
import { auditData } from "@/lib/audit-log"
import { aiProviderStatus } from "@/lib/ai-provider-pool"
import { SYNNICAL_APPS, isCoreOsApp } from "@/lib/app-registry"

const OWNER_RECORD = "__synn_bot_owner__"
const APP_CONTROL_KIND = "synn-bot-app-control"
const TAG_KIND = "synn-bot-managed-tag"
const OPERATION_KIND = "synn-bot-owner-operation"
const CONFIRMATION_KIND = "synn-bot-owner-confirmation"
const CONFIRMATION_TTL_MS = 2 * 60_000

type Actor = { id: string; username: string; role: string }
export type OwnerBotContext = Actor & { channelId: string; sourceMessageId?: string; replyToUserId?: string | null }
export type AppControl = { appId: string; enabled: boolean; maintenance: boolean; allowedRoles: string[] }
export type OwnerBotResult = { reply: string; deletedMessageIds?: string[]; ephemeral?: boolean } | null

type OwnerOperation = {
  id: string
  action: "app-control" | "tag-create" | "tag-assign" | "credits" | "tag-and-credits" | "purge" | "channel-create"
  title: string
  before: unknown
  after: unknown
  undo: Record<string, unknown>
  createdAt: string
}

type OwnerConfirmation = {
  id: string
  action: "purge" | "app-disable"
  title: string
  payload: Record<string, unknown>
  createdAt: string
  expiresAt: string
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
  if (/\b(?:thumbs?\s*[- ]?up|thumbsup|like)\b/i.test(text)) return "thumbs-up"
  if (/\bheart\b/i.test(text)) return "heart"
  if (/\bcrown\b/i.test(text)) return "crown"
  if (/\bstar\b/i.test(text)) return "star"
  if (/\bshield\b/i.test(text)) return "shield"
  if (/\bcode\b/i.test(text)) return "code"
  return "tag"
}

function parseTagLabel(text: string) {
  const intent = /\b(?:make|create|add)\s+(?:a\s+)?tag\b/i
  if (!intent.test(text)) return null
  const patterns = [
    /\btag\s+(?:called|named|that\s+says|saying|with\s+the\s+text)\s+["']?([a-z0-9][a-z0-9 _-]{0,23}?)["']?(?=\s+(?:with|using|and|that\s+has|which\s+has)\b|$)/i,
    /\btag\s+["']?([a-z0-9][a-z0-9 _-]{0,23}?)["']?(?=\s+(?:with|using|and|that\s+has|which\s+has)\b|$)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const label = match?.[1] ? plainTag(match[1]) : ""
    if (label) return label
  }
  return ""
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

function confirmationRecordId(actorId: string, channelId: string) {
  return `owner-confirm-${createHash("sha256").update(`${actorId}:${channelId}`).digest("hex")}`
}

async function clearPendingConfirmation(actor: Actor, channelId: string) {
  await db.featureRecord.deleteMany({ where: { id: confirmationRecordId(actor.id, channelId), userId: actor.id, kind: CONFIRMATION_KIND } })
}

async function getPendingConfirmation(actor: Actor, channelId: string): Promise<OwnerConfirmation | null> {
  const id = confirmationRecordId(actor.id, channelId)
  const row = await db.featureRecord.findUnique({ where: { id } })
  if (!row || row.userId !== actor.id || row.kind !== CONFIRMATION_KIND || row.scopeKey !== channelId) return null
  const pending = safeJson<OwnerConfirmation>(row.dataJson, null as never)
  const expiresAt = pending?.expiresAt ? new Date(pending.expiresAt).getTime() : 0
  if (!pending?.action || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await db.featureRecord.deleteMany({ where: { id } })
    return null
  }
  return pending
}

async function savePendingConfirmation(actor: Actor, channelId: string, pending: OwnerConfirmation) {
  const id = confirmationRecordId(actor.id, channelId)
  await db.featureRecord.upsert({
    where: { id },
    update: { kind: CONFIRMATION_KIND, scopeKey: channelId, title: pending.title, dataJson: JSON.stringify(pending), visibility: "private" },
    create: { id, userId: actor.id, kind: CONFIRMATION_KIND, scopeKey: channelId, title: pending.title, dataJson: JSON.stringify(pending), visibility: "private" },
  })
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
    controls.push(isCoreOsApp(row.scopeKey) ? {
      appId: row.scopeKey,
      enabled: true,
      maintenance: false,
      allowedRoles: [],
    } : {
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
  if (isCoreOsApp(appId)) return { appId, enabled: true, maintenance: false, allowedRoles: [] }
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
    await db.message.updateMany({ where: { id: { in: messageIds }, channelId, deleted: true }, data: { deleted: false } })
  } else if (op.action === "channel-create") {
    const id = String(op.undo.channelId || "")
    if (!id) return { reply: "That channel restore point is invalid, so I left it unchanged." }
    await db.channel.deleteMany({ where: { id, messages: { none: {} } } })
  } else return { reply: "That action cannot be restored automatically." }

  await db.featureRecord.update({ where: { id: row.id }, data: { kind: "synn-bot-owner-operation-undone", title: `Undone: ${op.title}` } })
  await writeAudit(actor, "OWNER_OPERATION_UNDONE", `Undo: ${op.title}`, op.after, op.before, { operationId: row.id, sourceChannelId: channelId })
  return { reply: `Restored the last Owner change: ${op.title}.` }
}

async function confirmPendingOwnerAction(actor: Actor, channelId: string, sourceMessageId?: string): Promise<OwnerBotResult> {
  const pending = await getPendingConfirmation(actor, channelId)
  if (!pending) return { reply: "There isn’t a pending destructive action to confirm, or it expired." }
  await clearPendingConfirmation(actor, channelId)

  if (pending.action === "purge") {
    const purgeAll = pending.payload.purgeAll === true
    const stagedIds = Array.isArray(pending.payload.messageIds) ? pending.payload.messageIds.filter((id): id is string => typeof id === "string") : []
    let ids: string[] = []

    if (purgeAll) {
      const live = await db.message.findMany({ where: { channelId, deleted: false }, orderBy: { createdAt: "desc" }, select: { id: true } })
      ids = live.map((message) => message.id)
    } else {
      const meta = await db.message.findMany({
        where: {
          channelId,
          deleted: false,
          username: "synn-bot",
          userId: null,
          createdAt: { gte: new Date(pending.createdAt) },
        },
        select: { id: true },
      })
      ids = [...new Set([...stagedIds, ...meta.map((message) => message.id), ...(sourceMessageId ? [sourceMessageId] : [])])]
      const live = await db.message.findMany({ where: { id: { in: ids }, channelId, deleted: false }, select: { id: true } })
      ids = live.map((message) => message.id)
    }

    if (!ids.length) return { reply: "Those messages are already gone, so nothing else was deleted.", ephemeral: true }
    await db.message.updateMany({ where: { id: { in: ids }, channelId, deleted: false }, data: { deleted: true } })
    const op: OwnerOperation = { id: pending.id, action: "purge", title: `Purged ${ids.length} message${ids.length === 1 ? "" : "s"} from this channel`, before: { deleted: false }, after: { deleted: true, ids }, undo: { messageIds: ids }, createdAt: new Date().toISOString() }
    await saveOperation(actor, channelId, op)
    await writeAudit(actor, "OWNER_CHANNEL_PURGE", op.title, op.before, op.after, { via: "synn-bot", channelId, confirmed: true, purgeAll })
    return { reply: `Deleted ${ids.length} message${ids.length === 1 ? "" : "s"} for everyone. Say “restore chat” or “undo that” to bring them back.`, deletedMessageIds: ids, ephemeral: true }
  }

  if (pending.action === "app-disable") {
    const appId = String(pending.payload.appId || "")
    const before = pending.payload.before as AppControl | undefined
    const after = pending.payload.after as AppControl | undefined
    const app = SYNNICAL_APPS.find((row) => row.id === appId)
    if (!app || !before || !after || before.appId !== appId || after.appId !== appId || after.enabled !== false) return { reply: "That app-change confirmation is invalid, so nothing was changed." }
    await setAppControl(appId, after)
    const op: OwnerOperation = { id: pending.id, action: "app-control", title: `Disabled ${app.label}`, before, after, undo: { control: before }, createdAt: new Date().toISOString() }
    await saveOperation(actor, channelId, op)
    await writeAudit(actor, "OWNER_APP_CONTROL", op.title, before, after, { via: "synn-bot", appId, confirmed: true })
    return { reply: `Confirmed — ${app.label} is disabled for everyone and hidden from the launcher. Say “undo that” or “bring ${app.label} back” to restore it.` }
  }

  return { reply: "That confirmation type is not supported, so nothing was changed." }
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

  if (/^(?:\/)?(?:confirm|yes,? confirm|confirm it|do it)$/i.test(lower)) return confirmPendingOwnerAction(actor, ctx.channelId, ctx.sourceMessageId)
  if (/^(?:\/)?(?:cancel|never mind|nevermind|don't do it|do not do it)$/i.test(lower)) {
    const pending = await getPendingConfirmation(actor, ctx.channelId)
    await clearPendingConfirmation(actor, ctx.channelId)
    return { reply: pending ? `Cancelled: ${pending.title}. Nothing was changed.` : "There wasn’t a pending destructive action to cancel." }
  }
  if (/^(?:\/)?(?:undo(?: that| it| delete for everyone)?|restore(?: it| that| chat| messages?| deleted messages?)|bring (?:it|the messages?|chat) back)$/i.test(lower)) {
    await clearPendingConfirmation(actor, ctx.channelId)
    return undoOwnerOperation(actor, ctx.channelId)
  }

  const tagLabel = parseTagLabel(text)
  if (tagLabel !== null) {
    const label = tagLabel
    if (!label) return { reply: "Tell me what the tag should say, for example: “make a tag that says First with a thumbs up icon and white glow”." }
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
    if (isCoreOsApp(app.id)) {
      return { reply: `${app.label} is a core Synnical app, so it stays available in the launcher and cannot be disabled or hidden.` }
    }
    const before = await getAppControl(app.id)
    const restoring = /\b(?:bring back|restore|enable|show)\b/i.test(lower)
    const maintenance = /\b(?:under construction|maintenance)\b/i.test(lower)
    const restricted = /\b(?:beta testers?|admins?|mods?|owners?)\b/i.test(lower)
    const roles = restricted ? Array.from(lower.matchAll(/\b(owner|head admin|admin|mod|beta tester)\b/g)).map((match) => roleName(match[1])) : []
    const after: AppControl = restoring ? { appId: app.id, enabled: true, maintenance: false, allowedRoles: [] } : { appId: app.id, enabled: restricted || !/\b(?:delete|disable|hide|remove)\b/i.test(lower), maintenance, allowedRoles: roles }

    if (!after.enabled) {
      const now = new Date()
      const pending: OwnerConfirmation = {
        id: ctx.sourceMessageId || randomUUID(),
        action: "app-disable",
        title: `Disable ${app.label} for everyone`,
        payload: { appId: app.id, before, after },
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString(),
      }
      await savePendingConfirmation(actor, ctx.channelId, pending)
      return { reply: `This will disable ${app.label} for everyone and hide it from the launcher. Reply “confirm” within 2 minutes to continue, or “cancel”. Nothing has changed yet.` }
    }

    await setAppControl(app.id, after)
    const op: OwnerOperation = { id: ctx.sourceMessageId || randomUUID(), action: "app-control", title: `${after.enabled ? "Updated" : "Disabled"} ${app.label}`, before, after, undo: { control: before }, createdAt: new Date().toISOString() }
    await saveOperation(actor, ctx.channelId, op)
    await writeAudit(actor, "OWNER_APP_CONTROL", op.title, before, after, { via: "synn-bot", appId: app.id })
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

  if (/\bpurge\b|\bdelete\s+(?:the\s+)?last\s+\d+\s+messages?\b|\bdelete\s+(?:these\s+)?messages?\s+for\s+everyone\b|\bdelete\s+all\s+messages?\b|\bclear\s+(?:the\s+)?(?:chat|channel)\b/i.test(lower)) {
    const purgeAll = /\bpurge\s+(?:all|everything)\b|\bdelete\s+all\s+messages?\b|\bclear\s+(?:the\s+)?(?:chat|channel)\b/i.test(lower)
    const requested = Number(text.match(/\b(?:last\s+)?(\d{1,3})\s+messages?\b/i)?.[1] || 100)
    const take = Math.max(1, Math.min(100, requested))
    const messages = await db.message.findMany({
      where: { channelId: ctx.channelId, deleted: false },
      orderBy: { createdAt: "desc" },
      ...(purgeAll ? {} : { take }),
      select: { id: true },
    })
    if (!messages.length) return { reply: "There are no live messages here to delete." }
    const ids = messages.map((message) => message.id)
    const now = new Date()
    const pending: OwnerConfirmation = {
      id: ctx.sourceMessageId || randomUUID(),
      action: "purge",
      title: purgeAll ? `Clear all ${ids.length} messages from this channel` : `Delete ${ids.length} message${ids.length === 1 ? "" : "s"} for everyone`,
      payload: { messageIds: ids, purgeAll },
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS).toISOString(),
    }
    await savePendingConfirmation(actor, ctx.channelId, pending)
    return { reply: purgeAll
      ? `This will clear all ${ids.length} current messages in this channel, including Synn Bot messages. Reply “confirm” within 2 minutes to continue, or “cancel”. Nothing has been deleted yet.`
      : `This will delete the requested ${ids.length} messages plus the confirmation chatter for everyone. Reply “confirm” within 2 minutes to continue, or “cancel”. Nothing has been deleted yet.` }
  }

  return null
}
