import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => readFileSync(path.join(root, file), "utf8")

test("experience batch: game planner is removed without removing game history", () => {
  const games = read("src/components/games-panel.tsx")
  assert.equal(existsSync(path.join(root, "src/components/games-social-panel.tsx")), false)
  assert.doesNotMatch(games, /GamesSocialPanel|Game planner & backlog|Finish goals|Session planner/)
  assert.match(games, /Continue Playing/)
  assert.doesNotMatch(games, /Session history/)
  assert.match(games, /GAME_QUEUE_HTTP_502/)
  assert.match(games, /GAME_PROVIDER_VERIFICATION_COOLDOWN/)
  assert.match(games, /queuedAt: Date\.now\(\)/)
  assert.match(games, /initialStage === "provider_wait" \? 5_000 : 250/)
})

test("experience batch: verification polling handles transient mailbox responses and spaced codes", () => {
  const stratus = read("stratus/api.js")
  assert.match(stratus, /GAME_MAIL_API_BASE/)
  assert.match(stratus, /https:\/\/api\.mail\.gw/)
  assert.match(stratus, /mailTmRequest\("\/messages\?page=1"/)
  assert.match(stratus, /encodeURIComponent\(message\.id\)/)
  assert.match(stratus, /compactBody/)
  assert.match(stratus, /\(\\d\)\\s\+\(\?=\\d\)/)
  assert.match(stratus, /GAME_MAIL_VERIFICATION_TIMEOUT/)
  assert.match(stratus, /createSession .* failed/)
  assert.doesNotMatch(stratus, /Resending verification code|POOL_TARGET\s*=\s*[1-9]/)
})

test("experience batch: game errors keep a safe user message and diagnostic code", () => {
  const games = read("src/components/games-panel.tsx")
  assert.match(games, /state\.code/)
  assert.match(games, /friendlyGameMessage\(structuredMessage/)
  assert.match(games, /new GameRequestError\(obj\.code/)
})

test("experience batch: Continue Watching resumes ten seconds early and can be removed", () => {
  const flix = read("src/components/synnflix-panel.tsx")
  assert.match(flix, /RESUME_REWIND_SECONDS = 10/)
  assert.match(flix, /Math\.floor\(seconds\) - RESUME_REWIND_SECONDS/)
  assert.match(flix, /ContinueWatchingRail/)
  assert.match(flix, /Remove .* from Continue Watching/)
  assert.match(flix, /mediaAction\("reset-progress"/)
  assert.match(flix, /completed !== true/)
  assert.match(flix, /resumeContinueWatching/)
  assert.match(flix, /prepareFreshPlayer\(\)/)
  assert.match(flix, /clearProgress\(\{ media: item, season: null, episode: null, episodeName: null \}, activeProfile\.id\)/)
  assert.match(flix, /clearProgress\(\{ media: item, season: episode\.seasonNumber, episode: episode\.episodeNumber, episodeName: episode\.name \}, activeProfile\.id\)/)
  assert.match(flix, /setSyncedProgress\(replayingCompleted \? undefined : exact \? resumeStartSeconds\(exact\.currentTime\) : undefined\)/)
  assert.match(flix, /setPlayerRevision\(\(value\) => value \+ 1\)/)
})

test("experience batch: desktop starts free-positioned and does not restore old windows by default", () => {
  const desktop = read("src/lib/os-settings.ts")
  const shell = read("src/components/desktop-shell.tsx")
  assert.match(desktop, /desktopAlignGrid: false/)
  assert.match(desktop, /restoreWindows: false/)
  assert.match(shell, /FREE_DESKTOP_MIGRATION_KEY/)
  assert.match(shell, /restoreWindows: false, desktopAlignGrid: false/)
})

test("experience batch: recognition tags include DEV and render icon metadata", () => {
  const tags = read("src/lib/recognition-tags.ts")
  const roleUi = read("src/components/role-ui.tsx")
  const settings = read("src/components/settings-panel.tsx")
  assert.match(tags, /DEV_TAG = "DEV"/)
  assert.match(tags, /canonicalRecognitionTag\(value\)/)
  assert.match(roleUi, /BadgeCheck|Crown|Sparkles|Shield|Code2/)
  assert.match(roleUi, /recognitionMeta/)
  assert.match(roleUi, /Tag className/)
  assert.match(settings, /DEV_TAG/)
})

test("experience batch: browser resets to a fresh session on return", () => {
  const shell = read("src/components/app-shell.tsx")
  const browser = read("src/components/browser-panel.tsx")
  assert.match(shell, /pageshow/)
  assert.match(shell, /synnical-browser-reset/)
  assert.match(browser, /resetBrowserSession/)
  assert.match(browser, /synnical-browser-reset/)
})

test("experience batch: chat optimistic rows reconcile or become visibly failed", () => {
  const client = read("src/components/chat-panel.tsx")
  const server = read("src/lib/chat-server.ts")
  assert.match(client, /id: `pending:\$\{clientNonce\}`/)
  assert.doesNotMatch(client, /Sending…/)
  assert.match(client, /Not sent/)
  assert.match(client, /draftRef\.current/)
  assert.match(client, /value=\{draft\}/)
  assert.match(client, /candidate\.clientNonce === msg\.clientNonce/)
  assert.match(client, /filter\(\(candidate\) => !candidate\.pendingLocal && !candidate\.failedLocal\)/)
  assert.match(server, /normalizedClientNonce/)
  assert.match(server, /Promise\.allSettled\(tasks\)/)
})

test("experience batch: boot is entry-only and lasts 1500 ms", () => {
  const page = read("src/app/page.tsx")
  assert.match(page, /PerformanceNavigationTiming/)
  assert.match(page, /navigation\?\.type !== "navigate"/)
  assert.match(page, /1500/)
  assert.doesNotMatch(page, /sessionStorage|localStorage/)
})
