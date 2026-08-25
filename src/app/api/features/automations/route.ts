import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { db } from "@/lib/db"
import { getPreference, safeJson, setPreference } from "@/lib/feature-platform"
import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  normalizeAutomationAction,
  normalizeAutomationTrigger,
  runAutomationTrigger,
  undoAutomationRun,
} from "@/lib/automation-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_RULES = 100
const PANELS = new Set(["discover", "browser", "games", "chat", "friends", "spaces", "moderation", "temp-mail", "movies", "synnime", "music", "ai", "shop", "market", "drive", "profile", "lab", "settings", "linux-vm"])
const SETTING_PREFIXES = ["a11y.", "perf.", "layout.", "notifications."]

function text(value: unknown, max = 160) { return typeof value === "string" ? value.trim().slice(0, max) : "" }
function obj(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }) }

function sanitizePermission(value: unknown) {
  const input = obj(value)
  return {
    allowClientActions: input.allowClientActions !== false,
    allowedPanels: Array.isArray(input.allowedPanels) ? input.allowedPanels.map((x) => text(x, 40)).filter((x) => PANELS.has(x)).slice(0, 20) : [],
    allowedSettingPrefixes: Array.isArray(input.allowedSettingPrefixes)
      ? input.allowedSettingPrefixes.map((x) => text(x, 80)).filter((x) => SETTING_PREFIXES.some((p) => x.startsWith(p))).slice(0, 20)
      : SETTING_PREFIXES,
  }
}

function naturalRule(input: string) {
  const raw = input.trim().slice(0, 800)
  const lower = raw.toLowerCase()
  let triggerType = ""
  let trigger: Record<string, unknown> = {}
  let actionType = ""
  let action: Record<string, unknown> = {}

  const time = lower.match(/(?:at|every day at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  if (time) {
    let hour = Number(time[1])
    if (time[3] === "pm" && hour < 12) hour += 12
    if (time[3] === "am" && hour === 12) hour = 0
    if (hour >= 0 && hour <= 23) { triggerType = "time_of_day"; trigger = { hour, minute: Number(time[2] || 0), days: [] } }
  }
  const launch = lower.match(/(?:when|whenever)\s+(?:i\s+)?(?:launch|start|play)\s+(.+?)(?:,|\s+then\s+|\s+mute\s+|\s+open\s+|\s+switch\s+|$)/)
  if (!triggerType && launch?.[1]) { triggerType = "game_launch"; trigger = { gameName: launch[1].trim() } }
  const words = lower.match(/(?:when|if)\s+(?:a\s+)?message\s+(?:contains|says|includes)\s+["']?(.+?)["']?(?:,|\s+then\s+|$)/)
  if (!triggerType && words?.[1]) { triggerType = "message_contains"; trigger = { words: [words[1].trim()], direction: "any" } }
  const friend = lower.match(/(?:when|if)\s+@?([a-z0-9_.-]{2,32})\s+(?:comes|is)\s+online/)
  if (!triggerType && friend?.[1]) { triggerType = "friend_online"; trigger = { username: friend[1] } }
  const credits = lower.match(/(?:when|if)\s+(?:my\s+)?credits?\s+(?:reach|hit|are at least)\s+(\d+)/)
  if (!triggerType && credits?.[1]) { triggerType = "credits_at_least"; trigger = { amount: Number(credits[1]) } }

  if (/mute\s+(?:synnical\s+)?music/.test(lower)) { actionType = "mute_music"; action = { mute: true } }
  const open = lower.match(/open\s+(chat|friends|games|movies|synnflix|synnime|anime|music|browser|shop|marketplace|drive|files|profile|settings|spaces|synn vm|linux vm|vm)/)
  if (!actionType && open?.[1]) {
    const panel = open[1] === "synnflix" ? "movies"
      : open[1] === "anime" ? "synnime"
      : open[1] === "marketplace" ? "market"
      : open[1] === "files" ? "drive"
      : open[1] === "synn vm" || open[1] === "linux vm" || open[1] === "vm" ? "linux-vm"
      : open[1]
    actionType = "open_panel"; action = { panel }
  }
  const theme = lower.match(/(?:switch|change|set)\s+(?:my\s+)?theme\s+(?:to\s+)?([a-z0-9_-]+)/)
  if (!actionType && theme?.[1]) { actionType = "set_theme"; action = { theme: theme[1] } }
  const presence = lower.match(/(?:set|change)\s+(?:my\s+)?(?:presence|status)\s+(?:to\s+)?(.+?)$/)
  if (!actionType && presence?.[1]) {
    const value = presence[1]
    const mode = value.includes("play") ? "available_to_play" : value.includes("talk") ? "looking_to_talk" : value.includes("busy") ? "busy" : value.includes("invite") ? "do_not_invite" : "online"
    actionType = "set_presence"; action = { mode, status: "" }
  }
  if (!actionType && /notify|remind/.test(lower)) { actionType = "notify"; action = { title: "Synnical automation", body: raw } }

  if (!triggerType || !actionType) return null
  return {
    name: raw.slice(0, 80),
    triggerType,
    trigger: normalizeAutomationTrigger(triggerType, trigger),
    actionType,
    action: normalizeAutomationAction(actionType, action),
  }
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const [rules, runs, killSwitch, templates] = await Promise.all([
    db.automationRule.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" }, take: MAX_RULES }),
    db.automationRun.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    getPreference(me.id, "automation.killSwitch", false),
    db.featureRecord.findMany({ where: { kind: "automation-template", visibility: "friends" }, orderBy: { updatedAt: "desc" }, take: 30 }),
  ])
  const authorIds = [...new Set(templates.map((x) => x.userId))]
  const authors = await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, username: true, displayName: true } })
  const byId = new Map(authors.map((u) => [u.id, u]))
  return NextResponse.json({
    killSwitch,
    triggers: AUTOMATION_TRIGGER_TYPES,
    actions: AUTOMATION_ACTION_TYPES,
    rules: rules.map((rule) => ({ ...rule, trigger: safeJson(rule.triggerJson, {}), action: safeJson(rule.actionJson, {}), permission: safeJson(rule.permissionJson, {}) })),
    runs,
    templates: templates.map((row) => ({ id: row.id, title: row.title, data: safeJson(row.dataJson, {}), author: byId.get(row.userId) || null })),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = text(body.action, 64)

  if (action === "kill-switch") {
    const enabled = body.enabled === true
    await setPreference(me.id, "automation.killSwitch", enabled)
    return NextResponse.json({ killSwitch: enabled })
  }

  if (action === "parse") {
    const parsed = naturalRule(text(body.text, 800))
    if (!parsed) return fail("I couldn't turn that sentence into a safe routine yet. Use a supported trigger and action.")
    return NextResponse.json({ parsed })
  }

  if (action === "save-rule") {
    const id = text(body.id, 128)
    const name = text(body.name, 80)
    const triggerType = text(body.triggerType, 40)
    const actionType = text(body.actionType, 40)
    if (!name) return fail("Give the routine a name")
    if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(triggerType)) return fail("Unsupported trigger")
    if (!(AUTOMATION_ACTION_TYPES as readonly string[]).includes(actionType)) return fail("Unsupported action")
    if (!id && await db.automationRule.count({ where: { userId: me.id } }) >= MAX_RULES) return fail("You already have the maximum number of routines")
    const trigger = normalizeAutomationTrigger(triggerType, body.trigger)
    const nextAction = normalizeAutomationAction(actionType, body.ruleAction)
    if (actionType === "open_panel" && !PANELS.has(text(nextAction.panel, 40))) return fail("That panel cannot be opened by an automation")
    if (actionType === "set_setting" && !SETTING_PREFIXES.some((prefix) => text(nextAction.key, 120).startsWith(prefix))) return fail("That setting is outside the automation permission sandbox")
    const data = {
      name, enabled: body.enabled !== false, triggerType, triggerJson: JSON.stringify(trigger), actionType,
      actionJson: JSON.stringify(nextAction), permissionJson: JSON.stringify(sanitizePermission(body.permission)),
      cooldownSeconds: Math.max(30, Math.min(86400, Math.floor(Number(body.cooldownSeconds) || 60))),
    }
    const rule = id
      ? await db.automationRule.update({ where: { id, userId: me.id }, data }).catch(() => null)
      : await db.automationRule.create({ data: { userId: me.id, ...data } })
    if (!rule) return fail("Routine not found", 404)
    return NextResponse.json({ rule })
  }

  if (action === "delete-rule") {
    const id = text(body.id, 128)
    const deleted = await db.automationRule.deleteMany({ where: { id, userId: me.id } })
    return NextResponse.json({ ok: deleted.count === 1 })
  }

  if (action === "toggle-rule") {
    const id = text(body.id, 128)
    const row = await db.automationRule.findFirst({ where: { id, userId: me.id } })
    if (!row) return fail("Routine not found", 404)
    await db.automationRule.update({ where: { id }, data: { enabled: body.enabled === true } })
    return NextResponse.json({ ok: true })
  }

  if (action === "preview") {
    const triggerType = text(body.triggerType, 40)
    const actionType = text(body.actionType, 40)
    if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(triggerType) || !(AUTOMATION_ACTION_TYPES as readonly string[]).includes(actionType)) return fail("Unsupported routine")
    return NextResponse.json({ preview: { trigger: normalizeAutomationTrigger(triggerType, body.trigger), action: normalizeAutomationAction(actionType, body.ruleAction), affectsOnlyYou: true } })
  }

  if (action === "trigger") {
    const type = text(body.triggerType, 40)
    if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(type)) return fail("Unsupported trigger")
    const runs = await runAutomationTrigger(me.id, type, obj(body.payload))
    return NextResponse.json({ runs: runs.map((run) => run.id) })
  }

  if (action === "claim-client-actions") {
    const pending = await db.automationRun.findMany({ where: { userId: me.id, status: "pending_client" }, orderBy: { createdAt: "asc" }, take: 20 })
    const jobs = pending.map((run) => ({ id: run.id, actionType: run.actionType, action: safeJson<Record<string, unknown>>(run.undoJson, {}).pendingAction || {} }))
    if (pending.length) await db.automationRun.updateMany({ where: { id: { in: pending.map((x) => x.id) }, status: "pending_client" }, data: { status: "delivered_client" } })
    return NextResponse.json({ jobs })
  }

  if (action === "complete-client-action") {
    const id = text(body.id, 128)
    const run = await db.automationRun.findFirst({ where: { id, userId: me.id, status: "delivered_client" } })
    if (!run) return fail("Automation job not found", 404)
    const current = safeJson<Record<string, unknown>>(run.undoJson, {})
    const clientUndo = obj(body.undo)
    await db.automationRun.update({ where: { id }, data: { status: body.ok === false ? "failed" : "success", undoJson: JSON.stringify({ ...current, clientUndo }), summary: text(body.summary, 180) || run.summary } })
    return NextResponse.json({ ok: true })
  }

  if (action === "undo") {
    const result = await undoAutomationRun(me.id, text(body.id, 128))
    if (!result) return fail("That automation run cannot be undone")
    return NextResponse.json({ ok: true, ...result })
  }

  if (action === "share-template") {
    const id = text(body.id, 128)
    const rule = await db.automationRule.findFirst({ where: { id, userId: me.id } })
    if (!rule) return fail("Routine not found", 404)
    const record = await db.featureRecord.create({ data: { userId: me.id, kind: "automation-template", scopeKey: rule.id, title: rule.name, visibility: "friends", dataJson: JSON.stringify({ triggerType: rule.triggerType, trigger: safeJson(rule.triggerJson, {}), actionType: rule.actionType, action: safeJson(rule.actionJson, {}), cooldownSeconds: rule.cooldownSeconds }) } })
    return NextResponse.json({ id: record.id })
  }

  if (action === "import-template") {
    const record = await db.featureRecord.findFirst({ where: { id: text(body.id, 128), kind: "automation-template", visibility: "friends" } })
    if (!record) return fail("Template not found", 404)
    if (record.userId !== me.id) {
      const friendship = await db.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: me.id, receiverId: record.userId }, { requesterId: record.userId, receiverId: me.id }] }, select: { id: true } })
      if (!friendship) return fail("Only friends can import this template", 403)
    }
    if (await db.automationRule.count({ where: { userId: me.id } }) >= MAX_RULES) return fail("You already have the maximum number of routines")
    const data = safeJson<Record<string, unknown>>(record.dataJson, {})
    const triggerType = text(data.triggerType, 40), actionType = text(data.actionType, 40)
    if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(triggerType) || !(AUTOMATION_ACTION_TYPES as readonly string[]).includes(actionType)) return fail("Template is no longer supported")
    const rule = await db.automationRule.create({ data: { userId: me.id, name: `${record.title} (imported)`.slice(0, 80), triggerType, triggerJson: JSON.stringify(normalizeAutomationTrigger(triggerType, data.trigger)), actionType, actionJson: JSON.stringify(normalizeAutomationAction(actionType, data.action)), permissionJson: JSON.stringify(sanitizePermission({})), cooldownSeconds: Math.max(30, Math.min(86400, Number(data.cooldownSeconds) || 60)) } })
    return NextResponse.json({ rule })
  }

  return fail("Unknown action", 404)
}
