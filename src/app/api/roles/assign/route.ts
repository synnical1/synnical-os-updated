import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser, canManageRoles, canManageTags, isAdmin } from "@/lib/auth"
import { canAssignRole, canModerateTarget } from "@/lib/roles"
import { publishModeration } from "@/lib/moderation-events"
import { ROLES, type Role } from "@/lib/constants"
import { auditData } from "@/lib/audit-log"
import { canonicalRecognitionTag, recognitionTags } from "@/lib/recognition-tags"

// POST /api/roles/assign — owner/admin assigns a role to a user
// body: { userId, role } OR { userId, tag, action: "addTag" | "removeTag" }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { userId, role, tag, action } = body

  // --- Tag management (owner/admin/mod) ---
  if (action === "addTag" || action === "removeTag") {
    if (!canManageTags(me.role)) {
      return NextResponse.json({ error: "Only moderators and above can manage tags" }, { status: 403 })
    }
    if (typeof userId !== "string" || typeof tag !== "string" || !tag.trim()) {
      return NextResponse.json({ error: "userId and tag required" }, { status: 400 })
    }

    const target = await db.user.findUnique({ where: { id: userId } })
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

    if (me.id !== target.id && !canModerateTarget(me.role, target.role)) return NextResponse.json({ error: "Cannot change tags for an equal or higher staff role" }, { status: 403 })
    let tags: string[] = []
    try { tags = JSON.parse(target.tags || "[]") } catch { tags = [] }

    const recognitionTag = canonicalRecognitionTag(tag)
    if (recognitionTag && !isAdmin(me.role)) {
      return NextResponse.json({ error: "Only Owner or Admin can manage recognition roles" }, { status: 403 })
    }
    const cleanTag = (recognitionTag || tag.trim()).slice(0, 20) // max 20 chars per tag

    if (action === "addTag") {
      if (recognitionTag) {
        if (!tags.includes(cleanTag)) tags.push(cleanTag)
      } else {
        const recognition = recognitionTags(tags)
        const ordinary = tags.filter((value) => !canonicalRecognitionTag(value) && value !== cleanTag)
        ordinary.push(cleanTag)
        tags = [...recognition, ...ordinary.slice(-5)] // five ordinary tags plus protected recognition badges
      }
    } else {
      tags = tags.filter(t => t !== cleanTag)
    }

    const beforeTags = (() => { try { return JSON.parse(target.tags || "[]") as string[] } catch { return [] as string[] } })()
    const updated = await db.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { tags: JSON.stringify(tags) } })
      await tx.auditLog.create({ data: auditData({
        category: "USER_MANAGEMENT",
        action: action === "addTag" ? "TAG_ADDED" : "TAG_REMOVED",
        actor: me,
        target: { id: target.id, username: target.username },
        before: { tags: beforeTags },
        after: { tags },
        metadata: { tag: cleanTag },
      }) })
      return user
    })
    publishModeration(userId, "ROLE")
  return NextResponse.json({ user: toSafeUser(updated) })
  }

  // --- Role assignment (owner/admin only) ---
  if (!canManageRoles(me.role)) {
    return NextResponse.json({ error: "Only the owner and admin can assign roles" }, { status: 403 })
  }

  if (typeof userId !== "string" || typeof role !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  if (!ROLES.includes(role as Role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 })
  }

  // The verified owner cannot demote themselves (prevent lockout).
  if (me.role === "OWNER" && userId === me.id && role !== "OWNER") {
    return NextResponse.json({ error: "You can't remove your own owner role" }, { status: 400 })
  }
  // OWNER is granted only by the server-side owner verification flow.
  if (role === "OWNER") {
    return NextResponse.json({ error: "Owner is granted only through secure owner verification" }, { status: 403 })
  }
  if (!canAssignRole(me.role, role)) {
    return NextResponse.json({ error: "You cannot assign that role" }, { status: 403 })
  }

  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (target.role === "OWNER") {
    return NextResponse.json({ error: "The owner role cannot be changed from User Management" }, { status: 403 })
  }
  if (!canModerateTarget(me.role, target.role)) {
    return NextResponse.json({ error: "You cannot change an equal or higher staff role" }, { status: 403 })
  }
  const updated = await db.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { role } })
    await tx.auditLog.create({ data: auditData({
      category: "USER_MANAGEMENT",
      action: "ROLE_CHANGED",
      actor: me,
      target: { id: target.id, username: target.username },
      before: { role: target.role },
      after: { role },
    }) })
    return user
  })
  publishModeration(userId, "ROLE")
  return NextResponse.json({ user: toSafeUser(updated) })
}
