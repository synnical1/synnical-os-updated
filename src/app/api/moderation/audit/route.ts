import { NextRequest, NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canModerate } from "@/lib/auth"

export const dynamic = "force-dynamic"

const intParam = (value: string | null, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function parseJson(value: string) {
  try { return JSON.parse(value) } catch { return {} }
}

export async function GET(req: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || !canModerate(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const page = intParam(url.searchParams.get("page"), 1, 1, 100_000)
  const pageSize = intParam(url.searchParams.get("pageSize"), 30, 10, 100)
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100)
  const category = (url.searchParams.get("category") || "").trim().toUpperCase().slice(0, 64)
  const action = (url.searchParams.get("action") || "").trim().toUpperCase().slice(0, 96)

  const where: Prisma.AuditLogWhereInput = {}
  if (category && category !== "ALL") where.category = category
  if (action && action !== "ALL") where.action = action
  if (q) {
    where.OR = [
      { actorUsernameSnapshot: { contains: q } },
      { targetUsernameSnapshot: { contains: q } },
      { actorIdSnapshot: { contains: q } },
      { targetUserIdSnapshot: { contains: q } },
      { action: { contains: q.toUpperCase() } },
      { reason: { contains: q } },
    ]
  }

  const [total, rows, categories, actions] = await db.$transaction([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ])

  return NextResponse.json({
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    categories: categories.map((row) => row.category),
    actions: actions.map((row) => row.action),
    entries: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      before: parseJson(row.beforeJson),
      after: parseJson(row.afterJson),
      metadata: parseJson(row.metadataJson),
      beforeJson: undefined,
      afterJson: undefined,
      metadataJson: undefined,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } })
}
