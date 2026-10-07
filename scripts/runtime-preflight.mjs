import dotenv from "dotenv"
import { pathToFileURL } from "node:url"
import { resolveTmdbCredentials } from "../src/lib/server/tmdb-credentials.mjs"
import { probeMalq } from "../stratus/readiness.cjs"

async function boundedFetch(fetcher, url, options = {}) {
  return fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(5000) })
}

/** Reports states only: no credentials, URLs containing keys, response bodies or raw exceptions. */
export async function inspectRuntimeReadiness({ env = process.env, fetcher = globalThis.fetch, runtimeBase } = {}) {
  const configured = Boolean(env.STRATUS_API_KEY?.trim())
  const malq = await probeMalq(env.STRATUS_MALQ_URL || "http://127.0.0.1:4400", fetcher)
  const stratus = { key: configured ? "PRESENT" : "MISSING", malq, readiness: configured && malq === "ready" ? "ready" : "degraded", liveSession: "UNVERIFIED" }
  const auth = resolveTmdbCredentials(env)
  const tmdb = { credential: auth ? "UNVERIFIED" : "MISSING", catalogue: "UNVERIFIED", animeCatalogue: "UNVERIFIED" }
  if (auth) {
    try {
      const url = new URL("https://api.themoviedb.org/3/configuration")
      if (auth.apiKey) url.searchParams.set("api_key", auth.apiKey)
      const response = await boundedFetch(fetcher, url, auth.token ? { headers: { Authorization: `Bearer ${auth.token}` } } : {})
      tmdb.credential = response.ok ? "VALID" : [401, 403].includes(response.status) ? "REJECTED" : "UNVERIFIED"
      await response.body?.cancel().catch(() => {})
    } catch { /* Deliberately omit upstream error/URL/credentials. */ }
  }
  if (runtimeBase) {
    const base = new URL(runtimeBase)
    if (base.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(base.hostname) || base.username || base.password) throw new Error("Runtime preflight requires loopback HTTP")
    try {
      const api = await boundedFetch(fetcher, new URL("/api", base))
      if (!api.ok) throw new Error()
      await api.body?.cancel().catch(() => {})
      const healthResponse = await boundedFetch(fetcher, new URL("/api/games/cloud/v1/health", base))
      const health = await healthResponse.json()
      if (!healthResponse.ok || health.status !== "ok" || health.service !== "stratus" || typeof health.provider?.configured !== "boolean" || typeof health.provider?.ready !== "boolean" || !["ready", "degraded"].includes(health.readiness)) throw new Error()
      if (!["ready", "invalid", "unavailable", "unexpected_service"].includes(health.provider.malq)) throw new Error()
      const expectedReady = health.provider.configured && health.provider.malq === "ready" && !health.provider.cooldown
      if (health.provider.ready !== expectedReady || health.readiness !== (expectedReady ? "ready" : "degraded")) throw new Error()
      stratus.key = health.provider.configured ? "PRESENT" : "MISSING"
      stratus.malq = health.provider.malq
      stratus.readiness = health.readiness
      const catalogueResponse = await boundedFetch(fetcher, new URL("/api/games/cloud/v1/games", base))
      const games = await catalogueResponse.json()
      if (!catalogueResponse.ok || !Array.isArray(games) || games.length < 200 || typeof games[0]?.game_key !== "string") throw new Error()
    } catch { throw new Error("Application/Stratus liveness or catalogue contract failed") }
    for (const [mode, field] of [["", "catalogue"], ["?mode=anime", "animeCatalogue"]]) {
      try {
        const response = await boundedFetch(fetcher, new URL(`/api/synnflix/home${mode}`, base))
        const body = await response.json()
        const hasContent = ["trending", "popularMovies", "popularTv", "topRatedMovies", "topRatedTv"].some(name =>
          Array.isArray(body?.[name]) && body[name].some(item => Number.isSafeInteger(item?.id) && item.id > 0 && typeof item.title === "string" && item.title.trim() && ["movie", "tv"].includes(item.mediaType)))
        tmdb[field] = response.ok && hasContent ? "DATA" : response.status === 503 && !auth ? "UNAVAILABLE" : "UNVERIFIED"
      } catch { tmdb[field] = "UNVERIFIED" }
    }
  }
  return { stratus, tmdb }
}

export async function runPreflight({ env = process.env, fetcher = globalThis.fetch, runtime = false, write = console.log } = {}) {
  const report = await inspectRuntimeReadiness({ env, fetcher, runtimeBase: runtime ? `http://127.0.0.1:${env.PORT || "3000"}` : undefined })
  write(`[runtime-preflight:${runtime ? "after-reload" : "before-reload"}] ${JSON.stringify(report)}`)
  if (report.stratus.readiness !== "ready") write("WARNING: Games readiness is degraded; mounted routes do not prove gameplay readiness.")
  if (report.tmdb.credential !== "VALID" || (runtime && (report.tmdb.catalogue !== "DATA" || report.tmdb.animeCatalogue !== "DATA"))) write("WARNING: TMDB/catalogue readiness is unavailable or unverified; this deployment does not fix production credentials.")
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config()
  runPreflight({ runtime: process.argv.includes("--runtime") }).catch(() => {
    console.error("Runtime preflight failed: application health could not be verified."); process.exitCode = 1
  })
}
