import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { runtimeHealthSnapshot } from "@/lib/runtime-health"
import { aiProviderStatus } from "@/lib/ai-provider-pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function directoryUsage(root: string, maxFiles = 20000) {
  let bytes = 0, files = 0
  const stack = [root]
  while (stack.length && files < maxFiles) {
    const dir = stack.pop()!
    let entries: any[] = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) as any[] } catch { continue }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) { files += 1; try { bytes += (await fs.stat(full)).size } catch {} }
      if (files >= maxFiles) break
    }
  }
  return { bytes, files, truncated: files >= maxFiles }
}

function databasePath(): string | null {
  const value = process.env.DATABASE_URL || ""
  if (!value.startsWith("file:")) return null
  const raw = value.slice(5).split("?")[0]
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), raw)
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (me.role !== "OWNER") return NextResponse.json({ error: "Owner only" }, { status: 403 })
  const dbPath = databasePath()
  const uploadRoot = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(process.cwd(), "public", "uploads")
  const [users, messages, channels, activeGames, activeDownloads, events, uploadUsage, dbStat] = await Promise.all([
    db.user.count(), db.message.count(), db.channel.count(),
    db.gameSession.count({ where: { status: "active" } }),
    db.browserDownload.count({ where: { status: "started" } }),
    db.systemEvent.findMany({ orderBy: { createdAt: "desc" }, take: 80 }),
    directoryUsage(uploadRoot),
    dbPath ? fs.stat(/* turbopackIgnore: true */ dbPath).catch(() => null) : Promise.resolve(null),
  ])
  let pkg: any = {}
  try { pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8")) } catch {}
  const runtime = runtimeHealthSnapshot()
  return NextResponse.json({
    now: new Date().toISOString(),
    process: { pid: process.pid, uptimeSeconds: Math.floor(process.uptime()), node: process.version, memory: process.memoryUsage() },
    runtime,
    database: { kind: dbPath ? "sqlite" : "external", path: dbPath ? path.basename(dbPath) : null, bytes: dbStat?.size || null, users, messages, channels },
    uploads: uploadUsage,
    workload: { activeGameSessions: activeGames, activeDownloads },
    ai: { order: process.env.AI_PROVIDER_ORDER || "openrouter,groq,gemini", providers: aiProviderStatus(), observed: runtime.providers },
    moderation: { textMode: process.env.TEXT_MODERATION_MODE || "hybrid", provider: process.env.MODERATION_PROVIDER || "openai", transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe" },
    proxy: { scramjet: pkg?.dependencies?.["@mercuryworkshop/scramjet"] || null, controller: pkg?.dependencies?.["@mercuryworkshop/scramjet-controller"] || null, wisp: pkg?.dependencies?.["@mercuryworkshop/wisp-js"] || null },
    recentEvents: events,
  })
}
