import { NextRequest, NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import crypto from "crypto"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { uploadsDir } from "@/lib/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const form = await req.formData()
  const file = form.get("file")
  const gameId = String(form.get("gameId") || "").trim().slice(0, 120)
  const sessionId = String(form.get("sessionId") || "").trim().slice(0, 128) || null
  if (!(file instanceof File) || !gameId) return NextResponse.json({ error: "Image and gameId required" }, { status: 400 })
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return NextResponse.json({ error: "Screenshots must be PNG, JPEG, or WebP" }, { status: 415 })
  if (file.size < 1 || file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Screenshot must be 10 MB or smaller" }, { status: 413 })
  if (sessionId && !await db.gameSession.findFirst({ where: { id: sessionId, userId: me.id } })) return NextResponse.json({ error: "Session not found" }, { status: 404 })
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg"
  const rel = path.join("game-screenshots-private", me.id, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`)
  const absolute = path.join(uploadsDir(), rel)
  await fs.mkdir(path.dirname(absolute), { recursive: true, mode: 0o750 })
  await fs.writeFile(absolute, Buffer.from(await file.arrayBuffer()), { mode: 0o640 })
  const screenshot = await db.gameScreenshot.create({ data: { userId: me.id, gameId, sessionId, fileUrl: rel } })
  return NextResponse.json({ screenshot: { ...screenshot, fileUrl: `/api/features/games/screenshot/${encodeURIComponent(screenshot.id)}` } })
}
