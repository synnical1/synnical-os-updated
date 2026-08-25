import { NextRequest, NextResponse } from "next/server"
import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"
import { db } from "@/lib/db"
import { toSafeUser } from "@/lib/auth"
import { getCurrentUser } from "@/lib/auth-server"
import { uploadsDir } from "@/lib/uploads"
import { listPendingMedia, readPendingMedia, resolvePendingMedia } from "@/lib/media-approvals"
import { recordAuditLog } from "@/lib/audit-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const staff = new Set(["OWNER", "HEAD_ADMIN", "ADMIN", "MOD"])

async function requireStaff() {
  const user = await getCurrentUser()
  return user && staff.has(user.role) ? user : null
}

export async function GET(req: NextRequest) {
  if (!await requireStaff()) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const previewId = req.nextUrl.searchParams.get("preview")
  if (previewId) {
    const pending = await readPendingMedia(previewId)
    if (!pending) return NextResponse.json({ error: "Pending upload not found" }, { status: 404 })
    // Next 16's DOM types do not accept Node's Buffer<ArrayBufferLike> as a
    // BodyInit even though it is valid at runtime. Use a plain Uint8Array so
    // both the type checker and the response stream receive the same bytes.
    return new NextResponse(new Uint8Array(pending.buffer), { headers: { "Content-Type": pending.item.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
  }
  return NextResponse.json({ items: await listPendingMedia() }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(req: NextRequest) {
  const actor = await requireStaff()
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { id, action } = await req.json().catch(() => ({}))
  if (typeof id !== "string" || !["approve", "decline"].includes(action)) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const pendingSnapshot = await readPendingMedia(id)
  if (!pendingSnapshot) return NextResponse.json({ error: "Pending upload not found" }, { status: 404 })
  const result = await resolvePendingMedia(id, async pending => {
    if (action === "decline") return { ok: true, action }
    const targetUser = await db.user.findUnique({ where: { id: pending.item.userId } })
    if (!targetUser) return { ok: false, action, gone: true }
    const dir = uploadsDir(); await mkdir(dir, { recursive: true })
    const filename = `${targetUser.id}-${pending.item.type}-${Date.now()}.webp`
    await writeFile(path.join(dir, filename), pending.buffer, { mode: 0o600 })
    const previous = pending.item.type === "banner" ? targetUser.bannerUrl : targetUser.pfpUrl
    const url = `/api/uploads/${filename}?v=${Date.now()}`
    let updated
    try {
      updated = await db.user.update({ where: { id: targetUser.id }, data: pending.item.type === "banner" ? { bannerUrl: url, bannerIsGif: pending.item.animated } : { pfpUrl: url, pfpIsGif: pending.item.animated } })
    } catch (error) {
      await unlink(path.join(dir, filename)).catch(() => {})
      throw error
    }
    if (previous?.startsWith("/api/uploads/")) await unlink(path.join(dir, path.basename(previous.split("?")[0]))).catch(() => {})
    return { ok: true, action, user: toSafeUser(updated) }
  })
  if (!result) return NextResponse.json({ error: "Pending upload not found" }, { status: 404 })
  if ("gone" in result && result.gone) return NextResponse.json({ error: "User no longer exists" }, { status: 410 })
  await recordAuditLog({
    category: "MEDIA",
    action: action === "approve" ? "MEDIA_APPROVED" : "MEDIA_DECLINED",
    actor,
    target: { id: pendingSnapshot.item.userId, username: pendingSnapshot.item.username },
    metadata: { approvalId: id, mediaType: pendingSnapshot.item.type, animated: pendingSnapshot.item.animated },
  })
  return NextResponse.json(result)
}
