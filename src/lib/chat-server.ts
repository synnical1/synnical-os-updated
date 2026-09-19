import { runModerationCommand } from "./bot-moderation"
import { ModerationError } from "./moderation-service"
import { mentionNames, parseMentionIds } from "./chat-mentions"
import { isDeviceBanned } from "./identity-ban"
import { moderationEvents } from "./moderation-events"
import type { Server as HTTPServer } from "http"
import { randomBytes } from "crypto"
import { Server as IOServer, type Socket } from "socket.io"
import { db } from "./db"
import { SESSION_COOKIE } from "./constants"
import { moderateTextContent, type ModerationResult } from "./content-moderation"
import { permanentlyBanForModeration, recordModerationBlock } from "./moderation-enforcement"
import { synnBotAiRequest, synnBotReply } from "./synn-bot"
import { runSynnBotAi } from "./synn-bot-ai"
import { verifiedGiphyMediaUrl } from "./gif-provider"
import { canDeleteMessage, type MessageRole } from "./message-permissions"
import { CHAT_REACTION_EMOJI_SET } from "./chat-emojis"
import {
  canAccessPublicChannel,
  canManageChannels,
  isStaffChannelRole,
  normalizeChannelAudience,
} from "./channel-permissions"
import { isDmSendBlocked } from "./blocks"
import { getSynnBotProfile, runSynnBotFeature } from "./synn-bot-features"
import { runOwnerJarvisRequest } from "./synn-bot-owner"
import { addXp, advanceChallenge, earnAchievement, logSystemEvent } from "./feature-platform"
import { setSocketClientCount } from "./runtime-health"
import { normalizeRichPresenceActivity, presenceMode, presenceSection, type PresenceMode, type RichPresenceActivity } from "./presence"
import { privacyViewFor } from "./privacy"
import { isAccountLockedDown } from "./security-policy"
import { ensureFriendshipBond, recordFriendshipMessage } from "./friendship-social"
import { runAutomationTrigger, runDueAutomations } from "./automation-engine"
import { allowedSocketOrigin } from "./server-request-auth"

interface ClientUser {
  userId: string
  username: string
  displayName: string
  pfpUrl: string | null
  pfpIsGif: boolean
  bio: string
  status: string
  statusExpiresAt: Date | null
  avatarDeco: string | null
  profileEffect: string | null
  role: string
  muted: boolean
  mutedUntil: Date | null
  tags: string[]
  presenceMode?: PresenceMode
  presenceModeExpiresAt?: string | null
  afk?: boolean
  afkMessage?: string
  currentSection?: string | null
  deviceType?: "desktop" | "mobile" | "tablet" | "unknown" | null
  networkQuality?: "good" | "fair" | "poor" | "unknown" | null
  onlineSince?: string | null
  activity?: RichPresenceActivity | null
}

type DbUserLike = {
  id: string
  username: string
  displayName: string
  pfpUrl: string | null
  pfpIsGif: boolean
  bio: string
  status: string
  statusExpiresAt: Date | null
  avatarDeco: string | null
  profileEffect: string | null
  role: string
  muted: boolean
  mutedUntil: Date | null
  tags: string | null
}

type PostSendTask = { name: string; run: () => Promise<unknown> }
const yieldToRealtimeWork = () => new Promise<void>((resolve) => setImmediate(resolve))

// SQLite permits a single writer. Keep non-critical message bookkeeping off
// the send path and drain it in order, so a busy chat cannot create a burst of
// competing Prisma writes. The durable message has already been broadcast.
let postSendBookkeepingTail: Promise<void> = Promise.resolve()

function enqueuePostSendBookkeeping(messageId: string, tasks: PostSendTask[]) {
  const run = async () => {
    const failed: string[] = []
    for (const task of tasks) {
      try {
        await task.run()
      } catch (error) {
        failed.push(task.name)
        console.error(`[chat] post-send ${task.name} failed for message ${messageId}:`, error)
      }
      // Do not let a busy rewards backlog monopolise Node's microtask queue.
      // Socket.IO handlers (including retries and staff commands) can run here.
      await yieldToRealtimeWork()
    }
    if (failed.length) console.error(`[chat] ${failed.length} post-send task(s) failed for message ${messageId}`)
  }
  postSendBookkeepingTail = postSendBookkeepingTail.then(run, run).catch((error) => {
    console.error(`[chat] post-send queue failed for message ${messageId}:`, error)
  })
  return postSendBookkeepingTail
}

function safeUser(u: DbUserLike): ClientUser {
  let parsedTags: string[] = []
  try { parsedTags = JSON.parse(u.tags || '[]') } catch {}
  return {
    userId: u.id, username: u.username, displayName: u.displayName,
    pfpUrl: u.pfpUrl, pfpIsGif: u.pfpIsGif, bio: u.bio, status: u.statusExpiresAt && u.statusExpiresAt.getTime() <= Date.now() ? "" : u.status,
    statusExpiresAt: u.statusExpiresAt, avatarDeco: u.avatarDeco, profileEffect: u.profileEffect, role: u.role,
    muted: u.muted, mutedUntil: u.mutedUntil, tags: parsedTags,
  }
}

function isMutedNow(u: ClientUser): boolean {
  if (!u.muted) return false
  if (!u.mutedUntil) return true
  return new Date(u.mutedUntil).getTime() > Date.now()
}

function readCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=")
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="))
  }
  return null
}

/** Socket with the authenticated user attached during the handshake. */
type AuthedSocket = Socket & { user: ClientUser }

/**
 * Attach the Synnical real-time chat (socket.io) to an existing HTTP server.
 *
 * IMPORTANT: the client must connect with `io({ path: "/socket.io" })` — passing
 * "/socket.io" as the connection URL makes socket.io-client request a NAMESPACE
 * of that name, which does not exist here, and the handshake fails with
 * "Invalid namespace".
 */
export function attachChat(httpServer: HTTPServer): IOServer {
  const io = new IOServer(httpServer, {
    path: process.env.NEXT_PUBLIC_SOCKET_URL || "/socket.io",
    // Same-origin only: the app and the socket are served by this same process.
    cors: { origin: true, credentials: true, methods: ["GET", "POST"] },
    allowRequest: (req, done) => done(null, allowedSocketOrigin(req)),
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  })

  // socket.id -> user
  const online = new Map<string, ClientUser>()
  const onModeration = async ({ userId, action }: { userId: string; action: string }) => {
    io.emit("moderation-updated", { userId })
    for (const socket of io.sockets.sockets.values()) {
      const current = (socket as AuthedSocket).user
      if (current?.userId === userId) {
        if (action === "BAN") socket.disconnect(true)
        else { const fresh = await db.user.findUnique({ where: { id: userId } }); if (fresh) Object.assign(current, safeUser(fresh)) }
      } else if (action === "BAN" && await isDeviceBanned(socket.handshake.headers.cookie, socket.data.deviceHash)) socket.disconnect(true)
    }
  }
  const moderationListener = (event: { userId: string; action: string }) => { void onModeration(event).catch(error => console.error("[moderation/socket]", error)) }
  moderationEvents.on("change", moderationListener)
  httpServer.on("close", () => moderationEvents.off("change", moderationListener))
  // channelId -> set of socket.ids currently viewing it
  const channelRooms = new Map<string, Set<string>>()
  const onChannelsChange = ({ channelId, userIds }: { channelId: string; userIds: string[] }) => {
    for (const socket of io.sockets.sockets.values()) if (userIds.includes((socket as AuthedSocket).user?.userId)) {
      socket.join(`channel:${channelId}`)
      if (!channelRooms.has(channelId)) channelRooms.set(channelId, new Set())
      channelRooms.get(channelId)!.add(socket.id)
      socket.emit("dm-created", { channelId })
    }
  }
  moderationEvents.on("channels-change", onChannelsChange)
  httpServer.on("close", () => moderationEvents.off("channels-change", onChannelsChange))
  // User-level action windows prevent parallel sockets from multiplying the
  // number of database writes and expensive AI moderation calls.
  const chatActionWindows = new Map<string, number[]>()
  const watchPartyUpdateWindows = new Map<string, number>()
  type PresenceState = {
    mode: PresenceMode
    modeExpiresAt: number | null
    afk: boolean
    afkMessage: string
    currentSection: string | null
    deviceType: "desktop" | "mobile" | "tablet" | "unknown" | null
    networkQuality: "good" | "fair" | "poor" | "unknown" | null
    showOnlineDuration: boolean
    connectedAt: number
    activity: RichPresenceActivity | null
  }
  const presenceByUser = new Map<string, PresenceState>()
  const activityBySocket = new Map<string, { userId: string; activity: RichPresenceActivity; updatedAt: number }>()
  function latestActivityForUser(userId: string): RichPresenceActivity | null {
    let latest: { activity: RichPresenceActivity; updatedAt: number } | null = null
    for (const [id, entry] of activityBySocket) {
      if (entry.userId === userId && online.has(id) && (!latest || entry.updatedAt >= latest.updatedAt)) latest = entry
    }
    return latest?.activity || null
  }

  type CallMember = { socketId: string; userId: string; username: string; displayName: string; muted: boolean; video: boolean; screen: boolean }
  type CallRoom = { code: string; kind: "voice" | "video"; createdBy: string; createdAt: number; members: Map<string, CallMember> }
  const callRooms = new Map<string, CallRoom>()
  const callRoomBySocket = new Map<string, string>()

  function callCode(): string {
    for (let tries = 0; tries < 8; tries += 1) {
      const code = randomBytes(4).toString("base64url").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 7)
      if (code.length >= 6 && !callRooms.has(code)) return code
    }
    return `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2,5)}`.toUpperCase()
  }
  function publicCallMember(member: CallMember) { return { socketId: member.socketId, userId: member.userId, username: member.username, displayName: member.displayName, muted: member.muted, video: member.video, screen: member.screen } }
  function leaveCall(socketId: string) {
    const code = callRoomBySocket.get(socketId); if (!code) return
    const room = callRooms.get(code); callRoomBySocket.delete(socketId)
    if (!room) return
    room.members.delete(socketId)
    io.to(`call:${code}`).emit("call-peer-left", { socketId })
    io.sockets.sockets.get(socketId)?.leave(`call:${code}`)
    if (room.members.size === 0) callRooms.delete(code)
  }

  function validId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 128
  }

  const HISTORY_PAGE_SIZE = 50

  const serializeHistoryMessage = (row: any, viewerUserId: string) => ({
    id: row.id, channelId: row.channelId, userId: row.userId, username: row.username,
    clientNonce: row.clientNonce, mentionedUserIds: parseMentionIds(row.mentionedUserIds),
    content: row.content, deleted: row.deleted, edited: row.edited, gifUrl: row.gifUrl, imageUrl: row.imageUrl,
    voiceUrl: row.voiceUrl, voiceTranscript: row.voiceTranscript, messageType: row.messageType, threadRootId: row.threadRootId,
    replyToId: row.replyToId, replyToName: row.replyToName, replyToContent: row.replyToContent,
    spoilerMediaType: row.spoilerMediaType, spoilerMediaId: row.spoilerMediaId, spoilerTitle: row.spoilerTitle,
    spoilerSeason: row.spoilerSeason, spoilerEpisode: row.spoilerEpisode, spoilerUntil: row.spoilerUntil,
    createdAt: row.createdAt,
    displayName: row.user?.displayName || (row.username === "synn-bot" ? "synn Bot" : undefined),
    pfpUrl: row.user?.pfpUrl || (row.username === "synn-bot" ? "/brand/synn-bot.svg" : null),
    pfpIsGif: row.user?.pfpIsGif, role: row.user?.role,
    tags: (() => { try { return JSON.parse(row.user?.tags || "[]") as string[] } catch { return [] as string[] } })(),
    avatarDeco: row.user?.avatarDeco,
    isBot: row.username === "synn-bot" && row.userId === null,
    reactions: reactionSummary(row.reactions, viewerUserId),
  })

  async function messageHistoryPage(channelId: string, viewerUserId: string, beforeId?: string) {
    let before: { id: string; createdAt: Date } | null = null
    if (beforeId) {
      before = await db.message.findFirst({
        where: { id: beforeId, channelId },
        select: { id: true, createdAt: true },
      })
      if (!before) return { messages: [], hasMore: false }
    }

    const rows = await db.message.findMany({
      where: before ? {
        channelId,
        OR: [
          { createdAt: { lt: before.createdAt } },
          { createdAt: before.createdAt, id: { lt: before.id } },
        ],
      } : { channelId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: HISTORY_PAGE_SIZE + 1,
      include: { user: true, reactions: { select: { emoji: true, userId: true } } },
    })
    const hasMore = rows.length > HISTORY_PAGE_SIZE
    const page = rows.slice(0, HISTORY_PAGE_SIZE)
    return {
      hasMore,
      messages: page.reverse().map((row) => serializeHistoryMessage(row, viewerUserId)),
    }
  }

  function consumeChatAction(userId: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now()
    const minuteAgo = now - 60_000
    const tenSecondsAgo = now - 10_000
    const recent = (chatActionWindows.get(userId) || []).filter((time) => time > minuteAgo)
    const inTenSeconds = recent.filter((time) => time > tenSecondsAgo)

    if (recent.length >= 20 || inTenSeconds.length >= 6) {
      chatActionWindows.set(userId, recent)
      const oldestRelevant = inTenSeconds.length >= 6 ? inTenSeconds[0] : recent[0]
      const windowMs = inTenSeconds.length >= 6 ? 10_000 : 60_000
      return { allowed: false, retryAfterMs: Math.max(250, oldestRelevant + windowMs - now) }
    }

    recent.push(now)
    chatActionWindows.set(userId, recent)
    if (chatActionWindows.size > 5_000) {
      for (const [id, times] of chatActionWindows) {
        if (!times.some((time) => time > minuteAgo)) chatActionWindows.delete(id)
      }
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  async function accessibleChannel(channelId: string, userId: string, userRole?: string) {
    const channel = await db.channel.findUnique({ where: { id: channelId } })
    if (!channel) return null
    if (channel.isDM || channel.isGroup) {
      const membership = await db.membership.findFirst({ where: { channelId, userId } })
      if (!membership) return null
    } else {
      // Never rely only on the role captured at the Socket.IO handshake. A
      // staff account can be demoted while its socket remains connected. Read
      // the current DB role before granting access to a public channel.
      const current = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
      const role = current?.role || userRole
      if (!role || !canAccessPublicChannel(channel.allowedRoles, role)) return null
    }
    return channel
  }

  async function authorizedRoomSocketIds(channelId: string): Promise<Set<string>> {
    const joined = new Set(channelRooms.get(channelId) || [])
    if (joined.size === 0) return joined

    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { id: true, isDM: true, isGroup: true, allowedRoles: true },
    })
    if (!channel) return new Set()

    const socketUsers = [...joined]
      .map((socketId) => ({ socketId, user: online.get(socketId) }))
      .filter((entry): entry is { socketId: string; user: ClientUser } => Boolean(entry.user))
    const userIds = [...new Set(socketUsers.map((entry) => entry.user.userId))]
    const allowedUserIds = new Set<string>()

    if (channel.isDM || channel.isGroup) {
      const memberships = await db.membership.findMany({
        where: { channelId, userId: { in: userIds } },
        select: { userId: true },
      })
      for (const membership of memberships) allowedUserIds.add(membership.userId)
    } else {
      const currentUsers = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, role: true },
      })
      for (const current of currentUsers) {
        if (canAccessPublicChannel(channel.allowedRoles, current.role)) allowedUserIds.add(current.id)
      }
    }

    const authorized = new Set<string>()
    for (const { socketId, user: target } of socketUsers) {
      if (allowedUserIds.has(target.userId)) {
        authorized.add(socketId)
        continue
      }
      io.sockets.sockets.get(socketId)?.leave(`channel:${channelId}`)
      channelRooms.get(channelId)?.delete(socketId)
    }
    return authorized
  }

  async function emitAuthorizedChannel(
    channelId: string,
    event: string,
    payload: unknown,
    excludeSocketId?: string,
  ) {
    const ids = await authorizedRoomSocketIds(channelId)
    for (const socketId of ids) {
      if (socketId === excludeSocketId) continue
      io.to(socketId).emit(event, payload)
    }
  }

  function reactionSummary(rows: { emoji: string; userId: string }[], viewerId: string) {
    const grouped = new Map<string, { emoji: string; count: number; reacted: boolean }>()
    for (const row of rows) {
      const value = grouped.get(row.emoji) || { emoji: row.emoji, count: 0, reacted: false }
      value.count += 1
      if (row.userId === viewerId) value.reacted = true
      grouped.set(row.emoji, value)
    }
    return [...grouped.values()].sort((left, right) => right.count - left.count || left.emoji.localeCompare(right.emoji))
  }

  /** Deduplicate socket ids down to unique users and merge user-level presence. */
  function usersFromSockets(ids: Iterable<string>): ClientUser[] {
    const users: ClientUser[] = []
    const seen = new Set<string>()
    const now = Date.now()
    for (const sid of ids) {
      const u = online.get(sid)
      if (!u || seen.has(u.userId)) continue
      seen.add(u.userId)
      const state = presenceByUser.get(u.userId)
      const activeMode = state?.modeExpiresAt && state.modeExpiresAt <= now ? "online" : state?.mode || "online"
      users.push({
        ...u,
        status: u.statusExpiresAt && u.statusExpiresAt.getTime() <= now ? "" : u.status,
        presenceMode: activeMode,
        presenceModeExpiresAt: state?.modeExpiresAt && state.modeExpiresAt > now ? new Date(state.modeExpiresAt).toISOString() : null,
        afk: state?.afk || false,
        afkMessage: state?.afk ? state.afkMessage : "",
        currentSection: state?.currentSection || null,
        deviceType: state?.deviceType || null,
        networkQuality: state?.networkQuality || null,
        onlineSince: state?.showOnlineDuration ? new Date(state.connectedAt).toISOString() : null,
        activity: latestActivityForUser(u.userId),
      })
    }
    return users
  }

  async function usersForViewer(ids: Iterable<string>, viewerUserId: string): Promise<ClientUser[]> {
    const raw = usersFromSockets(ids)
    const visible: ClientUser[] = []
    for (const target of raw) {
      const privacy = await privacyViewFor(target.userId, viewerUserId)
      if (!privacy.presence && target.userId !== viewerUserId) continue
      let next: ClientUser = target
      if (!privacy.profile) next = { ...next, bio: "", status: "", profileEffect: null }
      if (!privacy.activity) next = { ...next, status: "", currentSection: null, deviceType: null, networkQuality: null, onlineSince: null, afkMessage: "", activity: null }
      visible.push(next)
    }
    return visible
  }

  async function broadcastPresence(channelId: string) {
    const ids = await authorizedRoomSocketIds(channelId)
    for (const socketId of ids) {
      const viewer = online.get(socketId)
      if (!viewer) continue
      io.to(socketId).emit("presence", { channelId, users: await usersForViewer(ids, viewer.userId) })
    }
  }

  /** Global online presence is filtered separately for every viewer. */
  async function broadcastGlobalPresence() {
    for (const [socketId, viewer] of online) {
      io.to(socketId).emit("online-users", { users: await usersForViewer(online.keys(), viewer.userId) })
    }
  }

  async function applyAutomaticBan(
    socket: Socket,
    user: ClientUser,
    violation: ModerationResult,
    clientNonce?: string | null,
  ): Promise<void> {
    const banned = await permanentlyBanForModeration(user.userId, violation)

    if (!banned) {
      socket.emit("mute-error", {
        code: violation.code,
        message: `[${violation.code}] Content blocked and logged. Staff accounts are exempt from automatic bans.`,
        ...(clientNonce ? { clientNonce } : {}),
      })
      io.emit("moderation-action", {
        type: "AUTO_BLOCK",
        userId: user.userId,
        username: user.username,
        code: violation.code,
      })
      return
    }

    socket.emit("mute-error", {
      code: violation.code,
      message: `[${violation.code}] This account was permanently banned by AutoMod.`,
      ...(clientNonce ? { clientNonce } : {}),
    })
    io.emit("moderation-action", {
      type: "AUTO_BAN",
      userId: user.userId,
      username: user.username,
      code: violation.code,
    })

    // Disconnect every active socket for the banned account after the error
    // event has had a moment to flush to the triggering client.
    setTimeout(() => {
      for (const [socketId, onlineUser] of online.entries()) {
        if (onlineUser.userId === user.userId) {
          io.sockets.sockets.get(socketId)?.disconnect(true)
        }
      }
    }, 150)
  }

  async function rejectModeratedContent(socket: Socket, user: ClientUser, result: ModerationResult, clientNonce?: string | null): Promise<void> {
    if (result.decision === "ban") {
      await applyAutomaticBan(socket, user, result, clientNonce)
      return
    }
    await recordModerationBlock(user.userId, result)
    socket.emit("mute-error", {
      code: result.code,
      message: `[${result.code}] Message blocked: ${result.reason}`,
      ...(clientNonce ? { clientNonce } : {}),
    })
  }

  // Persistent scheduler for scheduled messages plus Synn Bot reminders. The
  // claim transition (pending -> sending) makes each job idempotent even if a
  // future clustered deployment accidentally runs more than one scheduler.
  let schedulerBusy = false
  let lastAutomationSweep = 0
  const schedulerTimer = setInterval(async () => {
    if (schedulerBusy) return
    schedulerBusy = true
    try {
      const now = new Date()
      const scheduled = await db.scheduledMessage.findMany({ where: { status: "pending", sendAt: { lte: now } }, orderBy: { sendAt: "asc" }, take: 25 })
      for (const job of scheduled) {
        const claimed = await db.scheduledMessage.updateMany({ where: { id: job.id, status: "pending" }, data: { status: "sending" } })
        if (!claimed.count) continue
        try {
          const owner = await db.user.findUnique({ where: { id: job.userId } })
          if (!owner) throw new Error("scheduled message owner no longer exists")
          if (await isAccountLockedDown(owner.id)) throw new Error("account lockdown blocks outgoing scheduled messages")
          const channel = await accessibleChannel(job.channelId, owner.id, owner.role)
          if (!channel) throw new Error("scheduled message channel is no longer accessible")
          const actor = safeUser(owner as DbUserLike)
          if (isMutedNow(actor)) throw new Error("scheduled message owner is muted")
          const moderation = job.content ? await moderateTextContent({ content: job.content, surface: "chat" }) : null
          if (moderation && moderation.decision !== "allow") throw new Error(`scheduled message blocked by ${moderation.code}`)
          let scheduledPeerId: string | null = null
          if (channel.isDM) {
            const peer = await db.membership.findFirst({ where: { channelId: job.channelId, userId: { not: owner.id } }, select: { userId: true } })
            scheduledPeerId = peer?.userId || null
            if (scheduledPeerId) await ensureFriendshipBond(owner.id, scheduledPeerId).catch(() => {})
          }
          const created = await db.message.create({ data: { channelId: job.channelId, userId: owner.id, username: owner.username, content: job.content, gifUrl: job.gifUrl, replyToId: job.replyToId } })
          if (scheduledPeerId) await recordFriendshipMessage(owner.id, scheduledPeerId).catch(() => {})
          await db.user.update({ where: { id: owner.id }, data: { messageCount: { increment: 1 } } }).catch(() => {})
          await addXp(owner.id, 2).catch(() => {})
          await advanceChallenge(owner.id, "messages", 1).catch(() => {})
          await earnAchievement(owner.id, "first-message").catch(() => {})
          try { const { rewardMessage } = await import("./shop"); await rewardMessage(owner.id) } catch {}
          await runAutomationTrigger(owner.id, "message_contains", { content: job.content, direction: "outgoing", channelId: job.channelId }).catch(() => {})
          if (scheduledPeerId) await runAutomationTrigger(scheduledPeerId, "message_contains", { content: job.content, direction: "incoming", channelId: job.channelId, fromUserId: owner.id, fromUsername: owner.username }).catch(() => {})
          await db.scheduledMessage.update({ where: { id: job.id }, data: { status: "sent", sentMessageId: created.id, error: null } })
          await emitAuthorizedChannel(job.channelId, "message", {
            id: created.id, channelId: created.channelId, userId: owner.id, username: owner.username, displayName: owner.displayName, pfpUrl: owner.pfpUrl, pfpIsGif: owner.pfpIsGif, role: owner.role, tags: (() => { try { return JSON.parse(owner.tags || "[]") as string[] } catch { return [] as string[] } })(), avatarDeco: owner.avatarDeco,
            content: created.content, gifUrl: created.gifUrl, voiceUrl: null, voiceTranscript: null, messageType: created.messageType, threadRootId: created.threadRootId, deleted: false, edited: false, replyToId: created.replyToId, replyToName: created.replyToName, replyToContent: created.replyToContent, createdAt: created.createdAt, reactions: [], scheduled: true,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await db.scheduledMessage.update({ where: { id: job.id }, data: { status: "failed", error: message.slice(0, 500) } }).catch(() => {})
          await logSystemEvent("warn", "scheduled-message", message, { id: job.id }).catch(() => {})
        }
      }

      const reminders = await db.botReminder.findMany({ where: { status: "pending", dueAt: { lte: now } }, orderBy: { dueAt: "asc" }, take: 25 })
      for (const reminder of reminders) {
        const claimed = await db.botReminder.updateMany({ where: { id: reminder.id, status: "pending" }, data: { status: "sending" } })
        if (!claimed.count) continue
        try {
          const owner = await db.user.findUnique({ where: { id: reminder.userId } })
          if (!owner || !await accessibleChannel(reminder.channelId, owner.id, owner.role)) throw new Error("reminder destination is no longer accessible")
          const prefix = reminder.kind === "countdown" ? "⏱ Countdown finished" : "⏰ Reminder"
          const content = `${prefix} for @${owner.username}: ${reminder.body}`.slice(0, 2000)
          const message = await db.message.create({ data: { channelId: reminder.channelId, userId: null, username: "synn-bot", content, messageType: "bot-reminder" } })
          await db.botReminder.update({ where: { id: reminder.id }, data: { status: "sent" } })
          await emitAuthorizedChannel(reminder.channelId, "message", { id: message.id, channelId: reminder.channelId, userId: null, username: "synn-bot", displayName: "synn Bot", pfpUrl: "/brand/synn-bot.svg", pfpIsGif: false, role: "MEMBER", avatarDeco: null, isBot: true, reactions: [], content, gifUrl: null, voiceUrl: null, voiceTranscript: null, messageType: "bot-reminder", threadRootId: null, deleted: false, edited: false, createdAt: message.createdAt })
        } catch (error) {
          await db.botReminder.update({ where: { id: reminder.id }, data: { status: "failed" } }).catch(() => {})
          await logSystemEvent("warn", "bot-reminder", error instanceof Error ? error.message : String(error), { id: reminder.id }).catch(() => {})
        }
      }

      if (Date.now() - lastAutomationSweep >= 30000) {
        lastAutomationSweep = Date.now()
        await runDueAutomations(now).catch((error) => logSystemEvent("warn", "automations", error instanceof Error ? error.message : String(error)))
      }
    } catch (error) {
      console.error("[scheduler] feature scheduler failed:", error)
      await logSystemEvent("error", "feature-scheduler", error instanceof Error ? error.message : String(error)).catch(() => {})
    } finally { schedulerBusy = false }
  }, 2000)
  schedulerTimer.unref?.()

  io.use(async (socket, next) => {
    try {
      const authToken = socket.handshake.auth?.token
      const token =
        (typeof authToken === "string" && authToken) ||
        readCookie(socket.handshake.headers.cookie)
      if (!token) return next(new Error("Not signed in"))
      if (await isDeviceBanned(socket.handshake.headers.cookie)) return next(new Error("Device banned"))
      socket.data.sessionToken = token

      const session = await db.session.findUnique({ where: { token }, include: { user: true } })
      if (!session || await isDeviceBanned(socket.handshake.headers.cookie, session.deviceHash)) return next(new Error("Invalid session"))
      if (session.expiresAt.getTime() < Date.now()) {
        await db.session.delete({ where: { id: session.id } }).catch(() => {})
        return next(new Error("Session expired"))
      }
      const permanentBan = session.user.role === "OWNER" || session.user.role === "HEAD_ADMIN" ? null : await db.infraction.findFirst({
        where: { userId: session.user.id, type: { in: ["BAN", "AUTO_BAN"] }, duration: null },
        select: { id: true },
      })
      if (permanentBan) {
        await db.session.deleteMany({ where: { userId: session.user.id } }).catch(() => {})
        return next(new Error("Account permanently banned"))
      }
      socket.data.deviceHash = session.deviceHash
      ;(socket as AuthedSocket).user = safeUser(session.user)
      next()
    } catch (err) {
      console.error("[socket] auth error:", err)
      next(new Error("Auth failed"))
    }
  })

  io.on("connection", (socket) => {
    const user = (socket as AuthedSocket).user
    socket.use(async (_packet, next) => {
      try {
        const session = await db.session.findUnique({ where: { token: socket.data.sessionToken }, include: { user: true } })
        if (!session || session.expiresAt.getTime() <= Date.now() || await isDeviceBanned(socket.handshake.headers.cookie, session.deviceHash)) {
          next(new Error("Session revoked")); socket.disconnect(true); return
        }
        Object.assign(user, safeUser(session.user))
        next()
      } catch { next(new Error("Session verification failed")) }
    })
    const wasUserAlreadyOnline = [...online.values()].some((entry) => entry.userId === user.userId)
    online.set(socket.id, user)
    if (!presenceByUser.has(user.userId)) {
      presenceByUser.set(user.userId, {
        mode: "online", modeExpiresAt: null, afk: false, afkMessage: "Away",
        currentSection: null, deviceType: null, networkQuality: null,
        showOnlineDuration: false, connectedAt: Date.now(), activity: null,
      })
    }
    setSocketClientCount(online.size)
    void broadcastGlobalPresence()
    if (!wasUserAlreadyOnline) {
      void db.friendship.findMany({ where: { status: "ACCEPTED", OR: [{ requesterId: user.userId }, { receiverId: user.userId }] }, select: { requesterId: true, receiverId: true }, take: 500 })
        .then((rows) => Promise.all(rows.map((row) => {
          const friendId = row.requesterId === user.userId ? row.receiverId : row.requesterId
          return runAutomationTrigger(friendId, "friend_online", { friendId: user.userId, username: user.username })
        })))
        .catch(() => {})
    }


    socket.on("presence-update", (payload: {
      mode?: unknown; modeExpiresAt?: unknown; afk?: unknown; afkMessage?: unknown;
      currentSection?: unknown; deviceType?: unknown; networkQuality?: unknown; showOnlineDuration?: unknown; activity?: unknown;
    } = {}) => {
      const current = presenceByUser.get(user.userId)
      if (!current) return
      const next = { ...current }
      next.mode = presenceMode(payload.mode)
      if (typeof payload.modeExpiresAt === "string") {
        const parsed = new Date(payload.modeExpiresAt).getTime()
        next.modeExpiresAt = Number.isFinite(parsed) && parsed > Date.now() && parsed <= Date.now() + 31 * 86400000 ? parsed : null
      } else if (payload.modeExpiresAt === null) next.modeExpiresAt = null
      next.afk = payload.afk === true
      if (typeof payload.afkMessage === "string") next.afkMessage = payload.afkMessage.trim().slice(0, 80) || "Away"
      next.currentSection = presenceSection(payload.currentSection)
      next.deviceType = ["desktop", "mobile", "tablet", "unknown"].includes(String(payload.deviceType)) ? payload.deviceType as PresenceState["deviceType"] : null
      next.networkQuality = ["good", "fair", "poor", "unknown"].includes(String(payload.networkQuality)) ? payload.networkQuality as PresenceState["networkQuality"] : null
      next.showOnlineDuration = payload.showOnlineDuration === true
      if (Object.prototype.hasOwnProperty.call(payload, "activity")) {
        const activity = normalizeRichPresenceActivity(payload.activity)
        if (activity) activityBySocket.set(socket.id, { userId: user.userId, activity, updatedAt: Date.now() })
        else activityBySocket.delete(socket.id)
      }
      next.activity = latestActivityForUser(user.userId)
      presenceByUser.set(user.userId, next)
      void broadcastGlobalPresence()
      for (const [channelId, ids] of channelRooms.entries()) {
        if ([...ids].some((id) => online.get(id)?.userId === user.userId)) void broadcastPresence(channelId)
      }
    })

    socket.on("join-channel", async ({ channelId, history = true }: { channelId: string; history?: boolean }) => {
      if (!validId(channelId)) return
      try {
        // Private direct and group channels require explicit membership.
        const ch = await accessibleChannel(channelId, user.userId, user.role)
        if (!ch) return
        socket.join(`channel:${channelId}`)
        if (!channelRooms.has(channelId)) channelRooms.set(channelId, new Set())
        channelRooms.get(channelId)!.add(socket.id)

        // Background joins exist only for unread/notification delivery. They
        // must not waste a 50-row query or overwrite an active tab that has
        // already paged farther back in history.
        if (history !== false) {
          const page = await messageHistoryPage(channelId, user.userId)
          socket.emit("message-history", { channelId, ...page })
        }
        void broadcastPresence(channelId)
      } catch (err) {
        console.error("[socket] join-channel error:", err)
      }
    })

    socket.on("load-older-messages", async ({ channelId, beforeId }: { channelId: string; beforeId: string }) => {
      if (!validId(channelId) || !validId(beforeId)) return
      if (!socket.rooms.has(`channel:${channelId}`)) return
      try {
        // Re-authorize every history page so a stale/demoted socket cannot use
        // pagination as a side door into a channel it can no longer access.
        if (!await accessibleChannel(channelId, user.userId, user.role)) {
          socket.leave(`channel:${channelId}`)
          channelRooms.get(channelId)?.delete(socket.id)
          return
        }
        const page = await messageHistoryPage(channelId, user.userId, beforeId)
        socket.emit("older-message-history", { channelId, beforeId, ...page })
      } catch (err) {
        console.error("[socket] load-older-messages error:", err)
        socket.emit("older-message-history", { channelId, beforeId, messages: [], hasMore: false, error: true })
      }
    })

    socket.on("leave-channel", ({ channelId }: { channelId: string }) => {
      if (!validId(channelId)) return
      socket.leave(`channel:${channelId}`)
      channelRooms.get(channelId)?.delete(socket.id)
      void broadcastPresence(channelId)
    })

    /**
     * Typing indicator. This handler did not exist before, so the client's
     * `typing` emits were silently discarded and indicators never appeared.
     */
    socket.on("typing", async ({ channelId, isTyping }: { channelId: string; isTyping: boolean }) => {
      if (!validId(channelId) || !socket.rooms.has(`channel:${channelId}`)) return
      if (!await accessibleChannel(channelId, user.userId, user.role)) {
        socket.leave(`channel:${channelId}`)
        channelRooms.get(channelId)?.delete(socket.id)
        return
      }
      await emitAuthorizedChannel(channelId, "typing", {
        channelId,
        userId: user.userId,
        username: user.username,
        isTyping: !!isTyping,
      }, socket.id)
    })

    socket.on("send-message", async ({ channelId, content, gifUrl, imageUrl, voiceUrl, replyToId, threadRootId, spoiler, clientNonce }: { channelId: string; content: string; gifUrl?: string; imageUrl?: string; voiceUrl?: string; replyToId?: string; threadRootId?: string; clientNonce?: unknown; spoiler?: { mediaType?: unknown; mediaId?: unknown; title?: unknown; season?: unknown; episode?: unknown; until?: unknown } }) => {
      const normalizedClientNonce = typeof clientNonce === "string" && /^[A-Za-z0-9:_-]{8,100}$/.test(clientNonce)
        ? clientNonce
        : null
      const rejectSend = (payload: { code?: string; message: string }) => socket.emit("mute-error", {
        ...payload,
        ...(normalizedClientNonce ? { clientNonce: normalizedClientNonce } : {}),
      })
      if (!validId(channelId)) {
        rejectSend({ code: "CHANNEL_INVALID", message: "[CHANNEL_INVALID] This channel is unavailable." })
        return
      }
      try {
        // Re-check mute state from the DB on every send.
        const fresh = await db.user.findUnique({
          where: { id: user.userId },
          select: { muted: true, mutedUntil: true, displayName: true, pfpUrl: true, pfpIsGif: true, role: true, avatarDeco: true, tags: true, status: true, statusExpiresAt: true },
        })
        if (fresh) {
          user.muted = fresh.muted
          user.mutedUntil = fresh.mutedUntil
          // Keep the cached profile fresh so avatars/names update live.
          user.displayName = fresh.displayName
          user.pfpUrl = fresh.pfpUrl
          user.pfpIsGif = fresh.pfpIsGif
          user.role = fresh.role
          user.avatarDeco = fresh.avatarDeco
          user.status = fresh.statusExpiresAt && fresh.statusExpiresAt.getTime() <= Date.now() ? "" : fresh.status
          user.statusExpiresAt = fresh.statusExpiresAt
          try { user.tags = JSON.parse(fresh.tags || '[]') } catch {}
        }
        if (isMutedNow(user)) {
          rejectSend({ code: "CHAT_MUTED", message: "You are muted and can't send messages." })
          return
        }
        if (await isAccountLockedDown(user.userId)) {
          rejectSend({ code: "ACCOUNT_LOCKDOWN", message: "Account lockdown is on. Turn it off in Security before sending messages." })
          return
        }

        const channel = await accessibleChannel(channelId, user.userId, user.role)
        if (!channel) {
          rejectSend({ code: "CHANNEL_FORBIDDEN", message: "[CHANNEL_FORBIDDEN] You cannot post to this channel." })
          return
        }
        if (channel.isAnnouncement && user.role !== "OWNER" && user.role !== "HEAD_ADMIN" && user.role !== "ADMIN") {
          rejectSend({ code: "CHANNEL_READ_ONLY", message: "[CHANNEL_READ_ONLY] Only administrators can post announcements." })
          return
        }
        let dmPeerId: string | null = null
        if (channel.isDM) {
          const other = await db.membership.findFirst({
            where: { channelId, userId: { not: user.userId } },
            select: { userId: true },
          })
          if (!other || await isDmSendBlocked(user.userId, other.userId)) {
            rejectSend({ code: "DM_BLOCKED", message: "[DM_BLOCKED] Direct messages are blocked between these accounts." })
            return
          }
          dmPeerId = other.userId
        }

        if (normalizedClientNonce) {
          const existing = await db.message.findUnique({ where: { userId_clientNonce: { userId: user.userId, clientNonce: normalizedClientNonce } }, include: { user: true, reactions: true } })
          if (existing) {
            if (existing.channelId !== channelId || existing.deleted) rejectSend({ code: "MESSAGE_NONCE_CONFLICT", message: "This message retry is no longer available." })
            else socket.emit("message", serializeHistoryMessage(existing, user.userId))
            return
          }
        }

        const text = typeof content === "string" ? content.trim() : ""
        if (/^@(mute|unmute|ban|unban)\b/i.test(text)) {
          const rate = consumeChatAction(user.userId)
          if (!rate.allowed) { rejectSend({ message: "Wait before issuing another command" }); return }
          try {
            const reply = await runModerationCommand(user.userId, text, normalizedClientNonce || undefined)
            socket.emit("bot-command-result", { channelId, clientNonce: normalizedClientNonce, message: reply, ok: true })
          } catch (error) {
            socket.emit("bot-command-result", { channelId, clientNonce: normalizedClientNonce, message: error instanceof ModerationError ? error.message : "Moderation action failed", ok: false })
          }
          return
        }

        // Only direct assets on GIPHY's official media CDN are accepted. This
        // blocks arbitrary tracking/image hosts while following GIPHY's rule
        // that returned media must not be proxied or cached by the app.
        const gif = typeof gifUrl === "string" ? verifiedGiphyMediaUrl(gifUrl) : null
        if (gifUrl && !gif) {
          rejectSend({ code: "GIF_INVALID", message: "[GIF_INVALID] Select GIFs using the chat GIF picker." })
          return
        }

        let image: { url: string; id: string } | null = null
        if (imageUrl) {
          const requested = typeof imageUrl === "string" ? imageUrl.trim() : ""
          const upload = requested ? await db.chatImageUpload.findUnique({ where: { url: requested } }) : null
          if (!upload || upload.userId !== user.userId || upload.consumedAt || upload.expiresAt.getTime() <= Date.now()) {
            rejectSend({ code: "IMAGE_INVALID", message: "[IMAGE_INVALID] Upload the image with Synnical before sending it." })
            return
          }
          image = { id: upload.id, url: upload.url }
        }

        let voice: { url: string; transcript: string; id: string } | null = null
        if (voiceUrl) {
          const requested = typeof voiceUrl === "string" ? voiceUrl.trim() : ""
          const upload = requested ? await db.voiceUpload.findUnique({ where: { url: requested } }) : null
          if (!upload || upload.userId !== user.userId || upload.consumedAt || upload.expiresAt.getTime() <= Date.now()) {
            rejectSend({ code: "VOICE_INVALID", message: "[VOICE_INVALID] Record the voice note with Synnical before sending it." })
            return
          }
          voice = { id: upload.id, url: upload.url, transcript: upload.transcript }
        }
        if ((!text && !gif && !image && !voice) || text.length > 2000) {
          rejectSend({ code: "MESSAGE_INVALID", message: "[MESSAGE_INVALID] Write a message of 2,000 characters or fewer." })
          return
        }

        let spoilerMeta: { mediaType: "movie" | "tv"; mediaId: string; title: string; season: number | null; episode: number | null; until: Date } | null = null
        if (spoiler && typeof spoiler === "object") {
          const mediaType = spoiler.mediaType === "movie" || spoiler.mediaType === "tv" ? spoiler.mediaType : null
          const mediaId = typeof spoiler.mediaId === "string" ? spoiler.mediaId.trim().slice(0, 128) : ""
          const title = typeof spoiler.title === "string" ? spoiler.title.trim().slice(0, 160) : ""
          const season = mediaType === "tv" && Number.isInteger(Number(spoiler.season)) && Number(spoiler.season) > 0 ? Math.min(9999, Number(spoiler.season)) : null
          const episode = mediaType === "tv" && Number.isInteger(Number(spoiler.episode)) && Number(spoiler.episode) > 0 ? Math.min(9999, Number(spoiler.episode)) : null
          const requestedUntil = typeof spoiler.until === "string" || typeof spoiler.until === "number" ? new Date(spoiler.until) : new Date(Date.now() + 30 * 86400000)
          const maxUntil = Date.now() + 365 * 86400000
          const until = Number.isFinite(requestedUntil.getTime()) ? new Date(Math.min(Math.max(requestedUntil.getTime(), Date.now() + 60000), maxUntil)) : new Date(Date.now() + 30 * 86400000)
          if (mediaType && mediaId && title && (mediaType === "movie" || (season && episode))) spoilerMeta = { mediaType, mediaId, title, season, episode, until }
        }

        let threadRoot: string | null = null
        if (threadRootId !== undefined) {
          if (!validId(threadRootId)) {
            rejectSend({ code: "THREAD_INVALID", message: "[THREAD_INVALID] That thread is unavailable." })
            return
          }
          const root = await db.message.findUnique({ where: { id: threadRootId }, select: { id: true, channelId: true, deleted: true, threadRootId: true } })
          if (!root || root.channelId !== channelId || root.deleted) {
            rejectSend({ code: "THREAD_NOT_FOUND", message: "[THREAD_NOT_FOUND] That thread is unavailable." })
            return
          }
          threadRoot = root.threadRootId || root.id
        }

        let replySnapshot: { replyToId: string; replyToName: string; replyToContent: string } | null = null
        let replyToUserId: string | null = null
        let replyingToSynnBot = false
        if (replyToId !== undefined) {
          if (!validId(replyToId)) {
            rejectSend({ code: "REPLY_INVALID", message: "[REPLY_INVALID] The original message is invalid." })
            return
          }
          const target = await db.message.findUnique({
            where: { id: replyToId },
            include: { user: { select: { displayName: true } } },
          })
          if (!target || target.channelId !== channelId || target.deleted) {
            rejectSend({ code: "REPLY_NOT_FOUND", message: "[REPLY_NOT_FOUND] The original message is unavailable." })
            return
          }
          const targetPreview = target.content.trim().slice(0, 180) || (target.imageUrl ? "Image" : target.gifUrl ? "GIF" : "Message")
          replySnapshot = {
            replyToId: target.id,
            replyToName: (target.user?.displayName || target.username).slice(0, 80),
            replyToContent: targetPreview,
          }
          replyToUserId = target.userId
          replyingToSynnBot = target.username === "synn-bot" && target.userId === null
        }

        const rate = consumeChatAction(user.userId)
        if (!rate.allowed) {
          rejectSend({
            code: "CHAT_RATE_LIMITED",
            message: `[CHAT_RATE_LIMITED] Please wait ${Math.ceil(rate.retryAfterMs / 1_000)} second(s).`,
          })
          return
        }

        if (channel.slowModeSeconds > 0 && !["OWNER", "HEAD_ADMIN", "ADMIN", "MOD"].includes(user.role)) {
          const previous = await db.message.findFirst({ where: { channelId, userId: user.userId, deleted: false }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
          const waitMs = previous ? previous.createdAt.getTime() + channel.slowModeSeconds * 1000 - Date.now() : 0
          if (waitMs > 0) {
            rejectSend({ code: "CHANNEL_SLOW_MODE", message: `[CHANNEL_SLOW_MODE] Wait ${Math.ceil(waitMs / 1000)} second(s) before posting again.` })
            return
          }
        }

        if (text) {
          const recent = await db.message.findMany({
            where: { channelId, deleted: false },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { username: true, content: true },
          })
          const moderation = await moderateTextContent({ content: text, context: recent.reverse(), surface: "chat" })
          if (moderation.decision !== "allow") {
            await rejectModeratedContent(socket, user, moderation, normalizedClientNonce)
            return
          }
        }

        if (dmPeerId) await ensureFriendshipBond(user.userId, dmPeerId).catch(() => {})

        const names = mentionNames(text)
        const candidates = names.length ? await db.user.findMany({ where: { OR: names.map(username => ({ username: { equals: username } })) }, select: { id: true, role: true } }) : []
        const mentionedUserIds: string[] = []
        for (const target of candidates) if (target.id !== user.userId && await accessibleChannel(channelId, target.id, target.role) && !await isDmSendBlocked(user.userId, target.id)) mentionedUserIds.push(target.id)
        let duplicateSend = false
        const created = await db.message.create({
          data: {
            channelId,
            userId: user.userId,
            username: user.username,
            content: text,
            clientNonce: normalizedClientNonce,
            mentionedUserIds: JSON.stringify(mentionedUserIds),
            gifUrl: gif,
            imageUrl: image?.url || null,
            voiceUrl: voice?.url || null,
            voiceTranscript: voice?.transcript || null,
            messageType: voice ? "voice" : image ? "image" : threadRoot ? "thread" : "text",
            threadRootId: threadRoot,
            spoilerMediaType: spoilerMeta?.mediaType || null,
            spoilerMediaId: spoilerMeta?.mediaId || null,
            spoilerTitle: spoilerMeta?.title || null,
            spoilerSeason: spoilerMeta?.season || null,
            spoilerEpisode: spoilerMeta?.episode || null,
            spoilerUntil: spoilerMeta?.until || null,
            ...(replySnapshot || {}),
          },
        }).catch(async (error) => {
          if (normalizedClientNonce && error?.code === "P2002") {
            const existing = await db.message.findUnique({ where: { userId_clientNonce: { userId: user.userId, clientNonce: normalizedClientNonce } } })
            if (existing && existing.channelId === channelId && !existing.deleted) { duplicateSend = true; return existing }
          }
          throw error
        })

        if (duplicateSend) {
          const row = await db.message.findUnique({ where: { id: created.id }, include: { user: true, reactions: true } })
          if (row) socket.emit("message", serializeHistoryMessage(row, user.userId))
          return
        }

        await emitAuthorizedChannel(channelId, "message", {
          id: created.id, channelId: created.channelId, userId: user.userId,
          clientNonce: normalizedClientNonce,
          username: user.username, displayName: user.displayName, pfpUrl: user.pfpUrl,
          pfpIsGif: user.pfpIsGif, role: user.role, tags: user.tags, avatarDeco: user.avatarDeco,
          content: text, gifUrl: gif, imageUrl: created.imageUrl, voiceUrl: created.voiceUrl, voiceTranscript: created.voiceTranscript, messageType: created.messageType, threadRootId: created.threadRootId, deleted: false, edited: false,
          mentionedUserIds: parseMentionIds(created.mentionedUserIds),
          replyToId: created.replyToId, replyToName: created.replyToName, replyToContent: created.replyToContent,
          spoilerMediaType: created.spoilerMediaType, spoilerMediaId: created.spoilerMediaId, spoilerTitle: created.spoilerTitle,
          spoilerSeason: created.spoilerSeason, spoilerEpisode: created.spoilerEpisode, spoilerUntil: created.spoilerUntil,
          createdAt: created.createdAt,
          reactions: [],
        })

        // Everything below is secondary bookkeeping. The durable message is
        // broadcast first; XP, bonds, credits and automations must never make
        // recipients wait for unrelated database or economy work.
        const postSendTasks: PostSendTask[] = [
          { name: "message count", run: () => db.user.update({ where: { id: user.userId }, data: { messageCount: { increment: 1 } } }) },
          { name: "XP", run: () => addXp(user.userId, 2) },
          { name: "challenge", run: () => advanceChallenge(user.userId, "messages", 1) },
          { name: "achievement", run: () => earnAchievement(user.userId, "first-message") },
          { name: "outgoing automation", run: () => runAutomationTrigger(user.userId, "message_contains", { content: text, direction: "outgoing", channelId }) },
          { name: "message reward", run: async () => {
            const { rewardMessage } = await import("./shop")
            await rewardMessage(user.userId)
          } },
        ]
        if (dmPeerId) {
          postSendTasks.push(
            { name: "friendship", run: () => recordFriendshipMessage(user.userId, dmPeerId) },
            { name: "incoming automation", run: () => runAutomationTrigger(dmPeerId, "message_contains", { content: text, direction: "incoming", channelId, fromUserId: user.userId, fromUsername: user.username }) },
          )
        }
        if (image) postSendTasks.push({ name: "image consumption", run: () => db.chatImageUpload.update({ where: { id: image.id }, data: { consumedAt: new Date() } }) })
        if (voice) postSendTasks.push({ name: "voice consumption", run: () => db.voiceUpload.update({ where: { id: voice.id }, data: { consumedAt: new Date() } }) })
        void enqueuePostSendBookkeeping(created.id, postSendTasks)

        let botReply = synnBotReply(text)
        let ownerAction = null as Awaited<ReturnType<typeof runOwnerJarvisRequest>>
        try {
          ownerAction = await runOwnerJarvisRequest(text, { id: user.userId, username: user.username, role: user.role, channelId, sourceMessageId: created.id, replyToUserId })
        } catch (error) {
          console.error("[synn-bot] owner action failed:", error)
          ownerAction = { reply: "That Owner operation failed safely before I reported success. Nothing was claimed as completed." }
        }
        if (ownerAction?.deletedMessageIds?.length) {
          for (const id of ownerAction.deletedMessageIds) await emitAuthorizedChannel(channelId, "message-deleted", { id, channelId })
        }
        let botFeature = null as Awaited<ReturnType<typeof runSynnBotFeature>>
        try { botFeature = ownerAction ? null : await runSynnBotFeature(text, { userId: user.userId, username: user.username, role: user.role, channelId, replyingToSynnBot }) } catch (error) {
          console.error("[synn-bot] feature command failed:", error)
          botReply = "That Synn Bot tool hit a temporary error. Nothing was partially applied."
        }
        if (ownerAction) botReply = ownerAction.reply
        else if (botFeature) botReply = botFeature.reply
        const botCommand = text.trim().match(/^\/([a-z0-9_-]+)/i)?.[1]?.toLowerCase()
        if (botCommand) await db.botUsage.create({ data: { userId: user.userId, command: botCommand, success: Boolean(botReply || synnBotAiRequest(text)) } }).catch(() => {})
        const botAi = ownerAction || botFeature ? null : synnBotAiRequest(text) || (replyingToSynnBot && text
          ? { command: "reply", instruction: "Continue the Synn Bot conversation and answer the user's follow-up.", mode: "Use the most appropriate clear format", request: text.slice(0, 4000) }
          : null)
        if (botAi) {
          const context = await db.message.findMany({
            where: { channelId, deleted: false, id: { not: created.id } },
            orderBy: { createdAt: "desc" },
            take: 8,
            select: { username: true, content: true },
          })
          botReply = await runSynnBotAi(botAi, context.reverse())
          const botModeration = await moderateTextContent({ content: botReply, surface: "chat" })
          if (botModeration.decision !== "allow") botReply = "I can't help with that request, but I can help with a safer version."
        }
        if (botReply) {
          const botProfile = await getSynnBotProfile().catch(() => ({ avatarDeco: null, profileEffect: null }))
          const botMessage = await db.message.create({
            data: { channelId, userId: null, username: "synn-bot", content: botReply, gifUrl: null },
          })
          await emitAuthorizedChannel(channelId, "message", {
            id: botMessage.id, channelId, userId: null,
            username: "synn-bot", displayName: "synn Bot", pfpUrl: "/brand/synn-bot.svg",
            pfpIsGif: false, role: "MEMBER", avatarDeco: botProfile.avatarDeco,
            isBot: true, reactions: [],
            content: botReply, gifUrl: null, deleted: false, edited: false,
            createdAt: botMessage.createdAt,
          })
        }
        // Stop any lingering typing indicator for this user.
        await emitAuthorizedChannel(channelId, "typing", {
          channelId, userId: user.userId, username: user.username, isTyping: false,
        }, socket.id)
      } catch (err) {
        console.error("[socket] send-message error:", err)
        rejectSend({ code: "CHAT_SEND_FAILED", message: "Message failed to send." })
      }
    })

    socket.on("publish-poll-message", async ({ messageId }: { messageId?: string }) => {
      if (!validId(messageId)) return
      try {
        const message = await db.message.findUnique({ where: { id: messageId }, include: { user: true } })
        if (!message || message.userId !== user.userId || message.messageType !== "poll") return
        const poll = await db.poll.findFirst({ where: { messageId: message.id, channelId: message.channelId, createdById: user.userId } })
        if (!poll || Date.now() - poll.createdAt.getTime() > 120_000) return
        const channel = await accessibleChannel(message.channelId, user.userId, user.role)
        if (!channel) return
        await emitAuthorizedChannel(message.channelId, "message", {
          id: message.id, channelId: message.channelId, userId: message.userId, username: message.username,
          displayName: message.user?.displayName || user.displayName, pfpUrl: message.user?.pfpUrl || user.pfpUrl,
          pfpIsGif: message.user?.pfpIsGif ?? user.pfpIsGif, role: message.user?.role || user.role, tags: (() => { try { return JSON.parse(message.user?.tags || "[]") as string[] } catch { return user.tags } })(), avatarDeco: message.user?.avatarDeco || user.avatarDeco,
          content: message.content, gifUrl: null, voiceUrl: null, voiceTranscript: null, messageType: "poll", threadRootId: null,
          replyToId: null, replyToName: null, replyToContent: null, createdAt: message.createdAt, reactions: [],
        })
      } catch (error) {
        console.error("[chat] failed to publish poll message:", error)
      }
    })

    /**
     * Edit a message. Also previously missing on the server, so the client's
     * edit UI appeared to work but never persisted or broadcast.
     */
    socket.on("edit-message", async ({ messageId, channelId, content }: { messageId: string; channelId: string; content: string }) => {
      if (!validId(messageId) || !validId(channelId)) return
      try {
        const text = typeof content === "string" ? content.trim() : ""
        if (text.length === 0 || text.length > 2000) return

        const existing = await db.message.findUnique({ where: { id: messageId } })
        if (!existing || existing.deleted || existing.channelId !== channelId) return
        // Authors edit their own messages; the owner may edit any.
        if (existing.userId !== user.userId && user.role !== "OWNER" && user.role !== "HEAD_ADMIN") return

        const channel = await accessibleChannel(channelId, user.userId, user.role)
        if (!channel) return
        if (channel.isAnnouncement && user.role !== "OWNER" && user.role !== "HEAD_ADMIN" && user.role !== "ADMIN") return

        const rate = consumeChatAction(user.userId)
        if (!rate.allowed) {
          socket.emit("mute-error", {
            code: "CHAT_RATE_LIMITED",
            message: `[CHAT_RATE_LIMITED] Please wait ${Math.ceil(rate.retryAfterMs / 1_000)} second(s).`,
          })
          return
        }

        const recent = await db.message.findMany({
          where: { channelId, deleted: false },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { username: true, content: true },
        })
        const moderation = await moderateTextContent({ content: text, context: recent.reverse(), surface: "message_edit" })
        if (moderation.decision !== "allow") {
          await rejectModeratedContent(socket, user, moderation)
          return
        }

        const editedAt = new Date()
        await db.messageEditHistory.create({ data: { messageId, editorId: user.userId, oldContent: existing.content, newContent: text, editedAt } })
        await db.message.update({
          where: { id: messageId },
          data: { content: text, edited: true, editedAt },
        })
        await emitAuthorizedChannel(channelId, "message-edited", {
          id: messageId, channelId, content: text, editedAt: editedAt.toISOString(),
        })
      } catch (err) {
        console.error("[socket] edit-message error:", err)
      }
    })

    socket.on("delete-message", async ({ messageId, channelId }: { messageId: string; channelId: string }) => {
      if (!validId(messageId) || !validId(channelId)) return
      try {
        const existing = await db.message.findUnique({
          where: { id: messageId },
          include: { user: { select: { role: true } } },
        })
        if (!existing || existing.channelId !== channelId) return
        if (!await accessibleChannel(channelId, user.userId, user.role)) return
        if (!canDeleteMessage(user.role as MessageRole, user.userId, existing.user?.role as MessageRole | undefined, existing.userId)) {
          socket.emit("mute-error", { code: "MESSAGE_DELETE_FORBIDDEN", message: "[MESSAGE_DELETE_FORBIDDEN] You cannot delete a message from this role." })
          return
        }

        await db.message.update({ where: { id: messageId }, data: { deleted: true, content: "", gifUrl: null, imageUrl: null } })
        await emitAuthorizedChannel(channelId, "message-deleted", { id: messageId, channelId })
      } catch (err) {
        console.error("[socket] delete-message error:", err)
      }
    })

    socket.on("toggle-reaction", async ({ messageId, channelId, emoji }: { messageId: string; channelId: string; emoji: string }) => {
      if (!validId(messageId) || !validId(channelId) || typeof emoji !== "string" || !CHAT_REACTION_EMOJI_SET.has(emoji)) return
      try {
        if (!await accessibleChannel(channelId, user.userId, user.role)) return
        const message = await db.message.findUnique({ where: { id: messageId }, select: { channelId: true, deleted: true } })
        if (!message || message.channelId !== channelId || message.deleted) return

        const key = { messageId_userId_emoji: { messageId, userId: user.userId, emoji } }
        const existing = await db.messageReaction.findUnique({ where: key, select: { id: true } })
        if (existing) await db.messageReaction.delete({ where: { id: existing.id } })
        else {
          const ownReactionCount = await db.messageReaction.count({ where: { messageId, userId: user.userId } })
          if (ownReactionCount >= 20) {
            socket.emit("mute-error", { code: "REACTION_LIMIT", message: "[REACTION_LIMIT] Remove one of your reactions before adding another." })
            return
          }
          await db.messageReaction.create({ data: { messageId, userId: user.userId, emoji } })
        }

        const reactions = await db.messageReaction.findMany({ where: { messageId }, select: { emoji: true, userId: true } })
        // Each viewer needs its own `reacted` flag, so broadcast raw bounded
        // rows and let clients derive their personal flag.
        await emitAuthorizedChannel(channelId, "message-reactions", { messageId, channelId, reactions })
      } catch (err) {
        console.error("[socket] toggle-reaction error:", err)
      }
    })

    socket.on("join-watch-party", async ({ partyId }: { partyId: string }) => {
      if (!validId(partyId)) return
      try {
        const party = await db.watchParty.findFirst({ where: { id: partyId, status: "active" } })
        if (!party) return socket.emit("watch-party-error", { partyId, error: "Watch party not found" })
        const authorized = party.hostId === user.userId || Boolean(await db.watchPartyMember.findUnique({ where: { partyId_userId: { partyId, userId: user.userId } } }))
        if (!authorized) return socket.emit("watch-party-error", { partyId, error: "Join this party first" })
        socket.join(`watch-party:${partyId}`)
        socket.emit("watch-party-state", { ...party, serverTime: Date.now(), host: party.hostId === user.userId })
        const sockets = await io.in(`watch-party:${partyId}`).fetchSockets()
        io.to(`watch-party:${partyId}`).emit("watch-party-presence", { partyId, connected: sockets.length })
      } catch (error) {
        console.error("[socket] join-watch-party error:", error)
      }
    })

    socket.on("watch-party-state", async ({ partyId, currentTime, playing, season, episode }: { partyId: string; currentTime: number; playing: boolean; season?: number | null; episode?: number | null }) => {
      if (!validId(partyId) || !socket.rooms.has(`watch-party:${partyId}`)) return
      try {
        const party = await db.watchParty.findFirst({ where: { id: partyId, hostId: user.userId, status: "active" } })
        if (!party) return
        const now = Date.now()
        const key = `${partyId}:${user.userId}`
        const last = watchPartyUpdateWindows.get(key) || 0
        if (now - last < 750 && playing === party.playing) return
        watchPartyUpdateWindows.set(key, now)
        const safeTime = Math.max(0, Math.min(86400, Number(currentTime) || 0))
        const nextSeason = Number.isSafeInteger(Number(season)) && Number(season) > 0 ? Number(season) : party.season
        const nextEpisode = Number.isSafeInteger(Number(episode)) && Number(episode) > 0 ? Number(episode) : party.episode
        const updated = await db.watchParty.update({ where: { id: partyId }, data: { currentTime: safeTime, playing: Boolean(playing), season: nextSeason, episode: nextEpisode } })
        socket.to(`watch-party:${partyId}`).emit("watch-party-state", { ...updated, serverTime: now, host: false })
      } catch (error) {
        console.error("[socket] watch-party-state error:", error)
      }
    })

    socket.on("call-create", ({ kind }: { kind?: unknown } = {}) => {
      leaveCall(socket.id)
      const code = callCode(); const room: CallRoom = { code, kind: kind === "voice" ? "voice" : "video", createdBy: user.userId, createdAt: Date.now(), members: new Map() }
      const member: CallMember = { socketId: socket.id, userId: user.userId, username: user.username, displayName: user.displayName || user.username, muted: false, video: room.kind === "video", screen: false }
      room.members.set(socket.id, member); callRooms.set(code, room); callRoomBySocket.set(socket.id, code); socket.join(`call:${code}`)
      socket.emit("call-room", { code, kind: room.kind, createdBy: room.createdBy, peers: [], me: publicCallMember(member) })
    })

    socket.on("call-join", ({ code }: { code?: unknown } = {}) => {
      const normalized = typeof code === "string" ? code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : ""
      const room = callRooms.get(normalized)
      if (!room || Date.now() - room.createdAt > 12 * 60 * 60 * 1000) { socket.emit("call-error", { message: "That call invite is no longer active." }); return }
      if (room.members.size >= 6) { socket.emit("call-error", { message: "This call already has the maximum of 6 people." }); return }
      leaveCall(socket.id)
      const peers = [...room.members.values()].map(publicCallMember)
      const member: CallMember = { socketId: socket.id, userId: user.userId, username: user.username, displayName: user.displayName || user.username, muted: false, video: room.kind === "video", screen: false }
      room.members.set(socket.id, member); callRoomBySocket.set(socket.id, normalized); socket.join(`call:${normalized}`)
      socket.emit("call-room", { code: normalized, kind: room.kind, createdBy: room.createdBy, peers, me: publicCallMember(member) })
      socket.to(`call:${normalized}`).emit("call-peer-joined", { peer: publicCallMember(member) })
    })

    socket.on("call-signal", ({ targetSocketId, signal }: { targetSocketId?: unknown; signal?: unknown } = {}) => {
      const target = typeof targetSocketId === "string" ? targetSocketId : ""; if (!target || !signal || typeof signal !== "object") return
      const code = callRoomBySocket.get(socket.id); if (!code || callRoomBySocket.get(target) !== code) return
      const room = callRooms.get(code); if (!room?.members.has(socket.id) || !room.members.has(target)) return
      io.to(target).emit("call-signal", { fromSocketId: socket.id, signal })
    })

    socket.on("call-state", ({ muted, video, screen }: { muted?: unknown; video?: unknown; screen?: unknown } = {}) => {
      const code = callRoomBySocket.get(socket.id); const room = code ? callRooms.get(code) : null; const member = room?.members.get(socket.id); if (!code || !room || !member) return
      if (typeof muted === "boolean") member.muted = muted
      if (typeof video === "boolean") member.video = video
      if (typeof screen === "boolean") member.screen = screen
      socket.to(`call:${code}`).emit("call-peer-state", { peer: publicCallMember(member) })
    })

    socket.on("call-leave", () => leaveCall(socket.id))

    socket.on("leave-watch-party", async ({ partyId }: { partyId: string }) => {
      if (!validId(partyId)) return
      socket.leave(`watch-party:${partyId}`)
      const sockets = await io.in(`watch-party:${partyId}`).fetchSockets().catch(() => [])
      io.to(`watch-party:${partyId}`).emit("watch-party-presence", { partyId, connected: sockets.length })
    })

    socket.on("channels-changed", ({ audience }: { audience?: unknown } = {}) => {
      if (!canManageChannels(user.role)) return
      const normalized = normalizeChannelAudience(audience)
      if (!normalized) return
      for (const [socketId, target] of online) {
        if (normalized === "STAFF" && !isStaffChannelRole(target.role)) continue
        io.to(socketId).emit("channels-updated")
      }
    })

    /** Let a client pull the global online list on demand. */
    socket.on("who-is-online", async () => {
      socket.emit("online-users", { users: await usersForViewer(online.keys(), user.userId) })
    })

    socket.on("disconnect", () => {
      leaveCall(socket.id)
      online.delete(socket.id)
      activityBySocket.delete(socket.id)
      if (![...online.values()].some((entry) => entry.userId === user.userId)) presenceByUser.delete(user.userId)
      setSocketClientCount(online.size)
      for (const [channelId, ids] of channelRooms.entries()) {
        if (ids.delete(socket.id)) {
          void broadcastPresence(channelId)
          if (ids.size === 0) channelRooms.delete(channelId)
        }
      }
      void broadcastGlobalPresence()
    })
  })

  return io
}
