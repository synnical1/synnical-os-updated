import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference, setPreference } from "@/lib/feature-platform"

export const dynamic = "force-dynamic"
const clean = (v: unknown, max = 1000) => typeof v === "string" ? v.trim().slice(0, max) : ""
const fail = (e: string, status = 400) => NextResponse.json({ error: e }, { status })
function httpUrl(value: unknown) { try { const u = new URL(String(value || "")); return /^https?:$/.test(u.protocol) ? u.toString() : "" } catch { return "" } }

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const [bookmarks, history, permissions, downloads, groups, workspaces] = await Promise.all([
    db.browserBookmark.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" }, take: 1000 }),
    db.browserHistory.findMany({ where: { userId: me.id, tempSessionId: null }, orderBy: { visitedAt: "desc" }, take: 1000 }),
    db.browserPermission.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" }, take: 500 }),
    db.browserDownload.findMany({ where: { userId: me.id }, orderBy: { startedAt: "desc" }, take: 200 }),
    getPreference<any[]>(me.id, "browser.groups", []),
    db.browserWorkspace.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" }, take: 100 }),
  ])
  return NextResponse.json({ bookmarks, history, permissions, downloads, session: null, groups, workspaces: workspaces.map((row) => ({ ...row, tabs: (() => { try { return JSON.parse(row.tabsJson) } catch { return [] } })(), notes: (() => { try { return JSON.parse(row.notesJson) } catch { return {} } })(), tabsJson: undefined, notesJson: undefined })) })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)

  if (action === "save-bookmark") {
    const url = httpUrl(body.url); const title = clean(body.title, 300) || url; const folder = clean(body.folder, 80)
    if (!url) return fail("Valid HTTP(S) bookmark URL required")
    const row = await db.browserBookmark.upsert({ where: { userId_url: { userId: me.id, url } }, update: { title, folder }, create: { userId: me.id, url, title, folder } })
    return NextResponse.json({ bookmark: row })
  }
  if (action === "delete-bookmark") {
    const id = clean(body.id, 128); const result = await db.browserBookmark.deleteMany({ where: { id, userId: me.id } }); return NextResponse.json({ deleted: result.count > 0 })
  }
  if (action === "record-history") {
    const url = httpUrl(body.url); if (!url) return fail("Valid HTTP(S) history URL required")
    const title = clean(body.title, 300) || url
    const tempSessionId = clean(body.tempSessionId, 128) || null
    const row = await db.browserHistory.create({ data: { userId: me.id, url, title, tempSessionId } })
    if (tempSessionId) await db.browserHistory.deleteMany({ where: { userId: me.id, tempSessionId, visitedAt: { lt: new Date(Date.now() - 86400000) } } })
    else {
      const stale = await db.browserHistory.findMany({ where: { userId: me.id, tempSessionId: null }, orderBy: { visitedAt: "desc" }, skip: 1000, select: { id: true } })
      if (stale.length) await db.browserHistory.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } })
    }
    return NextResponse.json({ history: row })
  }
  if (action === "clear-history") {
    const tempSessionId = clean(body.tempSessionId, 128)
    const result = await db.browserHistory.deleteMany({ where: { userId: me.id, ...(tempSessionId ? { tempSessionId } : { tempSessionId: null }) } })
    return NextResponse.json({ deleted: result.count })
  }
  if (action === "delete-history") {
    const id = clean(body.id, 128); const result = await db.browserHistory.deleteMany({ where: { id, userId: me.id } }); return NextResponse.json({ deleted: result.count > 0 })
  }
  if (action === "set-permission") {
    let origin = ""; try { origin = new URL(String(body.origin || "")).origin } catch {}
    if (!/^https?:\/\//.test(origin)) return fail("Valid site origin required")
    const allowed = new Set(["ask", "allow", "block"])
    const popups = allowed.has(body.popups) ? body.popups : "ask"
    const notifications = allowed.has(body.notifications) ? body.notifications : "ask"
    const storage = new Set(["allow", "block"]).has(body.storage) ? body.storage : "allow"
    const permission = await db.browserPermission.upsert({ where: { userId_origin: { userId: me.id, origin } }, update: { popups, notifications, storage }, create: { userId: me.id, origin, popups, notifications, storage } })
    return NextResponse.json({ permission })
  }
  if (action === "save-session") {
    // Older clients may still call this endpoint. Clear their stored session so
    // every Browser launch starts on New Tab instead of reopening the last site.
    await setPreference(me.id, "browser.session", null)
    return NextResponse.json({ ok: true })
  }
  if (action === "save-groups") {
    const groups = Array.isArray(body.groups) ? body.groups.slice(0, 30).map((g: any) => ({ id: clean(g.id, 128), name: clean(g.name, 80), collapsed: Boolean(g.collapsed) })).filter((g: any) => g.id && g.name) : []
    await setPreference(me.id, "browser.groups", groups)
    return NextResponse.json({ groups })
  }
  if (action === "save-workspace") {
    const name = clean(body.name, 100); if (!name) return fail("Workspace name required")
    const layout = body.layout === "split" ? "split" : "tabs"
    const tabs = Array.isArray(body.tabs) ? body.tabs.slice(0, 50).map((tab: any) => ({ id: clean(tab.id, 128) || undefined, url: httpUrl(tab.url) || null, input: clean(tab.input, 2000), title: clean(tab.title, 300), groupId: clean(tab.groupId, 128) || null })).filter((tab: any) => tab.url || tab.input) : []
    const notes = body.notes && typeof body.notes === "object" ? body.notes : {}
    const row = await db.browserWorkspace.upsert({ where: { userId_name: { userId: me.id, name } }, update: { layout, tabsJson: JSON.stringify(tabs), notesJson: JSON.stringify(notes).slice(0, 20000) }, create: { userId: me.id, name, layout, tabsJson: JSON.stringify(tabs), notesJson: JSON.stringify(notes).slice(0, 20000) } })
    return NextResponse.json({ workspace: { ...row, tabs, notes, tabsJson: undefined, notesJson: undefined } })
  }
  if (action === "delete-workspace") {
    const id = clean(body.id, 128); const result = await db.browserWorkspace.deleteMany({ where: { id, userId: me.id } }); return NextResponse.json({ deleted: result.count > 0 })
  }
  if (action === "download-start") {
    const url = httpUrl(body.url); if (!url) return fail("Valid download URL required")
    const row = await db.browserDownload.create({ data: { userId: me.id, url, filename: clean(body.filename, 300) || "download", bytesTotal: Number.isFinite(Number(body.bytesTotal)) ? Math.max(0, Math.round(Number(body.bytesTotal))) : null } })
    return NextResponse.json({ download: row })
  }
  if (action === "download-update") {
    const id = clean(body.id, 128); const row = await db.browserDownload.findFirst({ where: { id, userId: me.id } }); if (!row) return fail("Download not found", 404)
    const status = ["started", "complete", "failed", "cancelled"].includes(body.status) ? body.status : row.status
    const updated = await db.browserDownload.update({ where: { id }, data: { status, bytesReceived: Math.max(0, Math.round(Number(body.bytesReceived) || row.bytesReceived)), error: clean(body.error, 500) || null, finishedAt: status === "complete" || status === "failed" || status === "cancelled" ? new Date() : null } })
    return NextResponse.json({ download: updated })
  }

  return fail("Unknown action", 404)
}
