import { db } from "./db"
import { DEFAULT_PRESENCE_CONFIG, normalizePresenceConfig } from "./presence"
import { getPreference, setPreference, safeJson } from "./feature-platform"

export const AUTOMATION_TRIGGER_TYPES = ["time_of_day", "game_launch", "message_contains", "friend_online", "credits_at_least", "panel_open"] as const
export const AUTOMATION_ACTION_TYPES = ["set_presence", "open_panel", "mute_music", "set_theme", "set_setting", "notify"] as const
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number]
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number]

type JsonObject = Record<string, unknown>

function obj(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}
function text(value: unknown, max = 160): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}
function int(value: unknown, min: number, max: number, fallback = 0): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}
function stringList(value: unknown, maxItems = 20, maxLength = 80): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((x) => text(x, maxLength).toLowerCase()).filter(Boolean))].slice(0, maxItems)
}

export function normalizeAutomationTrigger(type: string, value: unknown): JsonObject {
  const input = obj(value)
  if (type === "time_of_day") return {
    hour: int(input.hour, 0, 23, 8),
    minute: int(input.minute, 0, 59, 0),
    days: Array.isArray(input.days) ? [...new Set(input.days.map((x) => int(x, 0, 6, -1)).filter((x) => x >= 0))].slice(0, 7) : [],
  }
  if (type === "game_launch") return { gameId: text(input.gameId, 128), gameName: text(input.gameName, 120) }
  if (type === "message_contains") return { words: stringList(input.words), direction: input.direction === "incoming" ? "incoming" : input.direction === "outgoing" ? "outgoing" : "any" }
  if (type === "friend_online") return { friendId: text(input.friendId, 128), username: text(input.username, 64) }
  if (type === "credits_at_least") return { amount: int(input.amount, 0, 1_000_000_000, 1000) }
  if (type === "panel_open") return { panel: text(input.panel, 40) }
  return {}
}

export function normalizeAutomationAction(type: string, value: unknown): JsonObject {
  const input = obj(value)
  if (type === "set_presence") return {
    mode: text(input.mode, 40) || "online",
    status: text(input.status, 180),
    durationMinutes: int(input.durationMinutes, 0, 1440, 0),
  }
  if (type === "open_panel") return { panel: text(input.panel, 40) || "chat" }
  if (type === "mute_music") return { mute: input.mute !== false }
  if (type === "set_theme") return { theme: text(input.theme, 64) || "blood" }
  if (type === "set_setting") return { key: text(input.key, 120), value: input.value }
  if (type === "notify") return { title: text(input.title, 100) || "Synnical automation", body: text(input.body, 400) }
  return {}
}

function triggerMatches(type: string, config: JsonObject, payload: JsonObject): boolean {
  if (type === "game_launch") {
    const wantedId = text(config.gameId, 128)
    const wantedName = text(config.gameName, 120).toLowerCase()
    if (wantedId && wantedId !== text(payload.gameId, 128)) return false
    if (wantedName && !text(payload.gameName, 120).toLowerCase().includes(wantedName)) return false
    return Boolean(wantedId || wantedName || payload.gameId)
  }
  if (type === "message_contains") {
    const direction = text(config.direction, 20) || "any"
    const actualDirection = text(payload.direction, 20)
    if (direction !== "any" && actualDirection && direction !== actualDirection) return false
    const words = stringList(config.words)
    const body = text(payload.content, 4000).toLowerCase()
    return words.length > 0 && words.some((word) => body.includes(word))
  }
  if (type === "friend_online") {
    const friendId = text(config.friendId, 128)
    const username = text(config.username, 64).toLowerCase()
    if (friendId) return friendId === text(payload.friendId, 128)
    return Boolean(username && username === text(payload.username, 64).toLowerCase())
  }
  if (type === "credits_at_least") return Number(payload.coins || 0) >= int(config.amount, 0, 1_000_000_000, 0)
  if (type === "panel_open") return text(config.panel, 40) === text(payload.panel, 40)
  if (type === "time_of_day") {
    const now = payload.now instanceof Date ? payload.now : new Date(typeof payload.now === "string" ? payload.now : Date.now())
    const days = Array.isArray(config.days) ? config.days.map(Number) : []
    return int(config.hour, 0, 23, 8) === now.getHours()
      && int(config.minute, 0, 59, 0) === now.getMinutes()
      && (!days.length || days.includes(now.getDay()))
  }
  return false
}

async function executeRule(rule: { id: string; userId: string; name: string; actionType: string; actionJson: string; cooldownSeconds: number; lastRunAt: Date | null }, triggerType: string) {
  const action = normalizeAutomationAction(rule.actionType, safeJson(rule.actionJson, {}))
  const now = new Date()
  const claimed = await db.automationRule.updateMany({
    where: {
      id: rule.id,
      enabled: true,
      OR: [{ lastRunAt: null }, { lastRunAt: { lte: new Date(now.getTime() - Math.max(1, rule.cooldownSeconds) * 1000) } }],
    },
    data: { lastRunAt: now },
  })
  if (!claimed.count) return null

  if (rule.actionType === "set_presence") {
    const previous = normalizePresenceConfig(await getPreference(rule.userId, "presence.config", DEFAULT_PRESENCE_CONFIG))
    const duration = int(action.durationMinutes, 0, 1440, 0)
    const next = normalizePresenceConfig({
      ...previous,
      mode: text(action.mode, 40) || previous.mode,
      modeExpiresAt: duration ? new Date(Date.now() + duration * 60000).toISOString() : null,
    })
    const previousUser = await db.user.findUnique({ where: { id: rule.userId }, select: { status: true, statusExpiresAt: true } })
    await setPreference(rule.userId, "presence.config", next)
    const profileStatus = text(action.status, 180)
    if (profileStatus) {
      await db.user.update({ where: { id: rule.userId }, data: { status: profileStatus, statusExpiresAt: duration ? new Date(Date.now() + duration * 60000) : null } })
    }
    return db.automationRun.create({
      data: { ruleId: rule.id, userId: rule.userId, triggerType, actionType: rule.actionType, status: "success", summary: `Set presence from ${rule.name}`, undoJson: JSON.stringify({ kind: "presence", config: previous, userStatus: previousUser }) },
    })
  }

  // Browser-owned actions are claimed by AutomationBridge. Keeping these as
  // persisted jobs means a server trigger can safely hand work to the user's
  // signed-in browser without pretending Node can control that browser itself.
  return db.automationRun.create({
    data: { ruleId: rule.id, userId: rule.userId, triggerType, actionType: rule.actionType, status: "pending_client", summary: rule.name.slice(0, 180), undoJson: JSON.stringify({ pendingAction: action }) },
  })
}

export async function runAutomationTrigger(userId: string, triggerType: AutomationTriggerType | string, payload: JsonObject = {}) {
  if (!(AUTOMATION_TRIGGER_TYPES as readonly string[]).includes(triggerType)) return []
  if (await getPreference(userId, "automation.killSwitch", false)) return []
  const rules = await db.automationRule.findMany({ where: { userId, enabled: true, triggerType }, orderBy: { createdAt: "asc" }, take: 100 })
  const runs: Array<{ id: string }> = []
  for (const rule of rules) {
    const trigger = normalizeAutomationTrigger(rule.triggerType, safeJson(rule.triggerJson, {}))
    if (!triggerMatches(rule.triggerType, trigger, payload)) continue
    const run = await executeRule(rule, triggerType)
    if (run) runs.push(run)
  }
  return runs
}

export async function runDueAutomations(now = new Date()) {
  const rules = await db.automationRule.findMany({ where: { enabled: true, triggerType: { in: ["time_of_day", "credits_at_least"] } }, take: 500 })
  const users = [...new Set(rules.map((r) => r.userId))]
  const killRows = await db.userPreference.findMany({ where: { userId: { in: users }, key: "automation.killSwitch", value: "true" }, select: { userId: true } })
  const killed = new Set(killRows.map((row) => row.userId))
  const coinUsers = await db.user.findMany({ where: { id: { in: users } }, select: { id: true, coins: true } })
  const coins = new Map(coinUsers.map((u) => [u.id, u.coins]))
  let executed = 0
  for (const rule of rules) {
    if (killed.has(rule.userId)) continue
    const trigger = normalizeAutomationTrigger(rule.triggerType, safeJson(rule.triggerJson, {}))
    const payload = rule.triggerType === "time_of_day" ? { now } : { coins: coins.get(rule.userId) || 0 }
    if (!triggerMatches(rule.triggerType, trigger, payload)) continue
    const run = await executeRule(rule, rule.triggerType)
    if (run) executed += 1
  }
  return executed
}

export async function undoAutomationRun(userId: string, runId: string) {
  const run = await db.automationRun.findFirst({ where: { id: runId, userId } })
  if (!run || run.status !== "success") return null
  const undo = safeJson<Record<string, unknown>>(run.undoJson, {})
  if (undo.kind === "presence" && undo.config) {
    await setPreference(userId, "presence.config", undo.config)
    if (undo.userStatus && typeof undo.userStatus === "object") {
      const row = undo.userStatus as { status?: unknown; statusExpiresAt?: unknown }
      await db.user.update({ where: { id: userId }, data: { status: text(row.status, 180), statusExpiresAt: row.statusExpiresAt ? new Date(String(row.statusExpiresAt)) : null } }).catch(() => {})
    }
    await db.automationRun.update({ where: { id: run.id }, data: { status: "undone" } })
    return { server: true }
  }
  if (undo.clientUndo && typeof undo.clientUndo === "object") {
    const pending = await db.automationRun.create({ data: { ruleId: run.ruleId, userId, triggerType: "undo", actionType: "apply_undo", status: "pending_client", summary: `Undo ${run.summary}`, undoJson: JSON.stringify({ pendingAction: undo.clientUndo }) } })
    await db.automationRun.update({ where: { id: run.id }, data: { status: "undone" } })
    return { server: false, runId: pending.id }
  }
  return null
}
