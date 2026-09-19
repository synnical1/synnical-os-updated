import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"

export type LocalGame = {
  id: string
  title: string
  slug: string
  cover: string | null
  launchUrl: string
  source: "synnical" | "gmshelf"
  sourceRepo?: string
  tags: string[]
}

export type LocalGameCatalog = {
  generatedAt: string | null
  games: LocalGame[]
}

const BUILT_INS: LocalGame[] = [
  ["2048","2048","/games/covers/2048.png","/games/2048.html"],
  ["Breakout","breakout","/games/covers/breakout.png","/games/breakout.html"],
  ["Chess","chess","/games/covers/chess.svg","/games/chess.html"],
  ["Flappy","flappy","/games/covers/flappy.svg","/games/flappy.html"],
  ["Space Invaders","invaders","/games/covers/invaders.png","/games/invaders.html"],
  ["Memory","memory","/games/covers/memory.png","/games/memory.html"],
  ["Minesweeper","minesweeper","/games/covers/minesweeper.png","/games/minesweeper.html"],
  ["Pong","pong","/games/covers/pong.png","/games/pong.html"],
  ["Snake","snake","/games/covers/snake.png","/games/snake.html"],
  ["Sudoku","sudoku","/games/covers/sudoku.svg","/games/sudoku.html"],
  ["Tetris","tetris","/games/covers/tetris.png","/games/tetris.html"],
  ["Tic-Tac-Toe","tictactoe","/games/covers/tictactoe.svg","/games/tictactoe.html"],
].map(([title, slug, cover, launchUrl]) => ({
  id: `synnical:${slug}`,
  title,
  slug,
  cover,
  launchUrl,
  source: "synnical" as const,
  tags: ["Local"],
}))

export function safeGameSlug(value: string) {
  const slug = value.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(slug) || slug.includes("..")) return null
  return slug
}

function gamesDir() {
  return path.resolve(process.env.GAMES_DIR || "/var/lib/synnical/games")
}

function safePublicOrigin() {
  const raw = (process.env.GAMES_PUBLIC_ORIGIN || "").trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1","localhost","::1","[::1]"].includes(url.hostname))) return null
    url.pathname = url.pathname.replace(/\/+$/, "") + "/"
    url.search = ""
    url.hash = ""
    return url
  } catch {
    return null
  }
}

function normalizeImportedGame(value: unknown, origin: URL): LocalGame | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const slug = safeGameSlug(typeof row.slug === "string" ? row.slug : "")
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 120) : ""
  const sourceRepo = typeof row.sourceRepo === "string" ? row.sourceRepo.trim().slice(0, 120) : ""
  if (!slug || !title || !/^gmshelf\/(?:truffled|seraph|ugs|ckv)$/.test(sourceRepo)) return null
  const launch = new URL(`${encodeURIComponent(slug)}/`, origin).toString()
  const cover = typeof row.cover === "string" && /^https?:\/\//i.test(row.cover) ? row.cover : null
  return {
    id: `gmshelf:${slug}`,
    title,
    slug,
    cover,
    launchUrl: launch,
    source: "gmshelf",
    sourceRepo,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12) : ["Local"],
  }
}

export async function getLocalGameCatalog(): Promise<LocalGameCatalog> {
  const origin = safePublicOrigin()
  if (!origin) return { generatedAt: null, games: BUILT_INS }

  const catalogPath = path.join(gamesDir(), "catalog.json")
  try {
    const parsed = JSON.parse(await readFile(catalogPath, "utf8")) as { generatedAt?: unknown; games?: unknown }
    const imported = Array.isArray(parsed.games) ? parsed.games.map((game) => normalizeImportedGame(game, origin)).filter((game): game is LocalGame => Boolean(game)) : []
    const seen = new Set(BUILT_INS.map((game) => game.id))
    const deduped = imported.filter((game) => !seen.has(game.id) && (seen.add(game.id), true))
    return { generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null, games: [...BUILT_INS, ...deduped] }
  } catch {
    return { generatedAt: null, games: BUILT_INS }
  }
}
