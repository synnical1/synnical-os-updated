import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { requireChannelAccess, isStaffRole } from "@/lib/feature-auth"
import { canManageChannels } from "@/lib/channel-permissions"
import { completeWithAiPool } from "@/lib/ai-provider-pool"
import { advanceChallenge, earnAchievement } from "@/lib/feature-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const URL_RE = /https?:\/\/[^\s<>()\[\]{}"']+/gi

function s(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}
function id(value: unknown): string {
  const out = s(value, 128)
  return /^[A-Za-z0-9_-]{1,128}$/.test(out) ? out : ""
}
function jsonError(error: string, status = 400) { return NextResponse.json({ error }, { status }) }

async function channelOr403(channelId: string, me: { id: string; role: string }) {
  return requireChannelAccess(channelId, me.id, me.role)
}

function serializeFeatureMessage(message: any, viewerId: string) {
  const reactionGroups = new Map<string, { count: number; reacted: boolean }>()
  for (const reaction of message.reactions || []) {
    const current = reactionGroups.get(reaction.emoji) || { count: 0, reacted: false }
    current.count += 1
    if (reaction.userId === viewerId) current.reacted = true
    reactionGroups.set(reaction.emoji, current)
  }
  return {
    id: message.id, channelId: message.channelId, userId: message.userId, username: message.username,
    displayName: message.user?.displayName || message.username, pfpUrl: message.user?.pfpUrl || null, pfpIsGif: Boolean(message.user?.pfpIsGif),
    role: message.user?.role || "MEMBER", avatarDeco: message.user?.avatarDeco || null,
    content: message.content, deleted: message.deleted, edited: message.edited, gifUrl: message.gifUrl, imageUrl: message.imageUrl, voiceUrl: message.voiceUrl,
    voiceTranscript: message.voiceTranscript, messageType: message.messageType, threadRootId: message.threadRootId,
    replyToId: message.replyToId, replyToName: message.replyToName, replyToContent: message.replyToContent,
    spoilerMediaType: message.spoilerMediaType, spoilerMediaId: message.spoilerMediaId, spoilerTitle: message.spoilerTitle,
    spoilerSeason: message.spoilerSeason, spoilerEpisode: message.spoilerEpisode, spoilerUntil: message.spoilerUntil, createdAt: message.createdAt,
    isBot: !message.userId && message.username === "synn-bot",
    reactions: [...reactionGroups.entries()].map(([emoji, value]) => ({ emoji, ...value })),
  }
}

async function serializePoll(poll: any, viewerId: string) {
  const options = await db.pollOption.findMany({ where: { pollId: poll.id }, orderBy: { position: "asc" } })
  const votes = await db.pollVote.findMany({ where: { pollId: poll.id }, select: { optionId: true, userId: true, createdAt: true } })
  const counts = new Map<string, number>()
  for (const vote of votes) counts.set(vote.optionId, (counts.get(vote.optionId) || 0) + 1)
  return {
    ...poll,
    options: options.map((option) => ({ id: option.id, label: option.label, count: counts.get(option.id) || 0 })),
    myVotes: votes.filter((vote) => vote.userId === viewerId).map((vote) => vote.optionId),
    voters: poll.anonymous ? undefined : votes.map((vote) => ({ optionId: vote.optionId, userId: vote.userId })),
    totalVotes: votes.length,
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return jsonError("Unauthorized", 401)
  const url = new URL(req.url)
  const action = url.searchParams.get("action") || "preferences"
  const channelId = id(url.searchParams.get("channelId"))

  if (action === "preferences") {
    const rows = await db.channelPreference.findMany({ where: { userId: me.id }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] })
    return NextResponse.json({ preferences: rows })
  }

  if (action === "saved") {
    const rows = await db.savedMessage.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 250 })
    const messageIds = rows.map((row) => row.messageId)
    const messages = messageIds.length ? await db.message.findMany({ where: { id: { in: messageIds }, deleted: false }, include: { user: true } }) : []
    const accessible = await Promise.all(messages.map(async (message) => await channelOr403(message.channelId, me) ? message : null))
    const byId = new Map(accessible.filter((message) => message !== null).map((message) => [message.id, serializeFeatureMessage(message, me.id)]))
    return NextResponse.json({ saved: rows.map((row) => ({ ...row, message: byId.get(row.messageId) || null })).filter((row) => row.message) })
  }

  if (action === "scheduled") {
    const rows = await db.scheduledMessage.findMany({ where: { userId: me.id }, orderBy: { sendAt: "asc" }, take: 200 })
    return NextResponse.json({ scheduled: rows })
  }

  if (action === "edits") {
    const messageId = id(url.searchParams.get("messageId"))
    if (!messageId) return jsonError("messageId required")
    const message = await db.message.findUnique({ where: { id: messageId } })
    if (!message || !await channelOr403(message.channelId, me)) return jsonError("Not found", 404)
    const edits = await db.messageEditHistory.findMany({ where: { messageId }, orderBy: { editedAt: "asc" }, take: 100 })
    return NextResponse.json({ edits })
  }

  if (action === "thread") {
    const messageId = id(url.searchParams.get("messageId"))
    if (!messageId) return jsonError("messageId required")
    const rootCandidate = await db.message.findUnique({ where: { id: messageId }, include: { user: true } })
    if (!rootCandidate || !await channelOr403(rootCandidate.channelId, me)) return jsonError("Not found", 404)
    const rootId = rootCandidate.threadRootId || rootCandidate.id
    const root = rootCandidate.id === rootId ? rootCandidate : await db.message.findUnique({ where: { id: rootId }, include: { user: true } })
    const replies = await db.message.findMany({ where: { channelId: rootCandidate.channelId, threadRootId: rootId, deleted: false }, include: { user: true }, orderBy: { createdAt: "asc" }, take: 500 })
    return NextResponse.json({ root: root && root.channelId === rootCandidate.channelId && !root.deleted ? serializeFeatureMessage(root, me.id) : null, replies: replies.map((message) => serializeFeatureMessage(message, me.id)) })
  }

  if (action === "poll-message") {
    const messageId = id(req.nextUrl.searchParams.get("messageId"))
    const poll = messageId ? await db.poll.findFirst({ where: { messageId } }) : null
    if (!poll || !await channelOr403(poll.channelId, me)) return jsonError("Poll not found", 404)
    return NextResponse.json({ poll: await serializePoll(poll, me.id) })
  }

  if (!channelId) return jsonError("channelId required")
  const channel = await channelOr403(channelId, me)
  if (!channel) return jsonError("Forbidden", 403)


  if (action === "around") {
    const messageId = id(url.searchParams.get("messageId"))
    if (!messageId) return jsonError("messageId required")
    const target = await db.message.findFirst({ where: { id: messageId, channelId, deleted: false }, select: { id: true, createdAt: true } })
    if (!target) return jsonError("Message not found", 404)
    const include = { user: true, reactions: true } as const
    const [before, after] = await Promise.all([
      db.message.findMany({ where: { channelId, deleted: false, createdAt: { lte: target.createdAt } }, include, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 60 }),
      db.message.findMany({ where: { channelId, deleted: false, createdAt: { gt: target.createdAt } }, include, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 60 }),
    ])
    const unique = new Map([...before.reverse(), ...after].map((message) => [message.id, message]))
    return NextResponse.json({ messages: [...unique.values()].map((message) => serializeFeatureMessage(message, me.id)), focusMessageId: target.id })
  }

  if (action === "search") {
    const q = s(url.searchParams.get("q"), 200)
    const userId = id(url.searchParams.get("userId"))
    const from = url.searchParams.get("from") ? new Date(String(url.searchParams.get("from"))) : null
    const to = url.searchParams.get("to") ? new Date(String(url.searchParams.get("to"))) : null
    const media = url.searchParams.get("media")
    const where: any = { channelId, deleted: false }
    if (q) where.content = { contains: q }
    if (userId) where.userId = userId
    if (from && Number.isFinite(from.getTime())) where.createdAt = { ...(where.createdAt || {}), gte: from }
    if (to && Number.isFinite(to.getTime())) where.createdAt = { ...(where.createdAt || {}), lte: to }
    if (media === "1") where.OR = [{ gifUrl: { not: null } }, { imageUrl: { not: null } }, { voiceUrl: { not: null } }]
    const messages = await db.message.findMany({ where, include: { user: true }, orderBy: { createdAt: "desc" }, take: 200 })
    return NextResponse.json({ messages: messages.map((message) => serializeFeatureMessage(message, me.id)) })
  }

  if (action === "gallery") {
    const messages = await db.message.findMany({ where: { channelId, deleted: false }, select: { id: true, username: true, content: true, gifUrl: true, imageUrl: true, voiceUrl: true, voiceTranscript: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1000 })
    const media: any[] = []
    const links: any[] = []
    for (const message of messages) {
      if (message.gifUrl) media.push({ messageId: message.id, type: "gif", url: message.gifUrl, username: message.username, createdAt: message.createdAt })
      if (message.imageUrl) media.push({ messageId: message.id, type: "image", url: message.imageUrl, username: message.username, createdAt: message.createdAt })
      if (message.voiceUrl) media.push({ messageId: message.id, type: "voice", url: message.voiceUrl, transcript: message.voiceTranscript, username: message.username, createdAt: message.createdAt })
      for (const link of message.content.match(URL_RE) || []) links.push({ messageId: message.id, url: link, username: message.username, createdAt: message.createdAt })
    }
    return NextResponse.json({ media: media.slice(0, 500), links: links.slice(0, 500) })
  }

  if (action === "polls") {
    const polls = await db.poll.findMany({ where: { channelId }, orderBy: { createdAt: "desc" }, take: 100 })
    return NextResponse.json({ polls: await Promise.all(polls.map((poll) => serializePoll(poll, me.id))) })
  }

  if (action === "events") {
    const events = await db.communityEvent.findMany({ where: { channelId }, orderBy: { startsAt: "asc" }, take: 100 })
    const rsvps = await db.eventRsvp.findMany({ where: { eventId: { in: events.map((event) => event.id) } } })
    return NextResponse.json({
      events: events.map((event) => ({
        ...event,
        rsvps: rsvps.filter((rsvp) => rsvp.eventId === event.id),
        myRsvp: rsvps.find((rsvp) => rsvp.eventId === event.id && rsvp.userId === me.id)?.status || null,
      })),
    })
  }

  if (action === "stats") {
    const [count, first, rows] = await Promise.all([
      db.message.count({ where: { channelId, deleted: false } }),
      db.message.findFirst({ where: { channelId, deleted: false }, orderBy: { createdAt: "asc" }, select: { id: true, username: true, createdAt: true } }),
      db.message.findMany({ where: { channelId, deleted: false }, orderBy: { createdAt: "desc" }, take: 5000, select: { userId: true, username: true, content: true, gifUrl: true, imageUrl: true, voiceUrl: true } }),
    ])
    const participants = new Map<string, { username: string; messages: number }>()
    const words = new Map<string, number>()
    const STOP = new Set(["the","and","that","this","with","you","your","for","are","was","but","not","have","from","they","just","like","what","when","how","its","it's","im","i'm","lol","lmao"])
    let mediaCount = 0
    for (const row of rows) {
      const key = row.userId || row.username; const current = participants.get(key) || { username: row.username, messages: 0 }; current.messages++; participants.set(key, current)
      if (row.gifUrl || row.imageUrl || row.voiceUrl) mediaCount++
      for (const word of row.content.toLowerCase().match(/[a-z0-9']{3,30}/g) || []) if (!STOP.has(word)) words.set(word, (words.get(word) || 0) + 1)
    }
    return NextResponse.json({ count, firstMessage: first, mediaCount, participants: [...participants.values()].sort((a,b)=>b.messages-a.messages), topWords: [...words.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([word,count])=>({word,count})), sampledMessages: rows.length })
  }

  if (action === "export") {
    const messages = await db.message.findMany({ where: { channelId, deleted: false }, include: { user: { select: { displayName: true } } }, orderBy: { createdAt: "asc" }, take: 20000 })
    const lines = messages.map((message) => `[${message.createdAt.toISOString()}] ${message.user?.displayName || message.username}: ${message.content || (message.imageUrl ? "[Image]" : message.gifUrl ? "[GIF]" : message.voiceUrl ? "[Voice message]" : "[Media]")}`)
    return new NextResponse(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="synnical-conversation-${channelId.slice(0,16)}.txt"` } })
  }

  return jsonError("Unknown action", 404)
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return jsonError("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = s(body.action, 64)

  if (action === "set-slowmode") {
    if (!canManageChannels(me.role)) return jsonError("Only channel managers can change slow mode", 403)
    const channelId = id(body.channelId)
    const seconds = Math.max(0, Math.min(21600, Math.floor(Number(body.seconds) || 0)))
    const channel = channelId ? await db.channel.findUnique({ where: { id: channelId } }) : null
    if (!channel || channel.isDM) return jsonError("Channel not found", 404)
    const updated = await db.channel.update({ where: { id: channelId }, data: { slowModeSeconds: seconds } })
    return NextResponse.json({ channel: updated })
  }

  if (action === "set-preference") {
    const channelId = id(body.channelId)
    if (!channelId || !await channelOr403(channelId, me)) return jsonError("Forbidden", 403)
    const notificationLevel = ["all", "mentions", "mute"].includes(body.notificationLevel) ? body.notificationLevel : undefined
    const notificationSound = typeof body.notificationSound === "string" ? s(body.notificationSound, 80) : undefined
    const folder = typeof body.folder === "string" ? s(body.folder, 60) : undefined
    const draft = typeof body.draft === "string" ? String(body.draft).slice(0, 4000) : undefined
    const privateNote = typeof body.privateNote === "string" ? String(body.privateNote).slice(0, 2000) : undefined
    const snoozedUntil = body.snoozedUntil === null ? null : body.snoozedUntil ? new Date(String(body.snoozedUntil)) : undefined
    const safeSnooze = snoozedUntil instanceof Date && Number.isFinite(snoozedUntil.getTime()) ? new Date(Math.min(snoozedUntil.getTime(), Date.now() + 90 * 86400000)) : snoozedUntil === null ? null : undefined
    const catchUpMessageId = body.catchUpMessageId === null ? null : id(body.catchUpMessageId) || undefined
    let lastReadAt: Date | undefined
    let lastReadMessageId: string | undefined
    if (id(body.lastReadMessageId)) {
      const read = await db.message.findFirst({ where: { id: id(body.lastReadMessageId), channelId }, select: { createdAt: true } })
      if (!read) return jsonError("Read message does not belong to this channel")
      lastReadAt = read.createdAt
      lastReadMessageId = id(body.lastReadMessageId)
    }
    const row = await db.channelPreference.upsert({
      where: { userId_channelId: { userId: me.id, channelId } },
      create: {
        userId: me.id, channelId,
        ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
        ...(folder !== undefined ? { folder } : {}),
        ...(notificationLevel ? { notificationLevel } : {}),
        ...(notificationSound !== undefined ? { notificationSound } : {}),
        ...(draft !== undefined ? { draft } : {}),
        ...(typeof body.priority === "boolean" ? { priority: body.priority } : {}),
        ...(typeof body.dealLater === "boolean" ? { dealLater: body.dealLater } : {}),
        ...(safeSnooze !== undefined ? { snoozedUntil: safeSnooze } : {}),
        ...(catchUpMessageId !== undefined ? { catchUpMessageId } : {}),
        ...(privateNote !== undefined ? { privateNote } : {}),
        ...(lastReadMessageId ? { lastReadMessageId, lastReadAt } : {}),
      },
      update: {
        ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
        ...(folder !== undefined ? { folder } : {}),
        ...(notificationLevel ? { notificationLevel } : {}),
        ...(notificationSound !== undefined ? { notificationSound } : {}),
        ...(draft !== undefined ? { draft } : {}),
        ...(typeof body.priority === "boolean" ? { priority: body.priority } : {}),
        ...(typeof body.dealLater === "boolean" ? { dealLater: body.dealLater } : {}),
        ...(safeSnooze !== undefined ? { snoozedUntil: safeSnooze } : {}),
        ...(catchUpMessageId !== undefined ? { catchUpMessageId } : {}),
        ...(privateNote !== undefined ? { privateNote } : {}),
        // Updated below with a conditional write so a slower browser tab cannot
        // move a read cursor backwards.
      },
    })
    if (lastReadAt && lastReadMessageId) {
      await db.channelPreference.updateMany({
        where: { userId: me.id, channelId, OR: [{ lastReadAt: null }, { lastReadAt: { lt: lastReadAt } }] },
        data: { lastReadAt, lastReadMessageId },
      })
      return NextResponse.json({ preference: await db.channelPreference.findUnique({ where: { userId_channelId: { userId: me.id, channelId } } }) })
    }
    return NextResponse.json({ preference: row })
  }

  if (action === "toggle-save") {
    const messageId = id(body.messageId)
    const message = messageId ? await db.message.findUnique({ where: { id: messageId } }) : null
    if (!message || !await channelOr403(message.channelId, me)) return jsonError("Not found", 404)
    const existing = await db.savedMessage.findUnique({ where: { userId_messageId: { userId: me.id, messageId } } })
    if (existing) { await db.savedMessage.delete({ where: { id: existing.id } }); return NextResponse.json({ saved: false }) }
    await db.savedMessage.create({ data: { userId: me.id, messageId } })
    return NextResponse.json({ saved: true })
  }

  if (action === "schedule") {
    const channelId = id(body.channelId)
    const content = s(body.content, 2000)
    const gifUrl = s(body.gifUrl, 2000) || null
    const sendAt = new Date(String(body.sendAt || ""))
    if (!channelId || (!content && !gifUrl) || !Number.isFinite(sendAt.getTime()) || sendAt.getTime() < Date.now() + 5000) return jsonError("Invalid scheduled message")
    if (!await channelOr403(channelId, me)) return jsonError("Forbidden", 403)
    const row = await db.scheduledMessage.create({ data: { userId: me.id, channelId, content, gifUrl, replyToId: id(body.replyToId) || null, sendAt } })
    return NextResponse.json({ scheduled: row })
  }

  if (action === "cancel-scheduled") {
    const scheduledId = id(body.id)
    const row = scheduledId ? await db.scheduledMessage.findFirst({ where: { id: scheduledId, userId: me.id, status: "pending" } }) : null
    if (!row) return jsonError("Not found", 404)
    await db.scheduledMessage.update({ where: { id: row.id }, data: { status: "cancelled" } })
    return NextResponse.json({ ok: true })
  }

  if (action === "create-poll") {
    const channelId = id(body.channelId)
    const question = s(body.question, 300)
    const labels = Array.isArray(body.options) ? body.options.map((option: unknown) => s(option, 120)).filter(Boolean).slice(0, 10) : []
    if (!channelId || !question || labels.length < 2 || !await channelOr403(channelId, me)) return jsonError("Invalid poll")
    const anonymous = Boolean(body.anonymous) && isStaffRole(me.role)
    const poll = await db.poll.create({ data: { channelId, question, anonymous, multiple: Boolean(body.multiple), createdById: me.id, closesAt: body.closesAt ? new Date(String(body.closesAt)) : null } })
    await db.pollOption.createMany({ data: labels.map((label: string, position: number) => ({ pollId: poll.id, label, position })) })
    const message = await db.message.create({ data: { channelId, userId: me.id, username: me.username, content: `📊 ${question}`, messageType: "poll" } })
    await db.user.update({ where: { id: me.id }, data: { messageCount: { increment: 1 } } }).catch(() => {})
    await db.poll.update({ where: { id: poll.id }, data: { messageId: message.id } })
    return NextResponse.json({ poll: await serializePoll({ ...poll, messageId: message.id }, me.id), message })
  }

  if (action === "vote") {
    const pollId = id(body.pollId)
    const optionId = id(body.optionId)
    const poll = pollId ? await db.poll.findUnique({ where: { id: pollId } }) : null
    const option = optionId ? await db.pollOption.findUnique({ where: { id: optionId } }) : null
    if (!poll || !option || option.pollId !== poll.id || !await channelOr403(poll.channelId, me)) return jsonError("Invalid poll vote", 404)
    if (poll.closesAt && poll.closesAt.getTime() <= Date.now()) return jsonError("Poll is closed", 409)
    if (!poll.multiple) await db.pollVote.deleteMany({ where: { pollId, userId: me.id } })
    const existing = await db.pollVote.findUnique({ where: { pollId_optionId_userId: { pollId, optionId, userId: me.id } } })
    if (existing) await db.pollVote.delete({ where: { id: existing.id } })
    else await db.pollVote.create({ data: { pollId, optionId, userId: me.id } })
    await earnAchievement(me.id, "poll-voter").catch(() => {})
    await advanceChallenge(me.id, "social_actions", 1).catch(() => {})
    return NextResponse.json({ poll: await serializePoll(poll, me.id) })
  }

  if (action === "create-event") {
    const channelId = id(body.channelId)
    const title = s(body.title, 160)
    const startsAt = new Date(String(body.startsAt || ""))
    if (!channelId || !title || !Number.isFinite(startsAt.getTime()) || !await channelOr403(channelId, me)) return jsonError("Invalid event")
    const event = await db.communityEvent.create({ data: { channelId, title, description: s(body.description, 1000), startsAt, createdById: me.id } })
    const message = await db.message.create({ data: { channelId, userId: me.id, username: me.username, content: `📅 ${title} · ${startsAt.toISOString()}`, messageType: "event" } })
    await db.user.update({ where: { id: me.id }, data: { messageCount: { increment: 1 } } }).catch(() => {})
    return NextResponse.json({ event, message })
  }

  if (action === "rsvp") {
    const eventId = id(body.eventId)
    const status = ["going", "maybe", "not-going"].includes(body.status) ? body.status : "going"
    const event = eventId ? await db.communityEvent.findUnique({ where: { id: eventId } }) : null
    if (!event || !await channelOr403(event.channelId, me)) return jsonError("Not found", 404)
    const rsvp = await db.eventRsvp.upsert({ where: { eventId_userId: { eventId, userId: me.id } }, update: { status }, create: { eventId, userId: me.id, status } })
    await earnAchievement(me.id, "event-rsvp").catch(() => {})
    await advanceChallenge(me.id, "social_actions", 1).catch(() => {})
    return NextResponse.json({ rsvp })
  }

  if (action === "translate") {
    const messageId = id(body.messageId)
    const language = s(body.language, 40) || "English"
    const message = messageId ? await db.message.findUnique({ where: { id: messageId } }) : null
    if (!message || message.deleted || !await channelOr403(message.channelId, me)) return jsonError("Not found", 404)
    const completion = await completeWithAiPool({ messages: [
      { role: "system", content: `Translate the user's message into ${language}. Preserve meaning and tone. Return only the translation; do not add commentary.` },
      { role: "user", content: message.content.slice(0, 4000) },
    ], temperature: 0.1, maxTokens: 1200, timeoutMs: 45_000 })
    return NextResponse.json({ translation: completion.text, provider: completion.provider })
  }

  return jsonError("Unknown action", 404)
}
