import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentSession, hashPassword, hashSecurityAnswer, normalizeSecurityAnswer, verifyPassword } from "@/lib/auth-server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { isAccountLockedDown, logSecurityEvent, makeRecoveryCodes, recoveryCodeHash, setAccountLockdown } from "@/lib/security-policy"

export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const clean = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : ""
const secret = (value: unknown, max = 256) => typeof value === "string" ? value.slice(0, max) : ""

async function state() {
  const current = await getCurrentSession()
  if (!current) return null
  const [sessions, recoveryCodes, events, lockdown] = await Promise.all([
    db.session.findMany({ where: { userId: current.user.id }, orderBy: { lastSeenAt: "desc" } }),
    db.recoveryCode.findMany({ where: { userId: current.user.id }, orderBy: { createdAt: "desc" } }),
    db.securityEvent.findMany({ where: { userId: current.user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    isAccountLockedDown(current.user.id),
  ])
  const remainingCodes = recoveryCodes.filter((row) => !row.usedAt).length
  const namedSessions = sessions.filter((row) => row.deviceName && row.deviceName !== "Browser session").length
  const now = Date.now()
  const isTrusted = (row: { trustedAt: Date | null; trustedUntil: Date | null }) => Boolean(row.trustedAt && (!row.trustedUntil || row.trustedUntil.getTime() > now))
  const trustedSessions = sessions.filter(isTrusted).length
  const currentTrusted = sessions.some((row) => row.id === current.id && isTrusted(row))
  const score = Math.min(100, 50 + (remainingCodes > 0 ? 20 : 0) + (sessions.length <= 3 ? 10 : 5) + (sessions.length > 0 && namedSessions === sessions.length ? 10 : 0) + (currentTrusted ? 10 : 0))
  return {
    currentSessionId: current.id,
    lockdown,
    pinConfigured: Boolean(current.user.lockPinHash),
    score,
    checklist: [
      { id: "password", label: "Account password is configured", complete: true },
      { id: "recovery", label: "Generate recovery codes", complete: remainingCodes > 0 },
      { id: "sessions", label: "Review signed-in devices", complete: sessions.length <= 3 },
      { id: "names", label: "Name your signed-in devices", complete: sessions.length > 0 && namedSessions === sessions.length },
      { id: "trusted", label: "Mark this device as trusted", complete: currentTrusted },
    ],
    sessions: sessions.map(({ token: _token, ...row }) => ({
      ...row,
      current: row.id === current.id,
      trusted: isTrusted(row),
      trustMode: isTrusted(row) ? (row.trustedUntil ? "temporary" : "permanent") : "none",
    })),
    trustedSessions,
    recovery: { remaining: remainingCodes, total: recoveryCodes.length, used: recoveryCodes.filter((row) => row.usedAt).map((row) => ({ id: row.id, usedAt: row.usedAt })) },
    securitySetup: {
      completed: Boolean(current.user.securitySetupCompletedAt),
      completedAt: current.user.securitySetupCompletedAt,
      question: current.user.securityQuestion || null,
      passwordChangedAt: current.user.passwordChangedAt,
    },
    events,
  }
}

export async function GET(req: NextRequest) {
  const current = await getCurrentSession()
  if (!current) return fail("Unauthorized", 401)
  const data = await state()
  if (new URL(req.url).searchParams.get("download") === "1") {
    const report = JSON.stringify({ generatedAt: new Date().toISOString(), account: { id: current.user.id, username: current.user.username, role: current.user.role }, security: data }, null, 2)
    return new NextResponse(report, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="synnical-security-${current.user.username}.json"`, "Cache-Control": "private, no-store" } })
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const current = await getCurrentSession()
  if (!current) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)

  // The mandatory one-time password migration has been removed. Recovery and
  // password changes below always require the existing account password.
  if (action === "begin-security-setup" || action === "complete-security-setup") {
    return fail("Use password-confirmed account security settings", 410)
  }
  if (action === "verify-pin") {
    const rate = consumeRequestLimit(req, "lock-pin", 5, 15 * 60_000, current.user.id)
    if (!rate.allowed) return NextResponse.json({ error: "Too many PIN attempts. Use your account password or try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
    const pin = typeof body.pin === "string" ? body.pin : ""
    if (!/^\d{4,8}$/.test(pin) || !current.user.lockPinHash || !verifyPassword(pin, current.user.lockPinHash)) return fail("PIN confirmation failed", 403)
    return NextResponse.json({ verified: true })
  }

  if (action === "rename-session") {
    const sessionId = clean(body.sessionId, 128)
    const deviceName = clean(body.deviceName, 80)
    if (!sessionId || deviceName.length < 2) return fail("Device name must be at least 2 characters")
    const changed = await db.session.updateMany({ where: { id: sessionId, userId: current.user.id }, data: { deviceName } })
    if (!changed.count) return fail("Session not found", 404)
    await logSecurityEvent(current.user.id, "session_renamed", `A signed-in device was renamed to “${deviceName}”.`, { sessionId })
    return NextResponse.json(await state())
  }

  const password = secret(body.password)
  if (!["set-lockdown", "generate-recovery-codes", "revoke-session", "revoke-others", "trust-session", "untrust-session", "verify-password", "change-password", "change-security-question", "set-lock-pin", "remove-lock-pin"].includes(action)) return fail("Unknown action", 404)
  const rate = consumeRequestLimit(req, "security-password", 15, 15 * 60_000, current.user.id)
  if (!rate.allowed) return fail("Too many password attempts. Try again later.", 429)
  if (!password || !verifyPassword(password, current.user.passwordHash)) return fail("Password confirmation failed", 403)

  if (action === "verify-password") return NextResponse.json({ verified: true })

  if (action === "set-lock-pin" || action === "remove-lock-pin") {
    const pin = typeof body.pin === "string" ? body.pin : ""
    if (action === "set-lock-pin" && !/^\d{4,8}$/.test(pin)) return fail("PIN must be 4–8 digits")
    await db.user.update({ where: { id: current.user.id }, data: { lockPinHash: action === "set-lock-pin" ? hashPassword(pin) : null } })
    await logSecurityEvent(current.user.id, "lock_pin_changed", action === "set-lock-pin" ? "A lock-screen PIN was configured." : "The lock-screen PIN was removed.")
    return NextResponse.json(await state())
  }

  if (action === "change-password") {
    const newPassword = secret(body.newPassword)
    if (newPassword.length < 8 || newPassword.length > 256) return fail("New password must be 8-256 characters")
    if (verifyPassword(newPassword, current.user.passwordHash)) return fail("Choose a password that is different from your current password")
    const revokeOthers = body.revokeOthers !== false
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: current.user.id }, data: { passwordHash: hashPassword(newPassword), passwordChangedAt: new Date() } })
      if (revokeOthers) await tx.session.deleteMany({ where: { userId: current.user.id, id: { not: current.id } } })
    })
    await logSecurityEvent(current.user.id, "password_changed", revokeOthers ? "Account password changed and other signed-in devices were signed out." : "Account password changed.")
    return NextResponse.json({ changed: true, ...(await state()) })
  }

  if (action === "change-security-question") {
    const question = clean(body.securityQuestion, 180)
    const answer = secret(body.securityAnswer, 220)
    if (question.length < 8) return fail("Security question must be at least 8 characters")
    if (normalizeSecurityAnswer(answer).length < 3) return fail("Security answer must be at least 3 characters")
    await db.user.update({ where: { id: current.user.id }, data: { securityQuestion: question, securityAnswerHash: hashSecurityAnswer(answer), securitySetupCompletedAt: new Date() } })
    await logSecurityEvent(current.user.id, "security_question_changed", "The account recovery question was changed.")
    return NextResponse.json(await state())
  }

  if (action === "trust-session") {
    const sessionId = clean(body.sessionId, 128)
    const mode = clean(body.mode, 20)
    if (!sessionId || !["temporary", "permanent"].includes(mode)) return fail("Choose a valid device trust duration")
    const days = mode === "temporary" ? Math.min(30, Math.max(1, Number(body.days) || 7)) : 0
    const trustedUntil = mode === "temporary" ? new Date(Date.now() + days * 86_400_000) : null
    const changed = await db.session.updateMany({ where: { id: sessionId, userId: current.user.id }, data: { trustedAt: new Date(), trustedUntil } })
    if (!changed.count) return fail("Session not found", 404)
    await logSecurityEvent(current.user.id, "session_trusted", mode === "temporary" ? `A signed-in device was trusted for ${days} day${days === 1 ? "" : "s"}.` : "A signed-in device was marked as permanently trusted.", { sessionId, mode, days: mode === "temporary" ? days : null })
    return NextResponse.json(await state())
  }

  if (action === "untrust-session") {
    const sessionId = clean(body.sessionId, 128)
    if (!sessionId) return fail("Session required")
    const changed = await db.session.updateMany({ where: { id: sessionId, userId: current.user.id }, data: { trustedAt: null, trustedUntil: null } })
    if (!changed.count) return fail("Session not found", 404)
    await logSecurityEvent(current.user.id, "session_untrusted", "A signed-in device was removed from the trusted-device list.", { sessionId })
    return NextResponse.json(await state())
  }

  if (action === "set-lockdown") {
    await setAccountLockdown(current.user.id, body.enabled === true)
    return NextResponse.json(await state())
  }

  if (action === "generate-recovery-codes") {
    const codes = makeRecoveryCodes(8)
    await db.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId: current.user.id, usedAt: null } })
      for (const code of codes) await tx.recoveryCode.create({ data: { userId: current.user.id, codeHash: recoveryCodeHash(code) } })
    })
    await logSecurityEvent(current.user.id, "recovery_codes_generated", "A new set of recovery codes was generated. Older unused codes were invalidated.")
    return NextResponse.json({ ...(await state()), newRecoveryCodes: codes })
  }

  if (action === "revoke-session") {
    const sessionId = clean(body.sessionId, 128)
    if (!sessionId) return fail("Session required")
    if (sessionId === current.id) return fail("Use Log out to end this current session")
    const removed = await db.session.deleteMany({ where: { id: sessionId, userId: current.user.id } })
    if (!removed.count) return fail("Session not found", 404)
    await logSecurityEvent(current.user.id, "session_revoked", "A signed-in device was remotely signed out.", { sessionId })
    return NextResponse.json(await state())
  }

  await db.session.deleteMany({ where: { userId: current.user.id, id: { not: current.id } } })
  await logSecurityEvent(current.user.id, "sessions_revoked", "All other signed-in devices were remotely signed out.")
  return NextResponse.json(await state())
}
