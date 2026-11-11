import test from "node:test"
import assert from "node:assert/strict"
import { chatHistoryCacheKey } from "../src/lib/chat-cache-key"
import { normalizePlaybackSource, playbackKey, trustedPlaybackUrl, validProgress } from "../src/lib/media-playback-policy"
import { proxyExternalAudio } from "../src/lib/music-server"
import { allowedMusicStreamUrl } from "../src/lib/music-stream-policy"

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
