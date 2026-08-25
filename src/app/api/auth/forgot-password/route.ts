import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentSession, hashPassword, verifySecurityAnswer } from "@/lib/auth-server"
import { logSecurityEvent, recoveryCodeHash } from "@/lib/security-policy"
import { consumeRequestLimit } from "@/lib/request-rate-limit"

export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } })
const cleanUsername = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().slice(0, 64) : ""
const secret = (value: unknown, max = 256) => typeof value === "string" ? value.slice(0, max) : ""

export async function GET(req: NextRequest) {
  const rate = consumeRequestLimit(req, "password-recovery-question", 12, 10 * 60_000)
  if (!rate.allowed) return fail("Too many recovery attempts", 429)
  const username = cleanUsername(new URL(req.url).searchParams.get("username"))
  if (!username) return fail("Username required")
  const current = await getCurrentSession().catch(() => null)
  // The recovery question is only revealed to the already signed-in account on
  // the Synnical lock screen. Anonymous callers get the same generic shape so
  // this endpoint cannot be used as a username/question enumeration oracle.
  if (!current || current.user.username.toLowerCase() !== username) {
    return NextResponse.json({ question: null, ready: false }, { headers: { "Cache-Control": "no-store" } })
  }
  const user = await db.user.findUnique({ where: { id: current.user.id }, select: { securityQuestion: true, securitySetupCompletedAt: true } })
  return NextResponse.json({
    question: user?.securitySetupCompletedAt ? user.securityQuestion : null,
    ready: Boolean(user?.securitySetupCompletedAt && user.securityQuestion),
  }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(req: NextRequest) {
  const rate = consumeRequestLimit(req, "password-recovery-reset", 6, 15 * 60_000)
  if (!rate.allowed) return fail("Too many recovery attempts", 429)
  const body = await req.json().catch(() => ({}))
  const username = cleanUsername(body.username)
  const securityAnswer = secret(body.securityAnswer, 220)
  const recoveryCode = secret(body.recoveryCode, 80)
  const newPassword = secret(body.newPassword)
  if (!username || !securityAnswer || !recoveryCode) return fail("Recovery details did not match", 403)
  if (newPassword.length < 8 || newPassword.length > 256) return fail("New password must be 8-256 characters")

  const user = await db.user.findUnique({ where: { username } })
  if (!user?.securitySetupCompletedAt || !user.securityAnswerHash || !verifySecurityAnswer(securityAnswer, user.securityAnswerHash)) {
    return fail("Recovery details did not match", 403)
  }
  const codeHash = recoveryCodeHash(recoveryCode)
  const row = await db.recoveryCode.findFirst({ where: { userId: user.id, codeHash, usedAt: null }, select: { id: true } })
  if (!row) return fail("Recovery details did not match", 403)

  try {
    const current = await getCurrentSession().catch(() => null)
    await db.$transaction(async (tx) => {
      const claimed = await tx.recoveryCode.updateMany({ where: { id: row.id, userId: user.id, usedAt: null }, data: { usedAt: new Date() } })
      if (!claimed.count) throw new Error("RECOVERY_CODE_ALREADY_USED")
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword), passwordChangedAt: new Date() } })
      // Password recovery is a high-risk action. Preserve only the browser
      // that just supplied the recovery proof when it is already signed into
      // this same account; every other session is revoked.
      await tx.session.deleteMany({ where: { userId: user.id, ...(current?.user.id === user.id ? { id: { not: current.id } } : {}) } })
    })
  } catch {
    return fail("Recovery details did not match", 403)
  }

  await logSecurityEvent(user.id, "password_recovered", "The account password was reset with the recovery question and a one-time recovery code. Other sessions were revoked; the browser that supplied the recovery proof was preserved only when it was already signed into this account.")
  return NextResponse.json({ reset: true }, { headers: { "Cache-Control": "no-store" } })
}
