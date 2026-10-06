import test from "node:test"
import assert from "node:assert/strict"
import { chatHistoryCacheKey } from "../src/lib/chat-cache-key"
import { randomBytes } from "node:crypto"
import { normalizePlaybackSource, playbackKey, trustedPlaybackUrl, validProgress } from "../src/lib/media-playback-policy"
import { proxyExternalAudio } from "../src/lib/music-server"
import { allowedMusicStreamUrl } from "../src/lib/music-stream-policy"
import { tmdbMetadataProvider, SynnFlixUpstreamError } from "../src/lib/synnflix-tmdb"

test("playback source trust requires operator origin approval and denies URL injection", () => {
  const origins = ["https://media.example.org"]
  for (const url of ["http://media.example.org/a.mp4", "https://evil.example/a", "javascript:alert(1)", "https://media.example.org@evil.example/a", "https://u:p@media.example.org/a", "https://media.example.org/a#fragment", "https://127.0.0.1/a", "https://[::1]/a"]) assert.equal(trustedPlaybackUrl(url, origins), null)
  assert.equal(trustedPlaybackUrl("https://media.example.org/a.mp4", origins), "https://media.example.org/a.mp4")
  const source = normalizePlaybackSource({ providerId: "licensed", kind: "file", url: "https://media.example.org/a.mp4", duration: Infinity, subtitles: [{ url: "https://evil.example/x.vtt", language: "en", label: "bad" }, { url: "https://media.example.org/en.vtt", language: "en", label: "English" }] }, origins)
  assert.equal(source?.subtitles?.length, 1)
  assert.equal(source?.duration, undefined)
  assert.equal(normalizePlaybackSource({ providerId: "licensed", kind: "script", url: "https://media.example.org/a" }, origins), null)
  assert.equal(playbackKey({ mediaType: "tv", mediaId: 15, season: 0, episode: 2 }), "tv:15:0:2")
})
test("progress rejects coercion and corrupt values, bounds seek to duration", () => {
  for (const time of [NaN, Infinity, -1, 864001, "50", {}, null]) assert.equal(validProgress(time, 100), null)
  for (const duration of [NaN, Infinity, -1, 864001, "100", null]) assert.equal(validProgress(50, duration), null)
  assert.deepEqual(validProgress(120, 100), { currentTime: 100, duration: 100 })
  assert.deepEqual(validProgress(50, 0), { currentTime: 50, duration: 0 })
})
test("music bridge URLs do not permit private or unapproved redirect targets", () => {
  const previous = [process.env.PIPED_API_BASE, process.env.INVIDIOUS_API_BASE, process.env.MUSIC_STREAM_ALLOWED_ORIGINS]
  delete process.env.PIPED_API_BASE; delete process.env.INVIDIOUS_API_BASE; delete process.env.MUSIC_STREAM_ALLOWED_ORIGINS
  try {
    for (const url of ["http://127.0.0.1/a", "https://localhost/a", "https://169.254.169.254/a", "https://evil.example/a", "https://googlevideo.com.evil.example/a"]) assert.equal(allowedMusicStreamUrl(url), null)
    assert.ok(allowedMusicStreamUrl("https://rr1.googlevideo.com/a"))
    process.env.MUSIC_STREAM_ALLOWED_ORIGINS = "https://licensed-audio.example"
    assert.ok(allowedMusicStreamUrl("https://licensed-audio.example/a"))
    assert.equal(allowedMusicStreamUrl("https://licensed-audio.example.evil.example/a"), null)
  } finally {
    for (const [index, name] of ["PIPED_API_BASE", "INVIDIOUS_API_BASE", "MUSIC_STREAM_ALLOWED_ORIGINS"].entries()) { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index] }
  }
})
test("TMDB TV specials, episode metadata and paginated anime catalogue stay typed", async () => {
  const oldFetch = globalThis.fetch
  const names = ["TMDB_READ_TOKEN", "TMDB_API_READ_TOKEN", "TMDB_API_KEY"]
  const previous = names.map(name => process.env[name])
  process.env.TMDB_READ_TOKEN = [1,2,3].map(() => randomBytes(10).toString("base64url")).join(".")
  delete process.env.TMDB_API_READ_TOKEN; delete process.env.TMDB_API_KEY
  const calls: URL[] = []
  const tv = { id: 51, name: "Fixture anime", original_name: "Alternative", original_language: "ja", genre_ids: [16], genres: [{ id: 16, name: "Animation" }], episode_run_time: [24], number_of_episodes: 2, number_of_seasons: 1, status: "Ended", production_companies: [{ name: "Fixture studio" }], seasons: [{ id: 61, season_number: 0, name: "Specials", episode_count: 1 }], alternative_titles: { results: [{ title: "Another title" }] } }
  globalThis.fetch = async input => {
    const url = new URL(String(input)); calls.push(url)
    if (url.pathname.endsWith("/season/0")) return Response.json({ id: 61, season_number: 0, name: "Specials", episodes: [{ id: 71, season_number: 0, episode_number: 1, name: "Special episode", overview: "Episode summary", runtime: 24, air_date: "2026-01-01" }] })
    if (url.pathname.includes("/discover/")) return Response.json({ results: [tv, { id: 52, name: "Non-anime", original_language: "en", genre_ids: [16] }] })
    return Response.json(tv)
  }
  try {
    const details = await tmdbMetadataProvider.details("tv", 51)
    assert.equal(details.mediaType, "tv"); assert.equal(details.runtimeMinutes, 24)
    assert.equal(details.numberOfEpisodes, 2); assert.equal(details.seasons[0].seasonNumber, 0)
    assert.deepEqual(details.alternativeTitles, ["Another title"]); assert.deepEqual(details.studios, ["Fixture studio"])
    const specials = await tmdbMetadataProvider.season(51, 0)
    assert.equal(specials.episodes[0].seasonNumber, 0); assert.equal(specials.episodes[0].runtimeMinutes, 24)
    assert.equal(specials.episodes[0].stillPath, null); assert.equal(specials.episodes[0].overview, "Episode summary")
    const home = await tmdbMetadataProvider.home({ animeOnly: true, page: 2 })
    assert.equal(home.popularTv.length, 1)
    for (const url of calls.filter(url => url.pathname.includes("discover"))) { assert.equal(url.searchParams.get("page"), "2"); assert.equal(url.searchParams.get("with_original_language"), "ja") }
  } finally {
    globalThis.fetch = oldFetch
    names.forEach((name,index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index] })
  }
})
test("TMDB adapter coalesces/cache requests, paginates, normalizes details and safely handles failure/backoff", async () => {
  const oldFetch = globalThis.fetch
  const oldEnv = [process.env.TMDB_READ_TOKEN, process.env.TMDB_API_READ_TOKEN, process.env.TMDB_API_KEY]
  delete process.env.TMDB_API_READ_TOKEN; delete process.env.TMDB_API_KEY
  process.env.TMDB_READ_TOKEN = [1,2,3].map(() => randomBytes(10).toString("base64url")).join(".")
  const calls: URL[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url)
    assert.equal(url.origin, "https://api.themoviedb.org")
    assert.ok(new Headers(init?.headers).has("Authorization"))
    assert.equal(url.searchParams.has("api_key"), false)
    if (url.pathname.endsWith("/999")) return new Response("", { status: 429, headers: { "Retry-After": "12" } })
    if (url.pathname.endsWith("/998")) return new Response("not json", { status: 200 })
    if (url.pathname.endsWith("/997")) return new Response("", { status: 401 })
    if (url.pathname.endsWith("/996")) throw new Error("Sensitive upstream diagnostic must not be surfaced")
    if (url.pathname.endsWith("/995")) return new Response("", { status: 404 })
    const media = { id: 42, title: "Fixture movie", overview: "Fixture", media_type: "movie", runtime: 100, genres: [{ name: "Drama" }], credits: { cast: [{ id: 7, name: "Actor", character: "Character" }] }, recommendations: { results: [{ id: 43, title: "Similar", media_type: "movie" }] }, similar: { results: [] }, production_companies: [{ name: "Studio" }] }
    await new Promise(resolve => setTimeout(resolve, 5))
    return Response.json(url.pathname.includes("search") ? { results: [media, media, { id: 50, media_type: "person", name: "Ignore" }], total_pages: 3 } : media)
  }
  try {
    const [a,b] = await Promise.all([tmdbMetadataProvider.details("movie", 42), tmdbMetadataProvider.details("movie", 42)])
    assert.deepEqual(a,b); assert.equal(calls.length, 1)
    await tmdbMetadataProvider.details("movie", 42); assert.equal(calls.length, 1)
    assert.equal(a.cast[0].name, "Actor"); assert.equal(a.recommendations.length, 1)
    assert.equal(calls[0].searchParams.get("append_to_response"), "credits,recommendations,similar,alternative_titles")
    const page = await tmdbMetadataProvider.search("fixture", { page: 2 })
    assert.equal(page.results.length, 1); assert.equal(page.page, 2); assert.equal(page.totalPages, 3)
    assert.equal(calls.at(-1)?.searchParams.get("page"), "2")
    await assert.rejects(tmdbMetadataProvider.search("fixture", { page: 501 }), (e: unknown) => e instanceof SynnFlixUpstreamError && e.status === 400)
    for (const [id,status] of [[998,502],[997,503],[996,502],[995,404]]) await assert.rejects(tmdbMetadataProvider.details("movie", id), (e: unknown) => e instanceof SynnFlixUpstreamError && e.status === status && !e.message.includes("Sensitive"))
    await assert.rejects(tmdbMetadataProvider.details("movie", 999), (e: unknown) => e instanceof SynnFlixUpstreamError && e.retryAfterSeconds === 12)
    const count = calls.length
    await assert.rejects(tmdbMetadataProvider.details("movie", 1000), (e: unknown) => e instanceof SynnFlixUpstreamError && e.status === 503)
    assert.equal(calls.length,count)
    delete process.env.TMDB_READ_TOKEN
    await assert.rejects(tmdbMetadataProvider.details("movie", 42), (e: unknown) => e instanceof SynnFlixUpstreamError && e.status === 503)
  } finally {
    globalThis.fetch = oldFetch
    for (const [index,name] of ["TMDB_READ_TOKEN", "TMDB_API_READ_TOKEN", "TMDB_API_KEY"].entries()) { if (oldEnv[index] === undefined) delete process.env[name]; else process.env[name] = oldEnv[index] }
  }
})

test("private chat history keys segregate accounts and ambiguous identity pairs", () => {
  assert.notEqual(chatHistoryCacheKey("account-a", "shared-channel"), chatHistoryCacheKey("account-b", "shared-channel"))
  assert.notEqual(chatHistoryCacheKey("a:b", "c"), chatHistoryCacheKey("a", "b:c"))
  assert.notEqual(chatHistoryCacheKey("a", "private-1"), chatHistoryCacheKey("a", "private-2"))
})

test("audio proxy refuses private redirect before issuing a second network request", async () => {
  const oldFetch = globalThis.fetch
  const previous = process.env.MUSIC_STREAM_ALLOWED_ORIGINS
  process.env.MUSIC_STREAM_ALLOWED_ORIGINS = "https://licensed-audio.example"
  const calls: string[] = []
  globalThis.fetch = async input => { calls.push(String(input)); return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } }) }
  try {
    await assert.rejects(proxyExternalAudio("https://licensed-audio.example/audio", null), /redirect is not approved/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0], "https://licensed-audio.example/audio")
  } finally {
    globalThis.fetch = oldFetch
    if (previous === undefined) delete process.env.MUSIC_STREAM_ALLOWED_ORIGINS; else process.env.MUSIC_STREAM_ALLOWED_ORIGINS = previous
  }
})
