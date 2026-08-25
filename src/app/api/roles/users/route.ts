import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser, canModerate } from "@/lib/auth"

const STAFF_ROLES = ["OWNER", "HEAD_ADMIN", "ADMIN", "MOD"]
const ALL_ROLES = [...STAFF_ROLES, "MEMBER"]

const numberParam = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

// GET /api/roles/users — searchable, paginated staff directory for moderation.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canModerate(me.role)) {
    return NextResponse.json({ error: "Only moderators can view user list" }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100)
  const role = (url.searchParams.get("role") || "ALL").trim().toUpperCase()
  const status = (url.searchParams.get("status") || "ALL").trim().toUpperCase()
  const page = numberParam(url.searchParams.get("page"), 1, 1, 100_000)
  const pageSize = numberParam(url.searchParams.get("pageSize"), 25, 10, 100)
  const excludeSelf = url.searchParams.get("excludeSelf") === "1"

  const where: Prisma.UserWhereInput = {}
  if (excludeSelf) where.id = { not: me.id }
  if (ALL_ROLES.includes(role)) where.role = role
  if (status === "MUTED") where.muted = true
  if (status === "ACTIVE") where.muted = false
  if (status === "STAFF") where.role = { in: STAFF_ROLES }
  if (status === "MEMBERS") where.role = "MEMBER"

  if (q) {
    const upper = q.toUpperCase()
    const or: Prisma.UserWhereInput[] = [
      { username: { contains: q } },
      { displayName: { contains: q } },
      { id: { contains: q } },
    ]
    if (ALL_ROLES.includes(upper)) or.push({ role: upper })
    where.AND = [{ OR: or }]
  }

  const [total, users] = await db.$transaction([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ role: "desc" }, { username: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  const activeBans = users.length ? await db.infraction.findMany({
    where: { userId: { in: users.map((entry) => entry.id) }, type: { in: ["BAN", "AUTO_BAN"] }, duration: null },
    select: { userId: true },
  }) : []
  const bannedIds = new Set(activeBans.map((entry) => entry.userId))

  return NextResponse.json({
    users: users.map((entry) => ({ ...toSafeUser(entry), banned: bannedIds.has(entry.id) })),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }, { headers: { "Cache-Control": "private, no-store" } })
}
