import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { recordLogin } from "@/lib/feature-platform"
import { hashPassword, createSession, hashSecurityAnswer, normalizeSecurityAnswer, isTrustedSvgClient } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { moderateChatMessage } from "@/lib/chat-moderation"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { bannedRequestIdentity, rememberRequestIdentity } from "@/lib/request-identity"
import { logSecurityEvent } from "@/lib/security-policy"

export async function POST(req: NextRequest) {
  try {
    const rate = consumeRequestLimit(req, "register", 4, 60 * 60_000)
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many registration attempts" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
    }
    const bannedIdentity = await bannedRequestIdentity(req)
    if (bannedIdentity.banned) {
      return NextResponse.json({ error: "Registration is blocked from this banned network or device", code: "BANNED_IDENTITY" }, { status: 403 })
    }
    const { username, password, securityQuestion, securityAnswer } = await req.json().catch(() => ({}))
    if (typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }
    const u = username.trim()
    if (u.length < 2 || u.length > 24) {
      return NextResponse.json({ error: "Username must be 2-24 chars" }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(u)) {
      return NextResponse.json({ error: "Username may use letters, numbers, dots, underscores and hyphens" }, { status: 400 })
    }
    if (password.length < 8 || password.length > 256) {
      return NextResponse.json({ error: "Password must be 8-256 characters" }, { status: 400 })
    }
    const question = typeof securityQuestion === "string" ? securityQuestion.trim().slice(0, 180) : ""
    const answer = typeof securityAnswer === "string" ? securityAnswer : ""
    if (question.length < 8) return NextResponse.json({ error: "Security question must be at least 8 characters" }, { status: 400 })
    if (normalizeSecurityAnswer(answer).length < 3) return NextResponse.json({ error: "Security answer must be at least 3 characters" }, { status: 400 })
    // Usernames have a deliberately small alphabet and are short enough for
    // deterministic local moderation. Registration must not depend on an AI
    // provider returning a correctly shaped classification (or having quota).
    const violation = moderateChatMessage(u)
    if (violation) {
      return NextResponse.json(
        { code: violation.code, error: `Registration blocked: ${violation.reason}` },
        { status: 422 },
      )
    }
    const existing = await db.user.findUnique({ where: { username: u.toLowerCase() } })
    if (existing) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 })
    }

    const user = await db.user.create({
      data: {
        username: u.toLowerCase(),
        displayName: u,
        passwordHash: hashPassword(password),
        securityQuestion: question,
        securityAnswerHash: hashSecurityAnswer(answer),
        securitySetupCompletedAt: new Date(),
        passwordChangedAt: new Date(),
        role: "MEMBER",
        coins: 0, // Credits are earned after signup; no automatic starting grant.
      },
    })

    await rememberRequestIdentity(user.id, req)
    const token = await createSession(user.id, req)
    await recordLogin(user.id).catch((error) => console.warn("[progress] initial login streak update failed", error))
    await logSecurityEvent(user.id, "account_created", "Account created and first browser session signed in.").catch(() => {})
    return NextResponse.json({
      user: toSafeUser(user),
      ...(isTrustedSvgClient(req) ? { token } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[register] Error:", msg)
    return NextResponse.json({ error: "Registration failed" }, { status: 500 })
  }
}
