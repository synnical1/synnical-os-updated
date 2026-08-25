import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentSession, verifyPassword } from "@/lib/auth-server"
import { DEVELOPER_SCOPES, developerTokenHash, type DeveloperScope } from "@/lib/developer-auth"
import { logSecurityEvent } from "@/lib/security-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : ""

function cleanScopes(value: unknown): DeveloperScope[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((scope): scope is DeveloperScope => typeof scope === "string" && DEVELOPER_SCOPES.includes(scope as DeveloperScope)))].slice(0, DEVELOPER_SCOPES.length)
}

async function list(userId: string) {
  const tokens = await db.developerToken.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 })
  return tokens.map(({ tokenHash: _hash, scopesJson, ...row }) => ({ ...row, scopes: cleanScopes(JSON.parse(scopesJson || "[]")) }))
}

export async function GET() {
  const current = await getCurrentSession()
  if (!current) return fail("Unauthorized", 401)
  return NextResponse.json({ tokens: await list(current.user.id), scopes: DEVELOPER_SCOPES }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const current = await getCurrentSession()
  if (!current) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 40)
  const password = clean(body.password, 256)
  if (!password || !verifyPassword(password, current.user.passwordHash)) return fail("Password confirmation failed", 403)

  if (action === "create") {
    const name = clean(body.name, 80)
    const scopes = cleanScopes(body.scopes)
    if (name.length < 2) return fail("Token name must be at least 2 characters")
    if (!scopes.length) return fail("Choose at least one API permission")
    const active = await db.developerToken.count({ where: { userId: current.user.id, revokedAt: null } })
    if (active >= 20) return fail("Revoke an old token before creating another", 409)
    const prefix = randomBytes(4).toString("hex")
    const rawToken = `syn_live_${prefix}_${randomBytes(28).toString("base64url")}`
    await db.developerToken.create({ data: { userId: current.user.id, name, prefix, tokenHash: developerTokenHash(rawToken), scopesJson: JSON.stringify(scopes) } })
    await logSecurityEvent(current.user.id, "developer_token_created", `A developer API token named “${name}” was created.`, { prefix, scopes })
    return NextResponse.json({ tokens: await list(current.user.id), newToken: rawToken })
  }

  if (action === "revoke") {
    const id = clean(body.id, 128)
    const token = id ? await db.developerToken.findFirst({ where: { id, userId: current.user.id, revokedAt: null } }) : null
    if (!token) return fail("API token not found", 404)
    await db.developerToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } })
    await logSecurityEvent(current.user.id, "developer_token_revoked", `Developer API token “${token.name}” was revoked.`, { prefix: token.prefix })
    return NextResponse.json({ tokens: await list(current.user.id) })
  }

  return fail("Unknown developer action", 404)
}
