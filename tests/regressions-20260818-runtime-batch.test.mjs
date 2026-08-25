import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const read = (name) => fs.readFileSync(path.join(root, name), "utf8")

test("runtime batch: inline poll lookup is not blocked by channelId gate", () => {
  const route = read("src/app/api/features/chat/route.ts")
  const poll = route.indexOf('if (action === "poll-message")')
  const gate = route.indexOf('if (!channelId) return jsonError("channelId required")')
  assert.ok(poll >= 0 && gate >= 0 && poll < gate)
})

test("runtime batch: SynnFlix flushes progress when redirects hide or unload the page", () => {
  const panel = read("src/components/synnflix-panel.tsx")
  assert.match(panel, /flushPlaybackProgress/)
  assert.match(panel, /visibilitychange/)
  assert.match(panel, /pagehide/)
  assert.match(panel, /flushPlaybackProgress\("blur"\)/)
  assert.match(panel, /keepalive: true/)
  assert.match(panel, /activePlayback: playingNow/)
  assert.match(panel, /const genuinelyCompleted = credibleDuration > 0 && currentTime >= credibleDuration \* 0\.92/)
  assert.match(panel, /Provider ad\/pop-under navigation/)
  const media = read("src/app/api/features/media/route.ts")
  assert.match(media, /replayingCompleted/)
  assert.match(media, /activePlayback/)
})

test("runtime batch: chat sends optimistically and ordinary typing avoids redundant state setters", () => {
  const chat = read("src/components/chat-panel.tsx")
  const server = read("src/lib/chat-server.ts")
  assert.match(chat, /pendingLocal: true/)
  assert.match(chat, /clientNonce/)
  assert.match(chat, /candidate\.pendingLocal/)
  assert.match(chat, /pendingMessageTimersRef/)
  assert.match(chat, /failedLocal: true/)
  assert.match(server, /clientNonce: normalizedClientNonce/)
  assert.ok(server.indexOf('await emitAuthorizedChannel(channelId, "message"') < server.indexOf('const tasks: Promise<unknown>\[\]'))
})

test("runtime batch: staff slash moderation is guided and server-backed", () => {
  const chat = read("src/components/chat-panel.tsx")
  for (const command of ["mute", "warn", "ban", "unban"]) assert.match(chat, new RegExp(`name: "${command}"`))
  assert.match(chat, /\/api\/infractions\/create/)
  assert.match(chat, /\/api\/moderation\/unban/)
  assert.match(chat, /Duration: 10m, 2h, 1d/)
  const unban = read("src/app/api/moderation/unban/route.ts")
  assert.match(unban, /rawReason/)
  assert.match(unban, /reason \|\| "Permanent ban revoked from Moderation"/)
})

test("runtime batch: rich presence flows from apps through presence privacy to chat and profiles", () => {
  const presence = read("src/lib/presence.ts")
  const bridge = read("src/components/presence-bridge.tsx")
  const server = read("src/lib/chat-server.ts")
  const synnflix = read("src/components/synnflix-panel.tsx")
  const games = read("src/components/games-panel.tsx")
  const music = read("src/components/music-panel.tsx")
  const chat = read("src/components/chat-panel.tsx")
  const profile = read("src/components/user-profile-modal.tsx")
  assert.match(presence, /RichPresenceActivity/)
  assert.match(bridge, /synnical-rich-presence/)
  assert.match(bridge, /activitySourcesRef/)
  assert.match(synnflix, /source: "synnflix"/)
  assert.match(games, /source: "games"/)
  assert.match(music, /source: "music"/)
  assert.match(server, /activity: null/)
  assert.match(server, /activityBySocket/)
  assert.match(server, /latestActivityForUser/)
  assert.match(server, /normalizeRichPresenceActivity\(payload\.activity\)/)
  assert.match(synnflix, /kind: "watching"/)
  assert.match(games, /kind: "playing"/)
  assert.match(music, /kind: "listening"/)
  assert.match(chat, /u\.activity/)
  assert.match(profile, /Rich Presence/)
})
