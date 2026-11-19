import test from "node:test"
import assert from "node:assert/strict"
import { cineSrcEpisodeSource, cineSrcMovieSource } from "../src/lib/media-cinesrc"

test("CineSrc movie source uses the documented TMDB embed route", () => {
  const source = cineSrcMovieSource(1084242)
  assert.equal(source?.providerId, "cinesrc")
  assert.equal(source?.kind, "embed")
  const url = new URL(source!.url)
  assert.equal(url.origin, "https://cinesrc.st")
  assert.equal(url.pathname, "/embed/movie/1084242")
  assert.equal(url.searchParams.get("autoplay"), "true")
  assert.equal(url.searchParams.get("back"), "close")
  assert.equal(url.searchParams.get("color"), "#ffffff")
})

test("CineSrc TV source uses TMDB ID and explicit season/episode parameters", () => {
  const source = cineSrcEpisodeSource(1396, 1, 2)
  assert.equal(source?.providerId, "cinesrc")
  const url = new URL(source!.url)
  assert.equal(url.origin, "https://cinesrc.st")
  assert.equal(url.pathname, "/embed/tv/1396")
  assert.equal(url.searchParams.get("s"), "1")
  assert.equal(url.searchParams.get("e"), "2")
  assert.equal(url.searchParams.get("autonext"), "false")
  assert.equal(url.searchParams.get("back"), "close")
})

test("CineSrc source builders reject invalid TMDB and episode identities", () => {
  assert.equal(cineSrcMovieSource(0), null)
  assert.equal(cineSrcMovieSource(-1), null)
  assert.equal(cineSrcMovieSource(1.5), null)
  assert.equal(cineSrcEpisodeSource(10, -1, 1), null)
  assert.equal(cineSrcEpisodeSource(10, 1, 0), null)
  assert.equal(cineSrcEpisodeSource(Number.MAX_SAFE_INTEGER + 1, 1, 1), null)
})
