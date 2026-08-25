import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser, canManageRoles, canManageTags, isOwnerLevel } from "@/lib/auth"
import { ROLES, type Role } from "@/lib/constants"
import { auditData } from "@/lib/audit-log"
import { canonicalRecognitionTag, recognitionTags } from "@/lib/recognition-tags"

// POST /api/roles/assign — owner/admin assigns a role to a user
// body: { userId, role } OR { userId, tag, action: "addTag" | "removeTag" }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
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

    let tags: string[] = []
    try { tags = JSON.parse(target.tags || "[]") } catch { tags = [] }

    const recognitionTag = canonicalRecognitionTag(tag)
    if (recognitionTag && !isOwnerLevel(me.role)) {
      return NextResponse.json({ error: "Only the owner or Head Admin can manage recognition badges" }, { status: 403 })
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
  // Only owner can set OWNER role
  if (role === "OWNER" && me.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can grant owner role" }, { status: 403 })
  }
  // Only the verified owner may create or remove Head Admin accounts.
  if (role === "HEAD_ADMIN" && me.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can grant Head Admin" }, { status: 403 })
  }
  // Admin can only assign MOD or MEMBER.
  if (me.role === "ADMIN" && role !== "MOD" && role !== "MEMBER") {
    return NextResponse.json({ error: "Admins can only assign Mod or Member roles" }, { status: 403 })
  }
  // Head Admin can manage the normal staff hierarchy, but not Owner or peers.
  if (me.role === "HEAD_ADMIN" && (role === "OWNER" || role === "HEAD_ADMIN")) {
    return NextResponse.json({ error: "Only the owner can manage Owner or Head Admin roles" }, { status: 403 })
  }
  // Can't set another user to OWNER (only the password-based verify grants owner)
  if (role === "OWNER" && userId !== me.id) {
    return NextResponse.json({ error: "Owner is granted only via password verification" }, { status: 403 })
  }

  const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (target.role === "OWNER" && me.role !== "OWNER") {
    return NextResponse.json({ error: "The owner role cannot be changed by staff" }, { status: 403 })
  }
  if (target.role === "HEAD_ADMIN" && me.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can change a Head Admin" }, { status: 403 })
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
  return NextResponse.json({ user: toSafeUser(updated) })
}
