import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { recordLogin } from "@/lib/feature-platform"
import { verifyPassword, createSession, isUserPermanentlyBanned, isTrustedSvgClient } from "@/lib/auth-server"
import { consumeRecoveryCode, logSecurityEvent } from "@/lib/security-policy"
import { toSafeUser } from "@/lib/auth"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { rememberRequestIdentity } from "@/lib/request-identity"
import { banKnownIdentities } from "@/lib/identity-ban"

export async function POST(req: NextRequest) {
  try {
    const rate = consumeRequestLimit(req, "login", 10, 10 * 60_000)
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many login attempts" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
    }
    const { username, password, recoveryCode } = await req.json().catch(() => ({}))
    if (typeof username !== "string" || (typeof password !== "string" && typeof recoveryCode !== "string")) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 })
    }
    const user = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } })
    if (!user) return NextResponse.json({ error: "Wrong username or password" }, { status: 401 })
    const passwordOk = typeof password === "string" && password.length > 0 && verifyPassword(password, user.passwordHash)
    const recoveryOk = !passwordOk && typeof recoveryCode === "string" && recoveryCode.trim() ? await consumeRecoveryCode(user.id, recoveryCode) : false
    if (!passwordOk && !recoveryOk) {
      return NextResponse.json({ error: recoveryCode ? "Invalid or already-used recovery code" : "Wrong username or password" }, { status: 401 })
    }
    await rememberRequestIdentity(user.id, req)
    if (await isUserPermanentlyBanned(user.id)) {
      await banKnownIdentities(user.id, "Permanent account ban observed during login")
      return NextResponse.json({ error: "This account is permanently banned", code: "ACCOUNT_PERMANENTLY_BANNED" }, { status: 403 })
    }
    const token = await createSession(user.id, req)
    await recordLogin(user.id).catch((error) => console.warn("[progress] login streak update failed", error))
    await logSecurityEvent(user.id, recoveryOk ? "login_recovery" : "login", recoveryOk ? "Signed in with a recovery code." : "Signed in with the account password.").catch(() => {})
    return NextResponse.json({
      user: toSafeUser(user),
      ...(isTrustedSvgClient(req) ? { token } : {}),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[login] Error:", msg)
    return NextResponse.json({ error: "Login failed" }, { status: 500 })
  }
}
