import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { uploadsDir } from "@/lib/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return new NextResponse("Unauthorized", { status: 401 })
  const { id } = await params
  const shot = await db.gameScreenshot.findFirst({ where: { id, userId: me.id } })
  if (!shot) return new NextResponse("Not found", { status: 404 })
  const root = path.resolve(uploadsDir())
  const full = path.resolve(root, shot.fileUrl)
  if (!full.startsWith(root + path.sep)) return new NextResponse("Not found", { status: 404 })
  try {
    const bytes = await fs.readFile(full)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="synnical-screenshot${path.extname(full).toLowerCase()}"`,
      },
    })
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const shot = await db.gameScreenshot.findFirst({ where: { id, userId: me.id } })
  if (!shot) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const root = path.resolve(uploadsDir())
  const full = path.resolve(root, shot.fileUrl)
  if (!full.startsWith(root + path.sep)) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await db.gameScreenshot.delete({ where: { id: shot.id } })
  try { await fs.unlink(full) } catch (error: any) { if (error?.code !== "ENOENT") console.warn("[games/screenshots] file cleanup failed", error) }
  return NextResponse.json({ deleted: true })
}
