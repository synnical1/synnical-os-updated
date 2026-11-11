import test from "node:test"
import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:http"
import { syncWallpaperPlayback } from "../src/lib/wallpaper-playback"
import { inspectRuntimeReadiness, runPreflight } from "../scripts/runtime-preflight.mjs"
import { probeMalq } from "../stratus/readiness.cjs"

const malq = () => new Response("<html><title>malq - a simple temporary email API</title></html>")
const { createStratusApp } = createRequire(import.meta.url)("../stratus/api.js")

test("mounted Stratus health cannot mark Games ready without both server key and malq", async () => {
  for (const configured of [false, true]) {
    let probes = 0
    const key = configured ? randomBytes(32).toString("hex") : ""
    const handle = createStratusApp({ apiKey: key, requireUserIdentity: true,
      sitesPath: new URL("../stratus/sites.synnical.json", import.meta.url).pathname,
      coreOptions: { accountPoolAllowed: false, malqUrl: "http://127.0.0.1:4400", fetch: async url => {
        assert.equal(new URL(url).pathname, "/", "health must not create an inbox/game")
        probes++
        return malq()
      } } })
    const server = createServer(handle.app)
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as { port: number }
    try {
      const [a, b] = await Promise.all([1, 2].map(async () => (await fetch(\`http://127.0.0.1:\${address.port}/cloud/v1/health\`)).json()))
      for (const body of [a, b]) {
        assert.equal(body.status, "ok")
        assert.equal(body.provider.configured, configured)
        assert.equal(body.provider.malq, "ready")
        assert.equal(body.provider.ready, configured)
        assert.equal(body.readiness, configured ? "ready" : "degraded")
        assert.equal(body.provider.live_session, "unverified")
        if (key) assert.ok(!JSON.stringify(body).includes(key))
      }
      assert.equal(probes, 1, "concurrent health requests coalesce their read-only probe")
    } finally { handle.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  }
})

test("wallpaper playback ignores automatic hints and respects only user pause, motion and visibility", async () => {
  let plays = 0
  let pauses = 0
  const video = { play: async () => { plays++ }, pause: () => { pauses++ } }
  const normal = { reduceMotion: false, hidden: false, userPaused: false }
  syncWallpaperPlayback(video, normal)
  syncWallpaperPlayback(video, normal)
  assert.equal(plays, 2)
  assert.equal(pauses, 0)
  for (const flag of ["reduceMotion", "hidden", "userPaused"]) syncWallpaperPlayback(video, { ...normal, [flag]: true })
  assert.equal(pauses, 3)
  syncWallpaperPlayback(video, normal)
  assert.equal(plays, 3, "resume after explicit pause clears")
  syncWallpaperPlayback({ ...video, play: async () => { throw new Error("autoplay denied") } }, normal)
  await Promise.resolve()
  const source = readFileSync(new URL("../src/components/wallpaper-video.tsx", import.meta.url), "utf8")
  assert.match(source, /syncWallpaperPlayback\(video/)
  assert.doesNotMatch(source, /synnical-perf-mode|synnical-battery-perf/)
})

test("malq probe rejects unsafe URLs/redirects and wrong services without creating mail sessions", async () => {
  let calls = 0
  for (const url of ["https://127.0.0.1:4400", "http://external.test", "http://127.0.0.1:4400/api/v1/session", "http://user:password@127.0.0.1:4400", "http://127.0.0.1:4400/?secret=value"]) {
    assert.equal(await probeMalq(url, async () => { calls++; return malq() }), "invalid")
  }
  assert.equal(calls, 0)
  assert.equal(await probeMalq("http://127.0.0.1:4400", async (url, options) => {
    assert.equal(new URL(url).pathname, "/")
    assert.equal(options.redirect, "error")
    return malq()
  }), "ready")
  assert.equal(await probeMalq("http://127.0.0.1:4400", async () => new Response("unrelated service")), "unexpected_service")
  assert.equal(await probeMalq("http://127.0.0.1:4400", async () => new Response("x".repeat(65537))), "unexpected_service")
  assert.equal(await probeMalq("http://127.0.0.1:4400", async () => { throw new Error("private upstream exception") }), "unavailable")
})

test("preflight reports only Games readiness and never contacts a retired metadata provider", async () => {
  const calls: string[] = []
  const fetcher = async url => {
    calls.push(new URL(url).hostname)
    throw new Error("private upstream diagnostic")
  }
  const report = await inspectRuntimeReadiness({ env: { TMDB_API_READ_TOKEN: "retired-value" }, fetcher })
  assert.deepEqual(Object.keys(report), ["stratus"])
  assert.equal(report.stratus.key, "MISSING")
  assert.equal(report.stratus.malq, "unavailable")
  assert.equal(report.stratus.readiness, "degraded")
  assert.equal(calls.length, 1)
  assert.equal(calls[0], "127.0.0.1")
  assert.doesNotMatch(JSON.stringify(report), /TMDB|retired-value|private upstream diagnostic/)

  const output: string[] = []
  await runPreflight({ env: {}, write: line => output.push(line), fetcher })
  assert.doesNotMatch(output.join("\n"), /TMDB|catalogue|private upstream diagnostic/)
})

test("post-reload preflight separates liveness from Games readiness and makes no media-catalogue requests", async () => {
  const paths: string[] = []
  const report = await inspectRuntimeReadiness({ env: {}, runtimeBase: "http://127.0.0.1:3000", fetcher: async url => {
    const parsed = new URL(url)
    paths.push(parsed.pathname + parsed.search)
    if (parsed.port === "4400") throw new Error("unavailable")
    if (parsed.pathname === "/api") return Response.json({ status: "ok" })
    if (parsed.pathname.endsWith("/health")) return Response.json({ status: "ok", service: "stratus", readiness: "degraded", provider: { configured: false, malq: "unavailable", ready: false } })
    if (parsed.pathname.endsWith("/games")) return Response.json(Array.from({ length: 200 }, () => ({ game_key: "fixture" })))
    throw new Error("Unexpected preflight endpoint")
  } })
  assert.equal(report.stratus.readiness, "degraded")
  assert.deepEqual(paths, ["/", "/api", "/api/games/cloud/v1/health", "/api/games/cloud/v1/games"])
  await assert.rejects(inspectRuntimeReadiness({ env: {}, runtimeBase: "http://127.0.0.1:3000", fetcher: async () => new Response("broken", { status: 500 }) }), /liveness/)
  await assert.rejects(inspectRuntimeReadiness({ env: {}, runtimeBase: "http://external.test", fetcher: async () => malq() }), /loopback/)
})

test("deployment runs configuration preflight before build and live readiness after PM2 reload", () => {
  const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8")
  assert.ok(workflow.indexOf("node scripts/runtime-preflight.mjs\n") < workflow.indexOf("npm run build"))
  assert.ok(workflow.indexOf("node scripts/runtime-preflight.mjs --runtime") > workflow.indexOf("pm2 reload synnical --update-env"))
  assert.match(workflow, /SYNNICAL_WALLPAPER_BROWSER_TEST: "true"/)
  assert.doesNotMatch(workflow, /TMDB|Synnical \+ bundled Stratus deployment completed/)
})

test("post-reload readiness requires a valid Games catalogue and rejects contradictory Games health", async () => {
  const env = { STRATUS_API_KEY: randomBytes(32).toString("hex") }
  let contradictory = false
  const fetcher = async url => {
    const parsed = new URL(url)
    if (parsed.port === "4400") return malq()
    if (parsed.pathname === "/api") return Response.json({ status: "ok" })
    if (parsed.pathname.endsWith("/health")) return Response.json({ status: "ok", service: "stratus", readiness: "ready", provider: { configured: !contradictory, malq: "ready", ready: true, cooldown: false } })
    if (parsed.pathname.endsWith("/games")) return Response.json(Array.from({ length: 200 }, () => ({ game_key: "fixture" })))
    throw new Error("Unexpected preflight endpoint")
  }
  const report = await inspectRuntimeReadiness({ env, fetcher, runtimeBase: "http://127.0.0.1:3000" })
  assert.deepEqual(Object.keys(report), ["stratus"])
  assert.equal(report.stratus.readiness, "ready")
  assert.ok(!JSON.stringify(report).includes(env.STRATUS_API_KEY))
  contradictory = true
  await assert.rejects(inspectRuntimeReadiness({ env, fetcher, runtimeBase: "http://127.0.0.1:3000" }), /liveness/)
})
