import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { io } from "socket.io-client"

export async function smokeUpgrade({ request, db, a, b, channel, socket, event, pass, base, sockets }) {
  const cookieOf = response => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ")
  const password = "Disposable-Test-Password-92"
  const signIn = async account => account.cookie.split("; ").filter(v => v.startsWith("synnical_device=")).join("; ") + "; " + cookieOf((await request("/api/auth/login", { cookie: account.cookie.split("; ").filter(v => v.startsWith("synnical_device=")).join("; "), data: { username: account.username, password } })).response)
  b.cookie = await signIn(b)
  await request("/api/moderation/unmute", { cookie: a.cookie, data: { userId: b.id, reason: "Clear test mute" } })
  await request("/api/roles/assign", { cookie: b.cookie, data: { userId: b.id, role: "OWNER" }, status: 403 })
  await request("/api/moderation/accounts", { cookie: b.cookie, status: 403 })
  await request("/api/roles/assign", { cookie: a.cookie, data: { userId: b.id, role: "MOD" } })
  await request("/api/moderation/mute", { cookie: b.cookie, data: { userId: a.id, durationMin: 15, reason: "Forbidden higher role" }, status: 403 })
  await request("/api/moderation/mute", { cookie: b.cookie, data: { userId: b.id, durationMin: 15, reason: "Forbidden self" }, status: 403 })
  await request("/api/roles/assign", { cookie: a.cookie, data: { userId: b.id, role: "MEMBER" } })
  pass("upgrade: member escalation and moderation denied; MOD cannot act on Owner or self")

  const send = async content => { const received = event(socket, "message"); socket.emit("send-message", { channelId: channel.id, content, clientNonce: randomBytes(16).toString("hex") }); return received }
  const normal = await send("Ordinary unread message")
  assert.deepEqual(normal.mentionedUserIds, [])
  const mentioned = await send(`Hello @${b.username}`)
  assert.deepEqual(mentioned.mentionedUserIds, [b.id])
  const unread = (await request("/api/chat/unread", { cookie: b.cookie })).json
  assert.ok(unread.unread[channel.id] >= 2); assert.equal(unread.mentions[channel.id], true)
  await request("/api/features/chat", { cookie: b.cookie, data: { action: "set-preference", channelId: channel.id, lastReadMessageId: mentioned.id } })
  assert.equal((await request("/api/chat/unread", { cookie: b.cookie })).json.unread[channel.id], 0)
  assert.equal((await request("/api/chat/unread", { cookie: b.cookie })).json.mentions[channel.id], false)
  pass("upgrade: resolved mention IDs and ordinary unread persist and clear through read API")

  const command = async text => { const received = event(socket, "bot-command-result"); socket.emit("send-message", { channelId: channel.id, content: text, clientNonce: randomBytes(16).toString("hex") }); return received }
  const result = await command(`@mute @${b.username} 15m smoke reason`)
  assert.equal(result.ok, true, JSON.stringify(result))
  const mute = await db.infraction.findFirst({ where: { userId: b.id, type: "MUTE", reason: "smoke reason" } })
  assert.equal(mute.duration, 15)
  assert.ok((await db.user.findUnique({ where: { id: b.id } })).mutedUntil > new Date(Date.now() + 14 * 60000))
  assert.equal((await command(`@unmute @${b.username} reviewed`)).ok, true)
  assert.equal((await db.user.findUnique({ where: { id: b.id } })).muted, false)
  assert.equal((await command("@mute @nonexistenttarget 15m")).ok, false)
  pass("upgrade: Synnbot resolves exact target, applies 15-minute mute, unmutes and reports absent targets")

  // This account shares b's first-party device, but has a different session/account.
  const created = await request("/api/auth/register", { cookie: b.cookie, data: { username: "shareddevicefixture", password, securityQuestion: "Test phrase?", securityAnswer: "sample" } })
  const c = { ...created.json.user, cookie: cookieOf(created.response) }
  const cSessionOnly = c.cookie.split("; ").filter(value => !value.startsWith("synnical_device=")).join("; ")
  await request("/api/moderation/ban", { cookie: a.cookie, data: { userId: b.id, reason: "Device enforcement test" } })
  assert.ok(await db.user.findUnique({ where: { id: b.id } }), "ban preserves account")
  await request("/api/auth/login", { cookie: b.cookie, data: { username: b.username, password }, status: 403 })
  await request("/api/features/settings", { cookie: cSessionOnly, status: 401 })
  const blocked = io(base, { autoConnect: false, transports: ["websocket"], extraHeaders: { Cookie: cSessionOnly }, reconnection: false })
  sockets.push(blocked); const rejected = event(blocked, "connect_error"); blocked.connect(); await rejected
  await request("/api/moderation/ban", { cookie: a.cookie, data: { userId: c.id, reason: "Second account same device" } })
  await request("/api/moderation/unban", { cookie: a.cookie, data: { userId: c.id, reason: "Partial device reversal" } })
  await request("/api/auth/login", { cookie: b.cookie, data: { username: b.username, password }, status: 403 })
  await request("/api/moderation/unban", { cookie: a.cookie, data: { userId: b.id, reason: "Final device reversal" } })
  b.cookie = await signIn(b)
  assert.equal(await db.bannedIdentity.count(), 0)
  assert.doesNotMatch(JSON.stringify((await request("/api/features/security", { cookie: b.cookie })).json), /deviceHash|valueHash/)
  pass("upgrade: bans preserve accounts, reject login/API/socket, survive cookie removal, and revoke shared devices correctly")

  const track = { id: "fixtureTrack", provider: "audius", title: "Test metadata only", artist: "Fixture", duration: 12 }
  await request("/api/music/library", { cookie: b.cookie, data: { action: "favorite", track } })
  assert.equal((await request("/api/music/library", { cookie: b.cookie })).json.favorites.length, 1)
  assert.equal((await request("/api/music/library", { cookie: a.cookie })).json.favorites.length, 0)
  await request("/api/music/library", { cookie: b.cookie, data: { action: "favorite", track, remove: true } })
  assert.equal((await request("/api/music/library", { cookie: b.cookie })).json.favorites.length, 0)
  await request("/api/music/library", { cookie: b.cookie, data: { action: "favorite", track: { id: "../bad", provider: "audius" } }, status: 400 })
  pass("upgrade: music library persists, isolates accounts, removes favorites and validates IDs")
}
