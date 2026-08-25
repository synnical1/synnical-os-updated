import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { isAdminRole } from "@/lib/feature-auth"
import { enabledFlagsForUser, featureFlagEnabledForUser } from "@/lib/feature-flags"
import { auditData } from "@/lib/audit-log"

export const dynamic = "force-dynamic"
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const clean = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : ""
const validKey = (value: unknown) => { const key = clean(value, 80).toLowerCase(); return /^[a-z0-9][a-z0-9._-]{1,79}$/.test(key) ? key : "" }

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const admin = isAdminRole(me.role)
  const url = new URL(req.url)
  if (url.searchParams.get("mode") === "flags") {
    const flags = await enabledFlagsForUser(me.id)
    return NextResponse.json({ flags: flags.map((flag) => flag.key) }, { headers: { "Cache-Control": "private, no-store" } })
  }

  if (admin) {
    const flags = await db.featureFlag.findMany({ orderBy: { updatedAt: "desc" }, include: { enrollments: { include: { user: { select: { id: true, username: true, displayName: true } } } }, feedback: { orderBy: { createdAt: "desc" }, take: 50, include: { user: { select: { id: true, username: true, displayName: true } } } } } })
    return NextResponse.json({ admin: true, eligible: true, flags }, { headers: { "Cache-Control": "private, no-store" } })
  }

  const enrollments = await db.labEnrollment.findMany({ where: { userId: me.id }, include: { flag: true } })
  const visible: Array<{ flag: (typeof enrollments)[number]["flag"]; enrollment: (typeof enrollments)[number]; active: boolean }> = []
  for (const enrollment of enrollments) {
    if (!enrollment.flag.enabled || !enrollment.flag.labOnly) continue
    visible.push({ flag: enrollment.flag, enrollment, active: await featureFlagEnabledForUser(enrollment.flagKey, me.id) })
  }
  return NextResponse.json({ admin: false, eligible: visible.some((row) => row.active), experiments: visible }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)
  const admin = isAdminRole(me.role)

  if (admin && action === "upsert-flag") {
    const key = validKey(body.key)
    const name = clean(body.name, 100)
    if (!key || !name) return fail("Feature key and name are required")
    const rolloutPercent = Math.max(0, Math.min(100, Math.round(Number(body.rolloutPercent) || 0)))
    const description = clean(body.description, 1000)
    const before = await db.featureFlag.findUnique({ where: { key } })
    const flag = await db.$transaction(async (tx) => {
      const updated = await tx.featureFlag.upsert({
        where: { key },
        update: { name, description, enabled: body.enabled === true, rolloutPercent, labOnly: body.labOnly !== false },
        create: { key, name, description, enabled: body.enabled === true, rolloutPercent, labOnly: body.labOnly !== false, createdById: me.id },
      })
      await tx.auditLog.create({ data: auditData({
        category: "LAB",
        action: before ? "FEATURE_FLAG_UPDATED" : "FEATURE_FLAG_CREATED",
        actor: me,
        before: before ? { key: before.key, name: before.name, enabled: before.enabled, rolloutPercent: before.rolloutPercent, labOnly: before.labOnly } : {},
        after: { key: updated.key, name: updated.name, enabled: updated.enabled, rolloutPercent: updated.rolloutPercent, labOnly: updated.labOnly },
      }) })
      return updated
    })
    return NextResponse.json({ flag })
  }

  if (admin && action === "enroll-user") {
    const key = validKey(body.key)
    const username = clean(body.username, 64).toLowerCase()
    const [flag, user] = await Promise.all([db.featureFlag.findUnique({ where: { key } }), db.user.findUnique({ where: { username } })])
    if (!flag) return fail("Experiment not found", 404)
    if (!user) return fail("User not found", 404)
    const enrollment = await db.$transaction(async (tx) => {
      const updated = await tx.labEnrollment.upsert({ where: { userId_flagKey: { userId: user.id, flagKey: key } }, update: { enabled: true, optedOut: false }, create: { userId: user.id, flagKey: key, enabled: true } })
      await tx.auditLog.create({ data: auditData({
        category: "LAB",
        action: "LAB_TESTER_ENROLLED",
        actor: me,
        target: { id: user.id, username: user.username },
        after: { flagKey: key, enabled: true, optedOut: false },
        metadata: { experimentName: flag.name },
      }) })
      return updated
    })
    return NextResponse.json({ enrollment, user: { id: user.id, username: user.username, displayName: user.displayName } })
  }

  if (admin && action === "remove-enrollment") {
    const key = validKey(body.key)
    const userId = clean(body.userId, 128)
    const [enrollment, user, flag] = await Promise.all([
      db.labEnrollment.findUnique({ where: { userId_flagKey: { userId, flagKey: key } } }),
      db.user.findUnique({ where: { id: userId }, select: { id: true, username: true } }),
      db.featureFlag.findUnique({ where: { key }, select: { name: true } }),
    ])
    if (!enrollment) return fail("Enrollment not found", 404)
    await db.$transaction(async (tx) => {
      await tx.labEnrollment.delete({ where: { userId_flagKey: { userId, flagKey: key } } })
      await tx.auditLog.create({ data: auditData({
        category: "LAB",
        action: "LAB_TESTER_REMOVED",
        actor: me,
        target: user ? { id: user.id, username: user.username } : { id: userId, username: null },
        before: { flagKey: key, enabled: enrollment.enabled, optedOut: enrollment.optedOut },
        after: { removed: true },
        metadata: { experimentName: flag?.name || key },
      }) })
    })
    return NextResponse.json({ ok: true })
  }

  const key = validKey(body.key)
  if (!key || !await featureFlagEnabledForUser(key, me.id)) return fail("Experiment not available", 404)

  if (action === "feedback") {
    const kind = ["ship", "needs_work", "bug"].includes(body.kind) ? body.kind : "bug"
    const message = clean(body.message, 2000)
    if (kind === "bug" && message.length < 3) return fail("Tell us what went wrong")
    if (kind === "ship" || kind === "needs_work") {
      await db.labFeedback.deleteMany({ where: { userId: me.id, flagKey: key, kind: { in: ["ship", "needs_work"] } } })
    }
    await db.labFeedback.create({ data: { userId: me.id, flagKey: key, kind, message } })
    return NextResponse.json({ ok: true })
  }

  if (action === "opt-out") {
    await db.labEnrollment.upsert({ where: { userId_flagKey: { userId: me.id, flagKey: key } }, update: { enabled: false, optedOut: true }, create: { userId: me.id, flagKey: key, enabled: false, optedOut: true } })
    return NextResponse.json({ ok: true, revertedToStable: true })
  }

  return fail("Unknown action", 404)
}
