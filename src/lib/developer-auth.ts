import { createHash } from "crypto"
import type { NextRequest } from "next/server"
import { db } from "@/lib/db"

export const DEVELOPER_SCOPES = ["read:profile", "read:friends", "read:games"] as const
export type DeveloperScope = (typeof DEVELOPER_SCOPES)[number]

export function developerTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function parsedScopes(value: string): DeveloperScope[] {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((scope): scope is DeveloperScope => typeof scope === "string" && DEVELOPER_SCOPES.includes(scope as DeveloperScope))
  } catch {
    return []
  }
}

export async function authenticateDeveloperRequest(req: NextRequest, requiredScope: DeveloperScope) {
  const auth = req.headers.get("authorization") || ""
  const match = /^Bearer\s+(.+)$/i.exec(auth)
  const raw = match?.[1]?.trim() || ""
  if (!raw.startsWith("syn_live_") || raw.length > 200) return null
  const token = await db.developerToken.findUnique({ where: { tokenHash: developerTokenHash(raw) } })
  if (!token || token.revokedAt) return null
  const scopes = parsedScopes(token.scopesJson)
  if (!scopes.includes(requiredScope)) return null
  const user = await db.user.findUnique({ where: { id: token.userId } })
  if (!user) return null
  if (!token.lastUsedAt || token.lastUsedAt.getTime() < Date.now() - 60_000) {
    void db.developerToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }
  return { user, token: { id: token.id, name: token.name, prefix: token.prefix, scopes } }
}
