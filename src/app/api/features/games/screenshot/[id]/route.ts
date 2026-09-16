import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import path from "node:path"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { uploadsDir } from "@/lib/uploads"
import { serveUpload } from "@/lib/upload-serving"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
type Context = { params: Promise<{ id: string }> }

async function privateFile(userId: string, fileUrl: string) {
  const root = path.resolve(uploadsDir())
  const parent = path.join(root, "game-screenshots-private", userId)
  const full = path.resolve(root, fileUrl)
  if (path.dirname(full) !== parent || !/\.(png|jpe?g|webp)$/i.test(full)) return null
  // Uploaded files cannot choose their path; also reject symlinked parent folders.
  try { if (await fs.realpath(parent) !== path.join(await fs.realpath(root), "game-screenshots-private", userId)) return null } catch { return null }
  return { parent, full, name: path.basename(full) }
}

export async function GET(req: Request, { params }: Context) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const { id } = await params
  const shot = await db.gameScreenshot.findFirst({ where: { id, userId: me.id } })
  if (!shot) return fail("Not found", 404)
  const file = await privateFile(me.id, shot.fileUrl)
  if (!file) return fail("Not found", 404)
  const response = await serveUpload(file.parent, [file.name], req)
  response.headers.set("Cache-Control", "private, no-store")
  return response
}
export const HEAD = GET

export async function DELETE(_req: Request, { params }: Context) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const { id } = await params
  const changed = await db.gameScreenshot.updateMany({ where: { id, userId: me.id, deletedAt: null }, data: { deletedAt: new Date() } })
  if (!changed.count) return fail("Screenshot not found or already recycled", 404)
  return NextResponse.json({ deleted: true, recycled: true })
}

export async function PATCH(req: Request, { params }: Context) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action
  const shot = await db.gameScreenshot.findFirst({ where: { id, userId: me.id } })
  if (!shot) return fail("Screenshot not found", 404)
  if (action === "restore") {
    await db.gameScreenshot.updateMany({ where: { id, userId: me.id }, data: { deletedAt: null } })
    return NextResponse.json({ restored: true })
  }
  if (action === "rename") {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name || name.length > 120 || /[\x00-\x1f/\\]/.test(name)) return fail("Name must be 1–120 characters without slashes or control characters")
    await db.gameScreenshot.updateMany({ where: { id, userId: me.id }, data: { name } })
    return NextResponse.json({ renamed: true })
  }
  if (action !== "purge") return fail("Unknown action", 404)
  if (!shot.deletedAt) return fail("Move the screenshot to Recycle Bin first", 409)
  // Compare the timestamp so a concurrent restore cannot be permanently deleted.
  const changed = await db.gameScreenshot.deleteMany({ where: { id, userId: me.id, deletedAt: shot.deletedAt } })
  if (!changed.count) return fail("Screenshot changed; refresh and try again", 409)
  const file = await privateFile(me.id, shot.fileUrl)
  if (file) await fs.unlink(file.full).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") console.warn("Screenshot cleanup failed", { code: error.code }) })
  return NextResponse.json({ purged: true })
}
