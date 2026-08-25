import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { acceptedFriend, boundedJson, cleanMultiline, cleanText, safeJson, validId } from "@/lib/r10-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const KINDS = new Set(["avatar-decoration", "profile-effect", "particle-effect"])

type ProjectState = {
  assetUrl?: string; scale?: number; rotation?: number; opacity?: number; particleCount?: number; animationDuration?: number
  keyframes?: Array<{ time: number; scale: number; rotation: number; opacity: number }>
  collaborators?: string[]; attribution?: string; background?: "dark" | "light"
}
function stateOf(value: unknown): ProjectState { return safeJson<ProjectState>(value, {}) }
function sanitizeState(value: unknown): ProjectState {
  const raw = value && typeof value === "object" ? value as any : {}
  let assetUrl = cleanText(raw.assetUrl, 1200)
  if (assetUrl) { try { const u = new URL(assetUrl, "https://synnical.invalid"); if (!/^https?:$/.test(u.protocol) && !assetUrl.startsWith("/")) assetUrl = "" } catch { if (!assetUrl.startsWith("/")) assetUrl = "" } }
  const num = (v: unknown, min: number, max: number, fallback: number) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback
  const keyframes = Array.isArray(raw.keyframes) ? raw.keyframes.slice(0, 60).map((k: any) => ({ time: num(k.time, 0, 60, 0), scale: num(k.scale, .2, 4, 1), rotation: num(k.rotation, -1080, 1080, 0), opacity: num(k.opacity, 0, 1, 1) })).sort((a: any,b: any)=>a.time-b.time) : []
  const collaborators = Array.isArray(raw.collaborators) ? [...new Set(raw.collaborators.map((x: unknown) => validId(x)).filter(Boolean))].slice(0, 10) as string[] : []
  return { assetUrl, scale: num(raw.scale, .2, 4, 1), rotation: num(raw.rotation, -360, 360, 0), opacity: num(raw.opacity, 0, 1, 1), particleCount: Math.round(num(raw.particleCount, 0, 80, 12)), animationDuration: num(raw.animationDuration, .2, 30, 3), keyframes, collaborators, attribution: cleanText(raw.attribution, 160), background: raw.background === "light" ? "light" : "dark" }
}
async function projectAccess(projectId: string, userId: string) {
  const project = await db.creatorProject.findUnique({ where: { id: projectId } })
  if (!project) return null
  if (project.ownerId === userId) return { project, owner: true, state: stateOf(project.stateJson) }
  const state = stateOf(project.stateJson)
  if (state.collaborators?.includes(userId) && await acceptedFriend(project.ownerId, userId)) return { project, owner: false, state }
  return null
}
async function publicProject(row: any) {
  const [versions, followerCount, owner] = await Promise.all([
    db.creatorProjectVersion.findMany({ where: { projectId: row.id }, orderBy: { version: "desc" }, take: 30 }),
    db.creatorFollow.count({ where: { creatorId: row.ownerId } }),
    db.user.findUnique({ where: { id: row.ownerId }, select: { username: true, displayName: true } }),
  ])
  return { ...row, state: stateOf(row.stateJson), stateJson: undefined, versions: versions.map(v => ({ ...v, state: stateOf(v.stateJson), stateJson: undefined })), followerCount, owner }
}

export async function GET() {
  const me = await getCurrentUser(); if (!me) return fail("Unauthorized", 401)
  const owned = await db.creatorProject.findMany({ where: { ownerId: me.id }, orderBy: { updatedAt: "desc" }, take: 100 })
  const candidates = await db.creatorProject.findMany({ where: { ownerId: { not: me.id } }, orderBy: { updatedAt: "desc" }, take: 250 })
  const collaborating = [] as any[]
  for (const row of candidates) if (stateOf(row.stateJson).collaborators?.includes(me.id) && await acceptedFriend(row.ownerId, me.id)) collaborating.push(row)
  const following = await db.creatorFollow.findMany({ where: { followerId: me.id }, select: { creatorId: true } })
  return NextResponse.json({ projects: await Promise.all([...owned, ...collaborating].map(publicProject)), following: following.map(x => x.creatorId), meId: me.id })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser(); if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({})); const action = cleanText(body.action, 64)
  if (action === "create") {
    const kind = cleanText(body.kind, 50); const name = cleanText(body.name, 100)
    if (!KINDS.has(kind) || !name) return fail("Project type and name required")
    const row = await db.creatorProject.create({ data: { ownerId: me.id, kind, name, description: cleanMultiline(body.description, 1000), stateJson: boundedJson(sanitizeState(body.state)) } })
    await db.creatorProjectVersion.create({ data: { projectId: row.id, authorId: me.id, version: 1, note: "Initial draft", stateJson: row.stateJson } })
    return NextResponse.json({ project: await publicProject(row) })
  }
  const projectId = validId(body.projectId); const access = projectId ? await projectAccess(projectId, me.id) : null
  if (["save", "checkpoint", "restore", "duplicate", "delete", "collaborator", "status"].includes(action) && !access) return fail("Project not found or access denied", 404)
  if (action === "save") {
    const next = sanitizeState(body.state)
    if (!access!.owner) next.collaborators = access!.state.collaborators || []
    const row = await db.creatorProject.update({ where: { id: projectId }, data: { name: cleanText(body.name, 100) || access!.project.name, description: cleanMultiline(body.description, 1000), stateJson: boundedJson(next) } })
    return NextResponse.json({ project: await publicProject(row) })
  }
  if (action === "checkpoint") {
    const count = await db.creatorProjectVersion.count({ where: { projectId } })
    const version = count + 1
    const row = await db.creatorProjectVersion.create({ data: { projectId, authorId: me.id, version, note: cleanText(body.note, 200) || `Version ${version}`, stateJson: access!.project.stateJson } })
    return NextResponse.json({ version: { ...row, state: stateOf(row.stateJson), stateJson: undefined } })
  }
  if (action === "restore") {
    const versionId = validId(body.versionId); const version = await db.creatorProjectVersion.findFirst({ where: { id: versionId, projectId } })
    if (!version) return fail("Version not found", 404)
    const current = stateOf(access!.project.stateJson); const restored = stateOf(version.stateJson)
    if (!access!.owner) restored.collaborators = current.collaborators || []
    const row = await db.creatorProject.update({ where: { id: projectId }, data: { stateJson: boundedJson(restored) } })
    return NextResponse.json({ project: await publicProject(row) })
  }
  if (action === "duplicate") {
    const state = stateOf(access!.project.stateJson); state.collaborators = []
    const row = await db.creatorProject.create({ data: { ownerId: me.id, kind: access!.project.kind, name: `${access!.project.name} copy`.slice(0,100), description: access!.project.description, stateJson: boundedJson(state) } })
    await db.creatorProjectVersion.create({ data: { projectId: row.id, authorId: me.id, version: 1, note: "Duplicated project", stateJson: row.stateJson } })
    return NextResponse.json({ project: await publicProject(row) })
  }
  if (action === "delete") {
    if (!access!.owner) return fail("Only the owner can delete this project", 403)
    await db.$transaction([db.creatorProjectVersion.deleteMany({ where: { projectId } }), db.creatorProject.delete({ where: { id: projectId } })])
    return NextResponse.json({ deleted: true })
  }
  if (action === "collaborator") {
    if (!access!.owner) return fail("Only the owner can manage collaborators", 403)
    const collaboratorId = validId(body.userId); if (!collaboratorId || !await acceptedFriend(me.id, collaboratorId)) return fail("Collaborator must be an accepted friend", 400)
    const state = stateOf(access!.project.stateJson); const set = new Set(state.collaborators || [])
    if (body.remove) set.delete(collaboratorId); else { if (set.size >= 10) return fail("Maximum 10 collaborators"); set.add(collaboratorId) }
    state.collaborators = [...set]
    await db.creatorProject.update({ where: { id: projectId }, data: { stateJson: boundedJson(state) } })
    return NextResponse.json({ collaborators: state.collaborators })
  }
  if (action === "status") {
    if (!access!.owner) return fail("Only the owner can change project status", 403)
    const status = body.status === "beta" ? "beta" : "draft"
    const row = await db.creatorProject.update({ where: { id: projectId }, data: { status } })
    return NextResponse.json({ project: await publicProject(row) })
  }
  if (action === "follow") {
    const creatorId = validId(body.creatorId); if (!creatorId || creatorId === me.id) return fail("Choose another creator")
    const user = await db.user.findUnique({ where: { id: creatorId }, select: { id: true } }); if (!user) return fail("Creator not found", 404)
    if (body.follow === false) await db.creatorFollow.deleteMany({ where: { followerId: me.id, creatorId } })
    else await db.creatorFollow.upsert({ where: { followerId_creatorId: { followerId: me.id, creatorId } }, update: {}, create: { followerId: me.id, creatorId } })
    return NextResponse.json({ following: body.follow !== false })
  }
  if (action === "validate") {
    const state = sanitizeState(body.state); const warnings: string[] = []
    if (!state.assetUrl) warnings.push("No image/GIF asset URL is set; particle-only projects can ignore this.")
    if ((state.keyframes?.length || 0) > 30) warnings.push("More than 30 keyframes may be expensive on low-end devices.")
    if ((state.particleCount || 0) > 50) warnings.push("High particle counts can trigger automatic performance scaling.")
    return NextResponse.json({ valid: true, warnings, normalized: state })
  }
  return fail("Unknown action", 404)
}
