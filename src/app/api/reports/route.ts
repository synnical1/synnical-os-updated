import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canModerate } from "@/lib/auth"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { auditData } from "@/lib/audit-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const CATEGORY_PRIORITY: Record<string, number> = {
  CHILD_SAFETY: 100,
  SEXUAL_CONTENT: 90,
  THREATS: 85,
  SCAM_MANIPULATION: 75,
  HATE: 70,
  HARASSMENT: 60,
  SPAM: 30,
  OTHER: 20,
}
export const REPORT_CATEGORIES = Object.keys(CATEGORY_PRIORITY)

function serializedContext(rows: Array<{
  id: string
  userId: string | null
  username: string
  content: string
  gifUrl: string | null
  deleted: boolean
  edited: boolean
  createdAt: Date
  user: { displayName: string } | null
}>) {
  return JSON.stringify(rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    username: row.username,
    displayName: row.user?.displayName || row.username,
    content: row.content,
    gifUrl: row.gifUrl,
    deleted: row.deleted,
    edited: row.edited,
    createdAt: row.createdAt.toISOString(),
  })))
}

export async function POST(req: NextRequest) {
  const reporter = await getCurrentUser()
  if (!reporter) return NextResponse.json({ error: "Log in to report content" }, { status: 401 })

  const limit = consumeRequestLimit(req, "report", 8, 10 * 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many reports. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  }

  const body = await req.json().catch(() => ({}))
  const messageId = typeof body.messageId === "string" ? body.messageId : ""
  const category = typeof body.category === "string" ? body.category.toUpperCase() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!messageId || !(category in CATEGORY_PRIORITY)) {
    return NextResponse.json({ error: "Choose what is wrong with the message" }, { status: 400 })
  }
  if (reason.length < 3 || reason.length > 500) {
    return NextResponse.json({ error: "Report details must be 3-500 characters" }, { status: 400 })
  }

  const message = await db.message.findUnique({
    where: { id: messageId },
    include: {
      user: { select: { displayName: true, username: true } },
      channel: {
        select: {
          id: true, name: true, isDM: true, isGroup: true,
          memberships: { where: { userId: reporter.id }, select: { id: true } },
        },
      },
    },
  })
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 })
  if (message.userId === reporter.id) return NextResponse.json({ error: "You cannot report your own message" }, { status: 400 })
  if ((message.channel.isDM || message.channel.isGroup) && message.channel.memberships.length === 0) {
    return NextResponse.json({ error: "You cannot access this conversation" }, { status: 403 })
  }

  const nearby = await db.message.findMany({
    where: {
      channelId: message.channelId,
      createdAt: {
        gte: new Date(message.createdAt.getTime() - 15 * 60_000),
        lte: new Date(message.createdAt.getTime() + 15 * 60_000),
      },
    },
    orderBy: { createdAt: "asc" },
    take: 24,
    include: { user: { select: { displayName: true } } },
  })

  const targetUsername = message.user?.username || message.username
  const report = await db.report.create({
    data: {
      reporterIdSnapshot: reporter.id,
      reporterUsername: reporter.username,
      targetUserIdSnapshot: message.userId,
      targetUsername,
      category,
      reason,
      priority: CATEGORY_PRIORITY[category],
      messageIdSnapshot: message.id,
      channelIdSnapshot: message.channelId,
      channelNameSnapshot: message.channel.name,
      messageContentSnapshot: message.content,
      messageGifSnapshot: message.gifUrl,
      contextSnapshot: serializedContext(nearby),
    },
  })

  return NextResponse.json({
    ok: true,
    code: "REPORT_ACCEPTED",
    reportId: report.id,
    priority: report.priority,
    childSafetyPriority: category === "CHILD_SAFETY",
  })
}

export async function GET(req: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || !canModerate(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const requested = new URL(req.url).searchParams.get("status")?.toUpperCase()
  const status = requested && ["OPEN", "RESOLVED", "DISMISSED"].includes(requested) ? requested : "OPEN"
  const reports = await db.report.findMany({
    where: { status },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 250,
  })
  return NextResponse.json({
    reports: reports.map((report) => ({
      ...report,
      createdAt: report.createdAt.toISOString(),
      reviewedAt: report.reviewedAt?.toISOString() || null,
      context: JSON.parse(report.contextSnapshot),
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || !canModerate(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const reportId = typeof body.reportId === "string" ? body.reportId : ""
  const status = typeof body.status === "string" ? body.status.toUpperCase() : ""
  if (!reportId || !["RESOLVED", "DISMISSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid report resolution" }, { status: 400 })
  }
  const existing = await db.report.findUnique({ where: { id: reportId } })
  if (!existing) return NextResponse.json({ error: "Report not found" }, { status: 404 })
  await db.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: reportId },
      data: {
        status,
        reviewedAt: new Date(),
        reviewerIdSnapshot: actor.id,
        reviewerUsername: actor.username,
      },
    })
    await tx.auditLog.create({ data: auditData({
      category: "REPORTS",
      action: status === "RESOLVED" ? "REPORT_RESOLVED" : "REPORT_DISMISSED",
      actor,
      target: existing.targetUserIdSnapshot || existing.targetUsername ? { id: existing.targetUserIdSnapshot, username: existing.targetUsername } : null,
      reason: existing.reason,
      before: { status: existing.status },
      after: { status },
      metadata: { reportId, category: existing.category, priority: existing.priority, reporter: existing.reporterUsername },
    }) })
  })
  return NextResponse.json({ ok: true, reportId, status })
}
