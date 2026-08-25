import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { isStaffRole } from "@/lib/shop-economy"

export const dynamic = "force-dynamic"
const clean = (value: unknown, max = 300) => typeof value === "string" ? value.trim().slice(0, max) : ""
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const [reminders, usage] = await Promise.all([
    db.botReminder.findMany({ where: { userId: me.id, status: { in: ["pending", "sending"] } }, orderBy: { dueAt: "asc" }, take: 100 }),
    db.botUsage.groupBy({ by: ["command"], _count: { command: true }, orderBy: { _count: { command: "desc" } }, take: 50 }),
  ])
  const customCommands = isStaffRole(me.role) ? await db.botCustomCommand.findMany({ orderBy: { name: "asc" } }) : []
  return NextResponse.json({ reminders, usage: usage.map((row) => ({ command: row.command, count: row._count.command })), customCommands, staff: isStaffRole(me.role) })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)

  if (action === "cancel-reminder") {
    const id = clean(body.id, 128)
    const changed = await db.botReminder.updateMany({ where: { id, userId: me.id, status: "pending" }, data: { status: "cancelled" } })
    return NextResponse.json({ cancelled: changed.count > 0 })
  }

  if (action === "save-custom-command") {
    if (!isStaffRole(me.role)) return fail("Staff only", 403)
    const name = clean(body.name, 40).toLowerCase().replace(/^\//, "")
    const response = clean(body.response, 1900)
    if (!/^[a-z0-9_-]{2,40}$/.test(name) || !response) return fail("Command name/response is invalid")
    const protectedNames = new Set(["help", "8ball", "remind", "countdown", "poll", "weather", "define", "convert", "currency", "teams", "bracket", "findmsg", "modsummary", "profile", "game", "botstats", "customcmd", "delcmd"])
    if (protectedNames.has(name)) return fail("That built-in command name is reserved", 409)
    const command = await db.botCustomCommand.upsert({ where: { name }, update: { response, enabled: true, createdById: me.id }, create: { name, response, createdById: me.id } })
    return NextResponse.json({ command })
  }

  if (action === "delete-custom-command") {
    if (!isStaffRole(me.role)) return fail("Staff only", 403)
    const name = clean(body.name, 40).toLowerCase().replace(/^\//, "")
    const deleted = await db.botCustomCommand.deleteMany({ where: { name } })
    return NextResponse.json({ deleted: deleted.count > 0 })
  }

  if (action === "toggle-custom-command") {
    if (!isStaffRole(me.role)) return fail("Staff only", 403)
    const name = clean(body.name, 40).toLowerCase().replace(/^\//, "")
    const row = await db.botCustomCommand.findUnique({ where: { name } })
    if (!row) return fail("Custom command not found", 404)
    const command = await db.botCustomCommand.update({ where: { name }, data: { enabled: !row.enabled } })
    return NextResponse.json({ command })
  }

  return fail("Unknown action", 404)
}
