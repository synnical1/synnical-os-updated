import test from "node:test"
import assert from "node:assert/strict"
import { isJapaneseAnime, mapTmdbMedia, uniqueTmdbItems } from "../src/lib/tmdb-catalog"

test("TMDB media mapping rejects malformed records and maps movie and TV fields", () => {
  assert.equal(mapTmdbMedia(null, "movie"), null)
  assert.equal(mapTmdbMedia({ id: 0, title: "Bad" }, "movie"), null)
  assert.equal(mapTmdbMedia({ id: 12, name: "The Show", original_name: "Original", first_air_date: "2024-02-03", poster_path: "/p.jpg", vote_average: 8.4 }, "tv")?.title, "The Show")
  const movie = mapTmdbMedia({ id: 99, title: "Film", original_title: "Original Film", release_date: "2020-01-01", poster_path: "https://evil.test/p.jpg", vote_average: 15 }, "movie")
  assert.equal(movie?.mediaType, "movie")
  assert.equal(movie?.posterPath, null)
  assert.equal(movie?.voteAverage, 10)
})

test("Synnime filter requires animation and Japanese origin or language", () => {
  assert.equal(isJapaneseAnime({ genre_ids: [16, 12], original_language: "ja" }), true)
  assert.equal(isJapaneseAnime({ genre_ids: [16], origin_country: ["JP"] }), true)
  assert.equal(isJapaneseAnime({ genre_ids: [16], original_language: "en" }), false)
  assert.equal(isJapaneseAnime({ genre_ids: [18], original_language: "ja" }), false)
})

test("TMDB item de-duplication uses media type plus TMDB ID", () => {
  const movie = mapTmdbMedia({ id: 5, title: "Film" }, "movie")
  const television = mapTmdbMedia({ id: 5, name: "Series" }, "tv")
  assert.equal(uniqueTmdbItems([movie, movie, television]).length, 2)
})
