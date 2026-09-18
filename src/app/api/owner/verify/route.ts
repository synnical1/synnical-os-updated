import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { OWNER_PASSWORD } from "@/lib/constants"
import { auditData } from "@/lib/audit-log"
import { createHash, timingSafeEqual } from "crypto"
import { consumeRequestLimit } from "@/lib/request-rate-limit"

// POST /api/owner/verify — verifies owner password and grants OWNER role.
// Owner is NEVER granted by default — only here, with the password.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!OWNER_PASSWORD.trim()) return NextResponse.json({ error: "Owner verification is not configured" }, { status: 503 })
  const rate = consumeRequestLimit(req, "owner-verify", 5, 15 * 60_000, user.id)
  if (!rate.allowed) return NextResponse.json({ error: "Too many owner verification attempts" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
  const { password } = await req.json().catch(() => ({}))
  if (typeof password !== "string") {
    return NextResponse.json({ error: "Password required" }, { status: 400 })
  }

  if (password.length > 1024 || !timingSafeEqual(createHash("sha256").update(password).digest(), createHash("sha256").update(OWNER_PASSWORD).digest())) {
    return NextResponse.json({ error: "Incorrect owner password" }, { status: 403 })
  }

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.user.update({ where: { id: user.id }, data: { role: "OWNER" } })
    await tx.auditLog.create({ data: auditData({
      category: "USER_MANAGEMENT",
      action: "OWNER_VERIFIED",
      actor: user,
      target: { id: user.id, username: user.username },
      before: { role: user.role },
      after: { role: "OWNER" },
      reason: "Owner password verified",
    }) })
    return next
  })

  return NextResponse.json({ ok: true, user: toSafeUser(updated) })
}
