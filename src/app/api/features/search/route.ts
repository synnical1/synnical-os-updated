import { NextRequest, NextResponse } from "next/server"
import { readFile } from "fs/promises"
import path from "path"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canAccessPublicChannel } from "@/lib/channel-permissions"
import { SYNN_BOT_COMMANDS } from "@/lib/synn-bot"
import { SHOP_CATALOG } from "@/lib/shop"
import { searchSynnFlix } from "@/lib/synnflix-tmdb"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const REAL_SETTINGS = [
  ["Account", "account"], ["Profiles", "profiles"], ["Privacy & Safety", "privacy"], ["Devices", "devices"], ["Connections", "connections"],
  ["Appearance", "appearance"], ["Accessibility", "accessibility"], ["Voice & Audio", "voice"], ["Notifications", "notifications"], ["Keybinds", "keybinds"],
  ["Language", "language"], ["Security", "security"], ["Chat", "chat"], ["Games", "games"], ["Browser", "browser"], ["Music", "music"],
  ["Performance", "performance"], ["Moderation", "moderation"], ["Profile", "profile"], ["Legal", "legal"],
] as const

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const q = (req.nextUrl.searchParams.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 100)
  if (q.length < 2) return NextResponse.json({ results: [] })
  const needle = q.toLowerCase()

  const [users, memberships, publicChannels, playlists] = await Promise.all([
    db.user.findMany({ where: { OR: [{ username: { contains: q } }, { displayName: { contains: q } }] }, select: { id: true, username: true, displayName: true, pfpUrl: true, role: true }, take: 12 }),
    db.membership.findMany({ where: { userId: me.id }, select: { channelId: true } }),
    db.channel.findMany({ where: { isDM: false, isGroup: false }, select: { id: true, name: true, allowedRoles: true } }),
    db.musicPlaylist.findMany({ where: { userId: me.id }, select: { id: true, name: true } }),
  ])
  const channelIds = new Set(memberships.map((row) => row.channelId))
  for (const channel of publicChannels) if (canAccessPublicChannel(channel.allowedRoles, me.role)) channelIds.add(channel.id)
  const [messages, playlistTracks] = await Promise.all([
    channelIds.size ? db.message.findMany({ where: { channelId: { in: [...channelIds] }, deleted: false, content: { contains: q } }, orderBy: { createdAt: "desc" }, select: { id: true, channelId: true, content: true, username: true, createdAt: true }, take: 15 }) : [],
    playlists.length ? db.musicPlaylistTrack.findMany({ where: { playlistId: { in: playlists.map((row) => row.id) }, OR: [{ title: { contains: q } }, { artist: { contains: q } }] }, take: 12 }) : [],
  ])

  let games: any[] = []
  try {
    const raw = JSON.parse(await readFile(path.join(process.cwd(), "stratus", "cloud.json"), "utf8"))
    if (Array.isArray(raw)) games = raw.filter((game) => `${game?.name || ""} ${game?.description || ""} ${(game?.tags || []).join(" ")}`.toLowerCase().includes(needle)).slice(0, 12)
  } catch {}
  const commands = SYNN_BOT_COMMANDS.filter((command) => `${command.name} ${command.description} ${command.category}`.toLowerCase().includes(needle)).slice(0, 12)
  const shop = SHOP_CATALOG.filter((item) => `${item.name} ${item.description} ${item.rarity}`.toLowerCase().includes(needle)).slice(0, 12)
  const settings = REAL_SETTINGS.filter(([label, id]) => `${label} ${id}`.toLowerCase().includes(needle)).map(([label, id]) => ({ label, id })).slice(0, 12)
  let movies: any[] = []
  try { movies = (await searchSynnFlix(q)).slice(0, 10) } catch {}

  const results = [
    ...users.map((user) => ({ type: "user", id: user.id, title: user.displayName, subtitle: `@${user.username}`, data: user })),
    ...messages.map((message) => ({ type: "message", id: message.id, title: message.username, subtitle: message.content.slice(0, 180), data: message })),
    ...games.map((game) => ({ type: "game", id: game.game_key, title: game.name, subtitle: (game.tags || []).join(" · "), data: game })),
    ...movies.map((movie) => ({ type: "movie", id: `${movie.mediaType}:${movie.id}`, title: movie.title, subtitle: movie.mediaType === "movie" ? "SynnFlix movie" : "SynnFlix TV", data: movie })),
    ...playlistTracks.map((track) => ({ type: "music", id: track.id, title: track.title, subtitle: track.artist, data: track })),
    ...commands.map((command) => ({ type: "command", id: command.name, title: `/${command.name}`, subtitle: command.description, data: command })),
    ...settings.map((setting) => ({ type: "setting", id: setting.id, title: setting.label, subtitle: "Settings", data: setting })),
    ...shop.map((item) => ({ type: "shop", id: `${item.type}:${item.id}`, title: item.name, subtitle: `${item.rarity} · ${item.price} credits`, data: item })),
  ]
  return NextResponse.json({ query: q, results: results.slice(0, 80) })
}
