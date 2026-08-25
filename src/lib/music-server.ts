import "server-only"

import type { MusicProvider, MusicProviderStatus, MusicTrack } from "@/lib/music-types"

const AUDIUS_BASE = "https://api.audius.co/v1"
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const AUDIUS_ID = /^[A-Za-z0-9_-]{1,64}$/

type UnknownRecord = Record<string, unknown>

export class MusicUpstreamError extends Error {
  constructor(message: string, public status = 502) {
    super(message)
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

function configuredBase(name: "PIPED_API_BASE" | "INVIDIOUS_API_BASE" | "COBALT_API_BASE"): string | null {
  const raw = (process.env[name] || "").trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null
    url.pathname = url.pathname.replace(/\/+$/, "") + "/"
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function audiusHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" }
  const bearer = (process.env.AUDIUS_BEARER_TOKEN || "").trim()
  const apiKey = (process.env.AUDIUS_API_KEY || "").trim()
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  if (apiKey) headers["x-api-key"] = apiKey
  return headers
}

async function jsonFetch(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" })
    if (!response.ok) throw new MusicUpstreamError(`Music provider returned HTTP ${response.status}`, response.status >= 400 && response.status < 500 ? response.status : 502)
    return await response.json()
  } catch (error) {
    if (error instanceof MusicUpstreamError) throw error
    throw new MusicUpstreamError(error instanceof Error && error.name === "AbortError" ? "Music provider timed out" : "Music provider is unavailable")
  } finally {
    clearTimeout(timeout)
  }
}

function unwrapData(body: unknown): unknown {
  const root = record(body)
  return "data" in root ? root.data : body
}

function normalizeAudiusTrack(value: unknown): MusicTrack | null {
  const item = record(value)
  const user = record(item.user)
  const artwork = record(item.artwork)
  const id = text(item.id)
  const title = text(item.title)
  if (!id || !title) return null
  return {
    id,
    provider: "audius",
    title,
    artist: text(user.name) || text(user.handle) || "Audius artist",
    artistHandle: text(user.handle) || null,
    artwork: safeExternalUrl(artwork["480x480"] ?? artwork._480x480 ?? artwork["1000x1000"] ?? artwork._1000x1000 ?? artwork["150x150"] ?? artwork._150x150),
    duration: Math.max(0, Math.floor(number(item.duration))),
    genre: text(item.genre) || null,
    playCount: Math.max(0, Math.floor(number(item.play_count ?? item.playCount))) || null,
    permalink: safeExternalUrl(item.permalink),
  }
}

function normalizeAudiusList(body: unknown): MusicTrack[] {
  const data = unwrapData(body)
  const list = Array.isArray(data) ? data : Array.isArray(record(data).tracks) ? record(data).tracks as unknown[] : []
  return list.map(normalizeAudiusTrack).filter((track): track is MusicTrack => Boolean(track)).slice(0, 40)
}

export async function audiusTrending(limit = 30): Promise<MusicTrack[]> {
  const url = new URL(`${AUDIUS_BASE}/tracks/trending`)
  url.searchParams.set("time", "week")
  url.searchParams.set("limit", String(Math.max(1, Math.min(40, limit))))
  return normalizeAudiusList(await jsonFetch(url.toString(), { headers: audiusHeaders() }))
}

export async function audiusSearch(query: string, limit = 30): Promise<MusicTrack[]> {
  const url = new URL(`${AUDIUS_BASE}/tracks/search`)
  url.searchParams.set("query", query)
  url.searchParams.set("limit", String(Math.max(1, Math.min(40, limit))))
  return normalizeAudiusList(await jsonFetch(url.toString(), { headers: audiusHeaders() }))
}

export function assertAudiusId(id: string): string {
  if (!AUDIUS_ID.test(id)) throw new MusicUpstreamError("Invalid Audius track id", 400)
  return id
}

export async function fetchAudiusStream(id: string, range: string | null): Promise<Response> {
  assertAudiusId(id)
  const headers = new Headers(audiusHeaders())
  headers.set("Accept", "audio/*,*/*;q=0.8")
  if (range) headers.set("Range", range.slice(0, 200))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const upstream = await fetch(`${AUDIUS_BASE}/tracks/${encodeURIComponent(id)}/stream`, {
      headers,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    })
    if (!upstream.ok && upstream.status !== 206) throw new MusicUpstreamError(`Audius stream returned HTTP ${upstream.status}`, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502)
    return upstream
  } catch (error) {
    if (error instanceof MusicUpstreamError) throw error
    throw new MusicUpstreamError(error instanceof Error && error.name === "AbortError" ? "Audius stream timed out" : "Audius stream is unavailable")
  } finally {
    clearTimeout(timeout)
  }
}

function parseVideoId(value: unknown): string | null {
  const raw = text(value)
  if (YOUTUBE_ID.test(raw)) return raw
  const match = raw.match(/[?&]v=([A-Za-z0-9_-]{11})/) || raw.match(/\/watch\?v=([A-Za-z0-9_-]{11})/)
  return match?.[1] || null
}

function normalizePipedSearch(body: unknown): MusicTrack[] {
  const items = Array.isArray(record(body).items) ? record(body).items as unknown[] : []
  return items.map((value): MusicTrack | null => {
    const item = record(value)
    const id = parseVideoId(item.url)
    const title = text(item.title)
    if (!id || !title) return null
    return {
      id,
      provider: "piped",
      title,
      artist: text(item.uploaderName) || "YouTube Music",
      artwork: safeExternalUrl(item.thumbnail),
      duration: Math.max(0, Math.floor(number(item.duration))),
      playCount: Math.max(0, Math.floor(number(item.views))) || null,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    }
  }).filter((track): track is MusicTrack => Boolean(track)).slice(0, 30)
}

function normalizeInvidiousSearch(body: unknown): MusicTrack[] {
  const items = Array.isArray(body) ? body : []
  return items.map((value): MusicTrack | null => {
    const item = record(value)
    const id = text(item.videoId)
    const title = text(item.title)
    if (!YOUTUBE_ID.test(id) || !title) return null
    const thumbs = Array.isArray(item.videoThumbnails) ? item.videoThumbnails : []
    const thumb = thumbs.map(record).map((entry) => safeExternalUrl(entry.url)).find(Boolean) || null
    return {
      id,
      provider: "invidious",
      title,
      artist: text(item.author) || "YouTube Music",
      artwork: thumb,
      duration: Math.max(0, Math.floor(number(item.lengthSeconds))),
      playCount: Math.max(0, Math.floor(number(item.viewCount))) || null,
      sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    }
  }).filter((track): track is MusicTrack => Boolean(track)).slice(0, 30)
}

export async function bridgeSearch(query: string): Promise<{ provider: "piped" | "invidious"; tracks: MusicTrack[] }> {
  const piped = configuredBase("PIPED_API_BASE")
  if (piped) {
    try {
      const url = new URL(`${piped}/search`)
      url.searchParams.set("q", query)
      url.searchParams.set("filter", "music_songs")
      return { provider: "piped", tracks: normalizePipedSearch(await jsonFetch(url.toString(), { headers: { Accept: "application/json" } })) }
    } catch (error) {
      if (!configuredBase("INVIDIOUS_API_BASE")) throw error
    }
  }

  const invidious = configuredBase("INVIDIOUS_API_BASE")
  if (invidious) {
    const url = new URL(`${invidious}/api/v1/search`)
    url.searchParams.set("q", query)
    url.searchParams.set("type", "video")
    return { provider: "invidious", tracks: normalizeInvidiousSearch(await jsonFetch(url.toString(), { headers: { Accept: "application/json" } })) }
  }
  throw new MusicUpstreamError("No self-hosted Piped or Invidious instance is configured", 503)
}

function chooseAudioUrl(value: unknown): string | null {
  const root = record(value)
  const streams = Array.isArray(root.audioStreams) ? root.audioStreams : Array.isArray(root.adaptiveFormats) ? root.adaptiveFormats : []
  const candidates = streams.map(record).map((stream) => ({
    url: safeExternalUrl(stream.url),
    bitrate: number(stream.bitrate),
    mime: text(stream.mimeType ?? stream.type),
    audioOnly: stream.videoOnly === false || !text(stream.mimeType ?? stream.type).startsWith("video/"),
  })).filter((entry) => entry.url && entry.audioOnly && (entry.mime.includes("audio") || !entry.mime))
  candidates.sort((a, b) => b.bitrate - a.bitrate)
  return candidates[0]?.url || null
}

export async function bridgeAudioSource(provider: "piped" | "invidious", id: string): Promise<string> {
  if (!YOUTUBE_ID.test(id)) throw new MusicUpstreamError("Invalid media id", 400)
  const base = configuredBase(provider === "piped" ? "PIPED_API_BASE" : "INVIDIOUS_API_BASE")
  if (!base) throw new MusicUpstreamError(`${provider === "piped" ? "Piped" : "Invidious"} is not configured`, 503)
  const url = provider === "piped" ? `${base}/streams/${id}` : `${base}/api/v1/videos/${id}`
  const body = await jsonFetch(url, { headers: { Accept: "application/json" } })
  const stream = chooseAudioUrl(body)
  if (!stream) throw new MusicUpstreamError("No playable audio stream was returned by the configured instance", 502)
  return stream
}

export async function proxyExternalAudio(url: string, range: string | null): Promise<Response> {
  const parsed = new URL(url)
  if (!(parsed.protocol === "https:" || (parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)))) {
    throw new MusicUpstreamError("Unsafe audio stream URL", 502)
  }
  const headers = new Headers({ Accept: "audio/*,*/*;q=0.8" })
  if (range) headers.set("Range", range.slice(0, 200))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(parsed, { headers, redirect: "follow", signal: controller.signal, cache: "no-store" })
    if (!response.ok && response.status !== 206) throw new MusicUpstreamError(`Audio source returned HTTP ${response.status}`, 502)
    return response
  } catch (error) {
    if (error instanceof MusicUpstreamError) throw error
    throw new MusicUpstreamError(error instanceof Error && error.name === "AbortError" ? "Audio source timed out" : "Audio source is unavailable")
  } finally {
    clearTimeout(timeout)
  }
}

export async function cobaltResolve(sourceUrl: string): Promise<string> {
  const base = configuredBase("COBALT_API_BASE")
  if (!base) throw new MusicUpstreamError("A self-hosted Cobalt instance is not configured", 503)
  let source: URL
  try {
    source = new URL(sourceUrl)
  } catch {
    throw new MusicUpstreamError("Enter a valid media URL", 400)
  }
  if (!/^https?:$/.test(source.protocol)) throw new MusicUpstreamError("Only HTTP(S) media URLs are supported", 400)

  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" }
  const key = (process.env.COBALT_API_KEY || "").trim()
  if (key) headers.Authorization = `Api-Key ${key}`
  const body = await jsonFetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: source.toString(), downloadMode: "audio", audioFormat: "best", localProcessing: "disabled" }),
  })
  const response = record(body)
  const resultUrl = safeExternalUrl(response.url)
  const status = text(response.status)
  if (resultUrl && ["tunnel", "redirect"].includes(status)) return resultUrl
  throw new MusicUpstreamError("Cobalt did not return a directly playable audio result", 502)
}

export function providerStatus(): MusicProviderStatus {
  return {
    audius: { available: true, authenticated: Boolean((process.env.AUDIUS_API_KEY || "").trim() || (process.env.AUDIUS_BEARER_TOKEN || "").trim()) },
    piped: { available: Boolean(configuredBase("PIPED_API_BASE")) },
    invidious: { available: Boolean(configuredBase("INVIDIOUS_API_BASE")) },
    cobalt: { available: Boolean(configuredBase("COBALT_API_BASE")) },
  }
}

export function assertBridgeProvider(value: string): "piped" | "invidious" {
  if (value === "piped" || value === "invidious") return value
  throw new MusicUpstreamError("Invalid music bridge provider", 400)
}

export function safeMusicError(error: unknown) {
  if (error instanceof MusicUpstreamError) return { message: error.message, status: error.status }
  console.error("[music] unexpected failure", error)
  return { message: "Music service failed", status: 500 }
}
