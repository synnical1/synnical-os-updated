// Starts the production build against a disposable database and uploads folder.
// Never points at .env data, never creates production users, and cleans up.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServer } from "node:net"
import { randomBytes } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { PrismaClient } from "@prisma/client"
import sharp from "sharp"
import { io } from "socket.io-client"
import WebSocket from "ws"

const root = await mkdtemp(path.join(tmpdir(), "synnical-smoke-"))
const databaseUrl = `file:${path.join(root, "test.db")}`
const reservation = createServer()
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve))
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const base = `http://127.0.0.1:${port}`
const env = { ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl, HOSTNAME: "127.0.0.1", PORT: String(port),
  OWNER_PASSWORD: randomBytes(32).toString("hex"), IDENTITY_HASH_SECRET: randomBytes(32).toString("hex"),
  UPLOAD_DIR: path.join(root, "uploads"), MEDIA_APPROVALS_DIR: path.join(root, "approvals"), STRATUS_DISABLE_ACCOUNT_POOL: "true",
  STRATUS_API_KEY: randomBytes(32).toString("hex"), WISP_ENABLED: "true", WISP_PATH: "/wisp", WISP_NL_PATH: "/wisp-nl", NEXT_PUBLIC_SOCKET_URL: "/socket.io",
  SYNNICAL_NL_SOCKS5_URL: "", TEXT_MODERATION_MODE: "local", TMDB_API_KEY: "", TMDB_API_READ_TOKEN: "", TMDB_READ_TOKEN: "", MEDIA_PLAYBACK_MANIFEST: path.join(root, "playback-fixture.json"), MEDIA_PLAYBACK_ALLOWED_ORIGINS: "https://licensed-media.example",
  OPENAI_API_KEY: "", OPENROUTER_API_KEY: "", GROQ_API_KEY: "", GEMINI_API_KEY: "", PIPED_API_BASE: "", INVIDIOUS_API_BASE: "", COBALT_API_BASE: "" }
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let child
let log = ""
const sockets = []
let checks = 0
const pass = (name) => { checks++; console.log(`PASS ${name}`) }
const noSecrets = (value) => assert.doesNotMatch(JSON.stringify(value), /passwordHash|securityAnswerHash|lockPinHash/)
async function request(route, { cookie, data, method, body, headers = {}, status = 200 } = {}) {
  const response = await fetch(base + route, { method: method || (data !== undefined || body ? "POST" : "GET"),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: data !== undefined ? JSON.stringify(data) : body })
  const text = await response.text()
  assert.equal(response.status, status, `${route}: ${text.slice(0, 300)}`)
  let json; try { json = JSON.parse(text) } catch {}
  return { response, json, text }
}
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)) }, 15000)
    const handler = (value) => { clearTimeout(timer); resolve(value) }
    socket.once(name, handler)
  })
}
function matchingEvent(socket, name, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)) }, 15000)
    const handler = (value) => {
      if (!predicate(value)) return
      clearTimeout(timer)
      socket.off(name, handler)
      resolve(value)
    }
    socket.on(name, handler)
  })
}
try {
  await writeFile(path.join(root, "test.db"), "", { flag: "wx", mode: 0o600 })
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"], { env, stdio: "pipe" })
  assert.equal(await db.user.count(), 0); assert.equal(await db.message.count(), 0)
  pass("fresh schema creates an empty database")
  child = spawn(process.execPath, ["--import", "tsx", "server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.on("data", (chunk) => { log += chunk }); child.stderr.on("data", (chunk) => { log += chunk })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${log.slice(-3000)}`)
    try { if ((await fetch(base + "/api")).ok) break } catch {}
    await delay(250)
    if (attempt === 119) throw new Error("Server did not become ready")
  }
  await request("/")
  const stratusHealth = await request("/api/games/cloud/v1/health")
  assert.equal(stratusHealth.json.status, "ok")
  assert.equal(stratusHealth.json.service, "stratus")
  const stratusGames = await request("/api/games/cloud/v1/games")
  assert.ok(Array.isArray(stratusGames.json) && stratusGames.json.length > 50)
  assert.equal(typeof stratusGames.json[0]?.game_key, "string")
  pass("bundled Stratus cloud-gaming routes are mounted")
  assert.match((await request("/linux-vm")).text, /Coming Soon/)
  assert.equal((await request("/api/auth/me")).json.user, null)
  await request("/api/features/settings", { status: 401 })
  pass("production server, root shell, VM fallback and anonymous authentication")
  const testPassword = randomBytes(24).toString("base64url")
  const accounts = []
  for (const username of ["recoveryalpha", "recoverybeta"]) {
    const result = await request("/api/auth/register", { data: { username, password: testPassword, securityQuestion: "What is the test phrase?", securityAnswer: "disposable sample" } })
    noSecrets(result.json)
    const cookie = result.response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
    accounts.push({ ...result.json.user, cookie })
  }
  const [a, b] = accounts
  const login = await request("/api/auth/login", { data: { username: a.username, password: testPassword } })
  noSecrets(login.json); assert.equal(login.json.user.id, a.id)
  pass("registration and login with sanitized account responses")
  const dailyBefore = (await db.user.findUnique({ where: { id: a.id } })).coins
  const daily = await Promise.all(Array.from({ length: 6 }, () => request("/api/shop/daily", { cookie: a.cookie, data: {} })))
  assert.equal(daily.filter(row => row.json.success).length, 1)
  assert.equal(await db.currencyTransaction.count({ where: { userId: a.id, type: "daily" } }), 1)
  assert.equal((await db.user.findUnique({ where: { id: a.id } })).coins, dailyBefore + 100)
  const tooEarlyDaily = (await request("/api/shop/daily", { cookie: a.cookie, data: {} })).json
  const claimTime = (await db.user.findUnique({ where: { id: a.id } })).lastDailyClaim
  assert.equal(tooEarlyDaily.nextClaim, new Date(claimTime.getTime() + 20 * 3600000).toISOString())
  // Exercise the non-null eligibility predicate and streak receipt under the
  // same contention; a first-ever claim alone misses date-binding regressions.
  await db.user.update({ where: { id: b.id }, data: { lastDailyClaim: new Date(Date.now() - 24 * 3600000) } })
  const streakBefore = (await db.user.findUnique({ where: { id: b.id } })).coins
  const streakClaims = await Promise.all(Array.from({ length: 6 }, () => request("/api/shop/daily", { cookie: b.cookie, data: {} })))
  assert.equal(streakClaims.filter(row => row.json.success).length, 1)
  const streakReceipts = await db.currencyTransaction.findMany({ where: { userId: b.id, type: "daily" } })
  assert.equal(streakReceipts.length, 1)
  assert.equal(streakReceipts[0].amount, 110)
  assert.equal((await db.user.findUnique({ where: { id: b.id } })).coins, streakBefore + 110)

  await db.user.update({ where: { id: a.id }, data: { role: "HEAD_ADMIN" } })
  await db.user.update({ where: { id: b.id }, data: { role: "ADMIN" } })
  await request("/api/moderation/credits", { cookie: a.cookie, data: { userId: b.id, delta: 10 }, status: 403 })
  await db.user.update({ where: { id: a.id }, data: { role: "MEMBER" } })
  await db.user.update({ where: { id: b.id }, data: { role: "MEMBER" } })
  pass("parallel daily claims award exactly once; canonical equal staff ranks cannot adjust credits")
  await request("/api/media/playback?type=movie&id=123", { status: 401 })
  const unavailable = (await request("/api/media/playback?type=movie&id=123", { cookie: a.cookie })).json
  assert.equal(unavailable.available, false); assert.equal(unavailable.source, null)
  await request("/api/media/playback?type=tv&id=123&season=1&episode=0", { cookie: a.cookie, status: 400 })
  await request("/api/media/providers/cineb", { status: 410 })
  pass("authorized playback requires session, validates identity and fails closed without a provider")
  await request("/api/games/cloud/v1/createSession", { data: { game_key: "fixture" }, status: 401 })
  await request("/api/games/cloud/v1/getQueue?uuid=fixture", { status: 401 })
  await request("/api/games/cloud/v1/createSession", { cookie: a.cookie, data: {}, status: 400 })
  await request("/api/games/cloud/v1/getQueue?uuid=fixture", { cookie: a.cookie, status: 404 })
  pass("cloud session routes require Synnical authentication and use a server-only integration key")

  await writeFile(env.MEDIA_PLAYBACK_MANIFEST, JSON.stringify({ "movie:999": { providerId: "disposable-fixture", kind: "file", url: "https://licensed-media.example/sample.mp4" }, "movie:998": { providerId: "disposable-fixture", kind: "embed", url: "https://unapproved.example/player" } }), { mode: 0o600 })
  const approvedPlayback = (await request("/api/media/playback?type=movie&id=999&url=https://unapproved.example", { cookie: a.cookie })).json
  assert.equal(approvedPlayback.source.url, "https://licensed-media.example/sample.mp4")
  assert.equal((await request("/api/media/playback?type=movie&id=998", { cookie: a.cookie })).json.source, null)
  await rm(env.MEDIA_PLAYBACK_MANIFEST)
  pass("playback manifest allows only operator-approved sources and ignores client URL injection")


  assert.equal((await request("/api/features/security", { cookie: a.cookie })).json.pinConfigured, false)
  await request("/api/features/security", { cookie: a.cookie, data: { action: "set-lock-pin", pin: "4729", password: "wrong" }, status: 403 })
  await request("/api/features/security", { cookie: a.cookie, data: { action: "set-lock-pin", pin: "4729", password: testPassword } })
  assert.equal((await request("/api/features/security", { cookie: a.cookie })).json.pinConfigured, true)
  assert.notEqual((await db.user.findUnique({ where: { id: a.id } })).lockPinHash, "4729")
  await request("/api/features/security", { cookie: a.cookie, data: { action: "verify-pin", pin: "4729" } })
  await request("/api/features/security", { data: { action: "verify-pin", pin: "4729" }, status: 401 })
  for (let attempt = 0; attempt < 5; attempt++) await request("/api/features/security", { cookie: b.cookie, data: { action: "verify-pin", pin: "0000" }, headers: { "X-Real-IP": `192.0.2.${attempt}` }, status: 403 })
  await request("/api/features/security", { cookie: b.cookie, data: { action: "verify-pin", pin: "0000" }, headers: { "X-Real-IP": "192.0.2.99" }, status: 429 })
  await request("/api/features/security", { cookie: b.cookie, data: { action: "verify-password", password: testPassword } })
  await request("/api/features/security", { cookie: a.cookie, data: { action: "begin-security-setup", newPassword: "Attack-Password-92" }, status: 410 })
  await request("/api/auth/login", { data: { username: a.username, password: "4729" }, status: 401 })
  pass("PIN requires password setup and an existing session, hashes storage, rate-limits across IPs and never replaces sign-in")

  await request("/api/features/settings", { cookie: a.cookie, data: { accountId: a.id, settings: { "chat.sound": false, "voice.outputVolume": 44 } } })
  assert.equal((await request("/api/features/settings", { cookie: a.cookie })).json.settings["voice.outputVolume"], 44)
  assert.deepEqual((await request("/api/features/settings", { cookie: b.cookie })).json.settings, {})
  await request("/api/features/settings", { cookie: b.cookie, data: { accountId: a.id, settings: { bad: true } }, status: 409 })
  await request("/api/features/settings", { cookie: a.cookie, data: { settings: { bad: {} } }, status: 400 })
  await request("/api/features/settings", { cookie: a.cookie, body: "x".repeat(270000), status: 413 })
  pass("account settings persist, isolate accounts and reject invalid/oversized writes")
  const profileCalls = await Promise.all([1, 2].map(() => request("/api/features/media/profiles", { cookie: a.cookie })))
  assert.equal(profileCalls[0].json.profiles[0].id, profileCalls[1].json.profiles[0].id)
  let profiles = profileCalls[0].json.profiles
  const profileId = profiles[0].id
  for (let index = 1; index < 12; index++) await request("/api/features/media/profiles", { cookie: a.cookie, data: { action: "create", name: `Profile ${index}`, avatarKey: "avatar-100" } })
  profiles = (await request("/api/features/media/profiles", { cookie: a.cookie })).json.profiles
  assert.equal(profiles.length, 12)
  await request("/api/features/media/profiles", { cookie: a.cookie, data: { action: "create", name: "Too many" }, status: 409 })
  await request("/api/features/media/profiles", { cookie: b.cookie, data: { action: "update", profileId, name: "Foreign" }, status: 404 })
  await request(`/api/features/media?profileId=${profileId}`, { cookie: b.cookie, status: 404 })
  pass("SynnFlix default profile race, 12-profile limit and ownership")
  const media = { profileId, mediaType: "movie", mediaId: "123", title: "Disposable Test Film" }
  for (const currentTime of [-1, null, "50", 864001]) await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", currentTime, duration: 100 }, status: 400 })
  await request("/api/features/media", { cookie: b.cookie, data: { ...media, action: "progress", currentTime: 10, duration: 100 }, status: 404 })
  const favorite = (await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "toggle-item", kind: "favorite" } })).json
  await request("/api/features/media", { cookie: b.cookie, data: { ...media, profileId: undefined, action: "toggle-item", listId: favorite.listId }, status: 404 })
  const parallelToggles = await Promise.all(Array.from({ length: 4 }, () => request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "toggle-item", kind: "watchlist", mediaId: "456" } })))
  assert.equal(parallelToggles.filter(row => row.json.active === true).length, 2)
  assert.equal(parallelToggles.filter(row => row.json.active === false).length, 2)
  for (const row of parallelToggles.filter(row => row.json.active)) {
    assert.equal(row.json.item.mediaId, "456")
    assert.equal(row.json.item.title, media.title)
    assert.equal(row.json.item.season, null)
    assert.equal(row.json.item.episode, null)
  }
  const toggledList = await db.mediaList.findFirst({ where: { userId: a.id, profileId, kind: "watchlist" } })
  assert.equal(await db.mediaListItem.count({ where: { listId: toggledList.id, mediaId: "456" } }), 0)
  // Existing SQLite rows can duplicate a nullable unique key. Toggling off must
  // remove the whole matching set without affecting a different title.
  await db.mediaListItem.createMany({ data: ["456", "456", "457"].map(mediaId => ({ listId: toggledList.id, mediaType: "movie", mediaId, title: media.title })) })
  assert.equal((await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "toggle-item", kind: "watchlist", mediaId: "456" } })).json.active, false)
  assert.equal(await db.mediaListItem.count({ where: { listId: toggledList.id, mediaId: "456" } }), 0)
  assert.equal(await db.mediaListItem.count({ where: { listId: toggledList.id, mediaId: "457" } }), 1)
  pass("media rejects corrupt progress, foreign profile/list mutations and duplicate nullable-key toggles")

  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", mediaType: "tv", mediaId: "789", ratingPrediction: 8 } })
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", mediaType: "tv", mediaId: "789", currentTime: 10, duration: 100 }, status: 400 })
  const prediction = await db.mediaProgress.findFirst({ where: { userId: a.id, profileId, mediaType: "tv", mediaId: "789" } })
  assert.equal(prediction.ratingPrediction, 8); assert.equal(prediction.currentTime, 0); assert.equal(prediction.completed, false)
  await db.mediaProgress.delete({ where: { id: prediction.id } })
  pass("TV title rating predictions remain available without creating watched episode progress")


  for (const currentTime of [301, 210]) await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", currentTime, duration: 3600 } })
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", currentTime: 11, duration: 10 } })
  assert.equal((await request(`/api/features/media?profileId=${profileId}`, { cookie: a.cookie })).json.progress[0].completed, false)
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "rate", rating: 8 } })
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "toggle-item", kind: "watchlist" } })
  const firstState = (await request(`/api/features/media?profileId=${profileId}`, { cookie: a.cookie })).json
  assert.equal(firstState.progress[0].currentTime, 301); assert.equal(firstState.ratings[0].rating, 8)
  const secondState = (await request(`/api/features/media?profileId=${profiles[1].id}`, { cookie: a.cookie })).json
  assert.equal(secondState.progress.length, 0); assert.equal(secondState.ratings.length, 0); assert.equal(secondState.lists.length, 0)
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", currentTime: 3550, duration: 3600 } })
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "reset-progress" } })
  await request("/api/features/media", { cookie: a.cookie, data: { ...media, action: "progress", currentTime: 5, duration: 3600 } })
  const replay = (await request(`/api/features/media?profileId=${profileId}`, { cookie: a.cookie })).json.progress[0]
  assert.equal(replay.currentTime, 5); assert.equal(replay.completed, false)
  pass("profile-scoped lists, ratings, monotonic progress and completed replay reset")
  const input = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#3388aa" } }).png().withMetadata().toBuffer()
  const shotForm = new FormData(); shotForm.set("gameId", "fixture-game"); shotForm.set("file", new Blob([input], { type: "image/png" }), "test.png")
  const shot = (await request("/api/features/games/screenshot", { cookie: a.cookie, body: shotForm })).json.screenshot
  const shotUrl = `/api/features/games/screenshot/${shot.id}`
  await request(shotUrl, { status: 401 }); await request(shotUrl, { cookie: b.cookie, status: 404 })
  const shotResponse = await fetch(base + shotUrl, { headers: { Cookie: a.cookie } })
  assert.equal(shotResponse.headers.get("cache-control"), "private, no-store")
  const shotMeta = await sharp(Buffer.from(await shotResponse.arrayBuffer())).metadata()
  assert.equal(shotMeta.format, "webp"); assert.equal(shotMeta.exif, undefined)
  await request(shotUrl, { cookie: b.cookie, method: "PATCH", data: { action: "rename", name: "stolen" }, status: 404 })
  await request(shotUrl, { cookie: a.cookie, method: "PATCH", data: { action: "rename", name: "../invalid" }, status: 400 })
  await request(shotUrl, { cookie: a.cookie, method: "PATCH", data: { action: "rename", name: "My capture" } })
  await request(shotUrl, { cookie: a.cookie, method: "PATCH", data: { action: "purge" }, status: 409 })
  await request(shotUrl, { cookie: a.cookie, method: "DELETE" })
  let games = (await request("/api/features/games", { cookie: a.cookie })).json
  assert.equal(games.screenshots.length, 0); assert.equal(games.recycleScreenshots[0].name, "My capture")
  await request(shotUrl, { cookie: a.cookie, method: "PATCH", data: { action: "restore" } })
  games = (await request("/api/features/games", { cookie: a.cookie })).json
  assert.equal(games.screenshots.length, 1); assert.equal(games.recycleScreenshots.length, 0)
  await request("/api/features/games", { cookie: a.cookie, data: { action: "delete-screenshot", id: shot.id } })
  await request(shotUrl, { cookie: a.cookie, method: "PATCH", data: { action: "purge" } })
  await request(shotUrl, { cookie: a.cookie, status: 404 })
  const invalidShot = new FormData(); invalidShot.set("gameId", "fixture-game"); invalidShot.set("file", new Blob(["not an image"], { type: "image/png" }), "bad.png")
  await request("/api/features/games/screenshot", { cookie: a.cookie, body: invalidShot, status: 400 })
  pass("private sanitized screenshots: ownership, rename validation, recycle, restore, active-purge denial and permanent deletion")

  await mkdir(env.UPLOAD_DIR, { recursive: true })
  const inheritedName = `${a.id}-pfp-original.webp`
  await writeFile(path.join(env.UPLOAD_DIR, inheritedName), "parent avatar")
  const record = await db.featureRecord.findUniqueOrThrow({ where: { id: profileId } })
  await db.featureRecord.update({ where: { id: profileId }, data: { dataJson: JSON.stringify({ ...JSON.parse(record.dataJson), avatarUrl: `/api/uploads/${inheritedName}` }) } })
  const form = new FormData(); form.set("profileId", profileId); form.set("file", new Blob([input], { type: "image/png" }), "sample.png")
  const uploaded = (await request("/api/features/media/profiles/upload", { cookie: a.cookie, body: form })).json.profile.avatarUrl
  const bytes = Buffer.from(await (await fetch(base + uploaded)).arrayBuffer())
  const metadata = await sharp(bytes).metadata()
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512); assert.equal(metadata.exif, undefined)
  assert.equal(await readFile(path.join(env.UPLOAD_DIR, inheritedName), "utf8"), "parent avatar")
  const malformed = new FormData(); malformed.set("profileId", profileId); malformed.set("file", new Blob(["<svg onload=alert(1)></svg>"], { type: "image/png" }), "bad.png")
  await request("/api/features/media/profiles/upload", { cookie: a.cookie, body: malformed, status: 400 })
  await symlink(path.join(root, "test.db"), path.join(env.UPLOAD_DIR, "secret.png"))
  await request("/api/uploads/secret.png", { status: 404 })
  await request("/api/uploads/game-screenshots-private/sample.png", { status: 404 })
  pass("image decode/resize/metadata stripping, inherited avatar preservation, unsafe file rejection")
  const channel = await db.channel.create({ data: { name: "recovery-public" } })
  const privateChannel = await db.channel.create({ data: { name: "recovery-private", isGroup: true } })
  await db.membership.create({ data: { channelId: privateChannel.id, userId: a.id } })
  await request(`/api/chat/messages?channelId=${privateChannel.id}`, { cookie: b.cookie, status: 403 })
  const msg = await db.message.create({ data: { channelId: channel.id, userId: a.id, username: a.username, content: "Recovery sample" } })
  for (const route of [`/api/features/chat?action=search&channelId=${channel.id}`, `/api/features/chat?action=thread&messageId=${msg.id}`]) noSecrets((await request(route, { cookie: b.cookie })).json)
  await request("/api/features/chat", { cookie: b.cookie, data: { action: "toggle-save", messageId: msg.id } })
  noSecrets((await request("/api/features/chat?action=saved", { cookie: b.cookie })).json)
  const poll = await db.poll.create({ data: { channelId: channel.id, messageId: msg.id, createdById: a.id, question: "Sample?" } })
  assert.equal((await request(`/api/features/chat?action=poll-message&messageId=${msg.id}`, { cookie: b.cookie })).json.poll.id, poll.id)
  pass("HTTP channel authorization, sanitized search/thread/saved responses and inline polls")

  const edit = { id: msg.id, content: "An authorized edited recovery message" }
  await request("/api/messages/edit", { cookie: a.cookie, method: "PATCH", data: edit })
  assert.equal(await db.messageEditHistory.count({ where: { messageId: msg.id } }), 1)
  await request("/api/messages/edit", { cookie: b.cookie, method: "PATCH", data: edit, status: 403 })
  await db.user.update({ where: { id: a.id }, data: { muted: true, mutedUntil: new Date(Date.now() + 60000) } })
  await request("/api/messages/edit", { cookie: a.cookie, method: "PATCH", data: edit, status: 403 })
  await db.user.update({ where: { id: a.id }, data: { muted: false, mutedUntil: null } })
  await db.channel.update({ where: { id: channel.id }, data: { isAnnouncement: true } })
  await request("/api/messages/edit", { cookie: a.cookie, method: "PATCH", data: edit, status: 403 })
  await db.channel.update({ where: { id: channel.id }, data: { isAnnouncement: false } })
  await db.message.update({ where: { id: msg.id }, data: { deleted: true } })
  await request("/api/messages/edit", { cookie: a.cookie, method: "PATCH", data: edit, status: 404 })
  await db.message.update({ where: { id: msg.id }, data: { deleted: false } })
  pass("HTTP edits preserve history and reject foreign authors, active mutes, announcements and deleted messages")

  await request("/api/features/security", { cookie: a.cookie, data: { action: "set-lockdown", enabled: true, password: testPassword } })
  await request("/api/messages/edit", { cookie: a.cookie, method: "PATCH", data: edit, status: 403 })
  await request("/api/features/security", { cookie: a.cookie, data: { action: "set-lockdown", enabled: false, password: testPassword } })
  const blockedDm = await db.channel.create({ data: { name: "blocked-edit-fixture", isDM: true } })
  await db.membership.createMany({ data: [{ channelId: blockedDm.id, userId: a.id }, { channelId: blockedDm.id, userId: b.id }] })
  const blockedMessage = await db.message.create({ data: { channelId: blockedDm.id, userId: a.id, username: a.username, content: "Earlier DM" } })
  await db.block.create({ data: { blockerId: b.id, blockedId: a.id } })
  await request("/api/messages/edit", { cookie: a.cookie, method: "PATCH", data: { ...edit, id: blockedMessage.id }, status: 403 })
  await db.block.deleteMany({ where: { blockerId: b.id, blockedId: a.id } })
  pass("HTTP edits obey emergency lockdown and peer DM blocks")


  const socket = io(base, { autoConnect: false, transports: ["websocket"], extraHeaders: { Cookie: a.cookie }, reconnection: false })
  sockets.push(socket); const connected = event(socket, "connect"); socket.connect(); await connected
  const history = event(socket, "message-history"); socket.emit("join-channel", { channelId: channel.id, history: true }); await history
  const clientNonce = randomBytes(16).toString("hex")
  const payload = { channelId: channel.id, content: "A normal recovery test message", clientNonce }
  let sent = event(socket, "message"); socket.emit("send-message", payload); const first = await sent
  assert.equal(first.clientNonce, clientNonce)
  sent = event(socket, "message"); socket.emit("send-message", payload); assert.equal((await sent).id, first.id)
  assert.equal(await db.message.count({ where: { userId: a.id, clientNonce } }), 1)
  const rapidSocket = io(base, { autoConnect: false, transports: ["websocket"], extraHeaders: { Cookie: b.cookie }, reconnection: false })
  sockets.push(rapidSocket); const rapidConnected = event(rapidSocket, "connect"); rapidSocket.connect(); await rapidConnected
  const rapidHistory = event(rapidSocket, "message-history"); rapidSocket.emit("join-channel", { channelId: channel.id, history: true }); await rapidHistory
  // Keep the initial message's reward work in flight while rapidly sending
  // from a second account. This avoids consuming the owner fixture's command
  // rate-limit budget. Each receipt is matched by nonce so concurrent
  // Socket.IO events cannot accidentally satisfy the wrong assertion.
  const rapidPayloads = Array.from({ length: 3 }, (_, index) => ({
    channelId: channel.id,
    content: `Rapid recovery message ${index}`,
    clientNonce: randomBytes(16).toString("hex"),
  }))
  const rapidReceipts = rapidPayloads.map((rapid) => matchingEvent(rapidSocket, "message", (message) => message?.clientNonce === rapid.clientNonce))
  for (const rapid of rapidPayloads) rapidSocket.emit("send-message", rapid)
  const rapidMessages = await Promise.all(rapidReceipts)
  assert.equal(new Set(rapidMessages.map((message) => message.id)).size, rapidPayloads.length)
  const rapidDuplicate = matchingEvent(rapidSocket, "message", (message) => message?.clientNonce === rapidPayloads[0].clientNonce)
  rapidSocket.emit("send-message", rapidPayloads[0])
  assert.equal((await rapidDuplicate).id, rapidMessages[0].id)
  assert.equal(await db.message.count({ where: { userId: b.id, clientNonce: rapidPayloads[0].clientNonce } }), 1)
  const refreshed = event(socket, "message-history"); socket.emit("join-channel", { channelId: channel.id, history: true })
  assert.ok((await refreshed).messages.some((message) => message.clientNonce === clientNonce))
  pass("Socket.IO websocket rapid send, duplicate nonce idempotency, background rewards and reconnect history identity")

  await db.user.update({ where: { id: b.id }, data: { muted: true, mutedUntil: new Date(Date.now() + 60000) } })
  const rejectedEdit = event(rapidSocket, "mute-error")
  rapidSocket.emit("edit-message", { messageId: rapidMessages[0].id, channelId: channel.id, content: "Muted edit must be rejected" })
  assert.equal((await rejectedEdit).code, "MESSAGE_EDIT_FORBIDDEN")
  assert.equal((await db.message.findUnique({ where: { id: rapidMessages[0].id } })).content, rapidPayloads[0].content)
  await db.user.update({ where: { id: b.id }, data: { muted: false, mutedUntil: null } })
  pass("Socket.IO revalidates active mutes before editing an existing message")

  const polling = io(base, { autoConnect: false, transports: ["polling", "websocket"], extraHeaders: { Cookie: b.cookie }, reconnection: false })
  sockets.push(polling); const pollConnected = event(polling, "connect"); polling.connect(); await pollConnected
  pass("Socket.IO polling handshake with upgrade dispatch intact")
  const secondDevice = io(base, { autoConnect: false, transports: ["websocket"], extraHeaders: { Cookie: a.cookie }, reconnection: false })
  sockets.push(secondDevice); const deviceConnected = event(secondDevice, "connect"); secondDevice.connect(); await deviceConnected
  const observeActivity = async (expected) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = event(polling, "online-users"); polling.emit("who-is-online")
      const row = (await response).users.find((row) => row.userId === a.id)
      if ((row?.activity?.name || null) === expected) return
      await delay(50)
    }
    throw new Error(`Presence did not become ${expected}`)
  }
  socket.emit("presence-update", { activity: { kind: "playing", name: "Fixture Game" } })
  await observeActivity(null) // Default friends-only privacy hides activity from an unrelated account.
  await request("/api/features/privacy", { cookie: a.cookie, data: { action: "save-config", config: { preset: "everyone" } } })
  await observeActivity("Fixture Game")
  secondDevice.emit("presence-update", { activity: null }); await delay(50); await observeActivity("Fixture Game")
  secondDevice.emit("presence-update", { activity: { kind: "listening", name: "Fixture Track" } })
  await observeActivity("Fixture Track"); secondDevice.disconnect(); await delay(50); await observeActivity("Fixture Game")
  socket.emit("presence-update", { activity: null }); await observeActivity(null)
  pass("multi-device rich presence keeps active sources and falls back after disconnect")

  for (const [headers, expected] of [[{}, 401], [{ Cookie: a.cookie, Origin: "https://untrusted.example" }, 403], [{ Cookie: a.cookie, Origin: base }, 101]]) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(base.replace("http", "ws") + "/wisp/", { headers })
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("Wisp handshake timed out")) }, 10000)
      ws.on("error", () => {})
      ws.on("unexpected-response", (_req, response) => { clearTimeout(timer); response.resume(); ws.terminate(); try { assert.equal(response.statusCode, expected); resolve() } catch (error) { reject(error) } })
      ws.on("open", () => { clearTimeout(timer); ws.close(); try { assert.equal(expected, 101); resolve() } catch (error) { reject(error) } })
    })
  }
  pass("Wisp accepts signed-in same-origin clients and rejects anonymous/cross-origin clients")
  await request("/api/owner/verify", { cookie: b.cookie, data: { password: "incorrect" }, status: 403 })
  const owner = await request("/api/owner/verify", { cookie: a.cookie, data: { password: env.OWNER_PASSWORD } })
  assert.equal(owner.json.user.role, "OWNER"); noSecrets(owner.json)
  await db.infraction.create({ data: { userId: b.id, issuerId: a.id, type: "WARN", reason: "Disposable warning" } })
  noSecrets((await request("/api/infractions/list", { cookie: a.cookie })).json)
  noSecrets((await request(`/api/infractions/user/${b.id}`, { cookie: a.cookie })).json)
  pass("owner verification and sanitized moderation responses")
  await request("/api/infractions/create", { cookie: b.cookie, data: { userId: a.id, type: "WARN", reason: "forbidden" }, status: 403 })
  await request("/api/infractions/create", { cookie: a.cookie, data: { userId: b.id, type: "MUTE", durationMin: "invalid", reason: "invalid duration" }, status: 400 })
  await request("/api/infractions/create", { cookie: a.cookie, data: { userId: b.id, type: "MUTE", durationMin: 10, reason: "Disposable timed mute" } })
  assert.ok((await db.user.findUnique({ where: { id: b.id } })).mutedUntil > new Date())
  await request("/api/infractions/create", { cookie: a.cookie, data: { userId: b.id, type: "BAN", durationMin: 10, reason: "unsupported timed ban" }, status: 400 })
  await request("/api/infractions/create", { cookie: a.cookie, data: { userId: b.id, type: "BAN", reason: "Disposable ban" } })
  await request("/api/moderation/unban", { cookie: a.cookie, data: { userId: b.id, reason: "Disposable reversal reason" } })
  assert.equal((await db.infraction.findFirst({ where: { userId: b.id, type: "UNBAN" } })).reason, "Disposable reversal reason")
  assert.equal(await db.infraction.count({ where: { userId: b.id, type: "BAN", duration: null } }), 0)
  pass("moderation enforces staff authorization, validates durations and records ban/unban reasons")

  for (const profile of profiles.slice(2)) await request("/api/features/media/profiles", { cookie: a.cookie, data: { action: "delete", profileId: profile.id } })
  const deleted = await Promise.all(profiles.slice(0, 2).map((profile) => fetch(base + "/api/features/media/profiles", { method: "POST", headers: { Cookie: a.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", profileId: profile.id }) })))
  assert.deepEqual(deleted.map((response) => response.status).sort(), [200, 409])
  assert.equal((await request("/api/features/media/profiles", { cookie: a.cookie })).json.profiles.length, 1)
  pass("concurrent profile deletion always preserves one profile")
  const { smokeUpgrade } = await import("./smoke-upgrade.mjs")
  await smokeUpgrade({ testPassword, request, db, a, b, channel, socket, event, pass, base, sockets })
  const browserModule = process.argv.find((arg) => arg.startsWith("--browser-module="))?.slice("--browser-module=".length)
  if (browserModule) {
    await db.message.createMany({ data: Array.from({ length: 80 }, (_, i) => ({ channelId: channel.id, userId: a.id, username: a.username, content: `History fixture ${i}` })) })
    await db.message.create({ data: { channelId: channel.id, userId: b.id, username: b.username, content: "Uploaded image fixture", imageUrl: uploaded } })
    const dm = (await request("/api/dms/list", { cookie: b.cookie, data: { userId: a.id } })).json
    const incomingSocket = io(base, { autoConnect: false, transports: ["websocket"], extraHeaders: { Cookie: b.cookie }, reconnection: false })
    sockets.push(incomingSocket); const ready = event(incomingSocket, "connect"); incomingSocket.connect(); await ready
    for (const channelId of [channel.id, dm.id]) { const joined = event(incomingSocket, "message-history"); incomingSocket.emit("join-channel", { channelId, history: true }); await joined }
    const incoming = async kind => { const received = event(incomingSocket, "message"); incomingSocket.emit("send-message", { channelId: kind === "dm" ? dm.id : channel.id, content: kind === "mention" ? `Hello @${a.username}` : `Ordinary ${kind} message`, clientNonce: randomBytes(16).toString("hex") }); return received }
    const { smokeBrowser } = await import("./smoke-browser.mjs")
    await smokeBrowser({ base, accounts, browserModule, pass, incoming, channelName: channel.name })
  }
  console.log(`SMOKE PASSED: ${checks} groups; disposable data only.`)
} finally {
  for (const socket of sockets) socket.disconnect()
  if (child) {
    child.kill("SIGTERM")
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(6000)])
    if (child.exitCode === null) child.kill("SIGKILL")
  }
  await db.$disconnect()
  if (process.env.SYNNICAL_SMOKE_LOG) await writeFile(process.env.SYNNICAL_SMOKE_LOG, log)
  await rm(root, { recursive: true, force: true })
}
