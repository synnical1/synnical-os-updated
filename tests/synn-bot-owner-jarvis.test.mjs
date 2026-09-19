import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("Owner Jarvis uses typed server operations with audit and reversible snapshots", () => {
  const owner = read("src/lib/synn-bot-owner.ts")
  assert.match(owner, /verifiedOwner/)
  assert.match(owner, /actor\?\.role === "OWNER"/)
  assert.match(owner, /SYNN_BOT_OWNER/)
  assert.match(owner, /synn-bot-owner-operation/)
  assert.match(owner, /undoOwnerOperation/)
  assert.match(owner, /OWNER_CHANNEL_PURGE/)
  assert.match(owner, /OWNER_APP_CONTROL/)
  assert.doesNotMatch(owner, /\$queryRaw|child_process|process\.env|fetch\(/)
})

test("Owner natural language covers tags, credits, app control, purges and truthful providers", () => {
  const owner = read("src/lib/synn-bot-owner.ts")
  assert.match(owner, /make\|create/)
  assert.match(owner, /tag-and-credits/)
  assert.match(owner, /getGlobalAppControls/)
  assert.match(owner, /providerIdentityReply/)
  assert.match(owner, /deletedMessageIds/)
  assert.match(owner, /allowedRoles/)
})

test("chat execution rechecks Owner actions before AI fallback and broadcasts purges", () => {
  const server = read("src/lib/chat-server.ts")
  assert.match(server, /runOwnerJarvisRequest/)
  assert.match(server, /sourceMessageId: created\.id/)
  assert.match(server, /ownerAction\?\.deletedMessageIds/)
  assert.match(server, /ownerAction \|\| botFeature \? null/)
})

test("app visibility and custom tag visuals consume the persisted Owner controls", () => {
  const shell = read("src/components/app-shell.tsx")
  const roles = read("src/components/role-ui.tsx")
  assert.match(shell, /\/api\/features\/bot/)
  assert.match(shell, /Owner-managed maintenance/)
  assert.match(shell, /BETA_TESTER/)
  assert.match(roles, /\^custom:/)
  assert.match(roles, /shadow-\[0_0_11px/)
})

test("the command palette is concise and has real Owner entries", () => {
  const bot = read("src/lib/synn-bot.ts")
  assert.match(bot, /name: "purge"/)
  assert.match(bot, /name: "undo"/)
  assert.match(bot, /name: "provider"/)
  assert.doesNotMatch(bot, /exactly \*\*1,000 commands\*\*/)
})
