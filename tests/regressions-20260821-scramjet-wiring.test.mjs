import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")

test("Scramjet runtime and imported controller worker share one cache identity", () => {
  const runtime = read("src/lib/proxy-runtime.ts")
  const worker = read("public/sw.js")
  const runtimeVersion = runtime.match(/PROXY_RUNTIME_VERSION\s*=\s*["']([^"']+)/)?.[1]
  const workerVersion = worker.match(/SYNNICAL_PROXY_RUNTIME\s*=\s*["']([^"']+)/)?.[1]

  assert.ok(runtimeVersion)
  assert.equal(workerVersion, runtimeVersion)
  assert.match(worker, /controller\.sw\.js\?synnical-runtime=/)
})

test("Scramjet awaits the authoritative worker update and activation lifecycle", () => {
  const hook = read("src/hooks/use-scramjet.ts")

  assert.match(hook, /type:\s*["']classic["']/)
  assert.match(hook, /updateViaCache:\s*["']none["']/)
  assert.match(hook, /await reg\.update\(\)/)
  assert.match(hook, /navigator\.serviceWorker\.ready/)
  assert.match(hook, /reg\.installing \|\| reg\.waiting/)
  assert.doesNotMatch(hook, /void reg\.update\(\)/)
})

test("Synnical serves one root worker and unsandboxed Scramjet frames", () => {
  const hook = read("src/hooks/use-scramjet.ts")
  const panel = read("src/components/browser-panel.tsx")
  const config = read("next.config.js")

  assert.match(hook, /versionedAsset\(["']\/sw\.js["']\)/)
  assert.match(hook, /versionedAsset\(["']\/controller\/controller\.inject\.js["']\)/)
  assert.match(hook, /new LibcurlClient\(\{ websocket, wisp: websocket \}\)/)
  assert.match(hook, /\$\{proto\}:\/\/\$\{location\.host\}\/wisp\//)
  assert.doesNotMatch(panel, /setAttribute\(["']sandbox["']/)
  assert.match(config, /source:\s*["']\/sw\.js["'][\s\S]*no-cache, no-store, must-revalidate/)
})

test("Browser URL tracking uses Scramjet's real client lifecycle", () => {
  const panel = read("src/components/browser-panel.tsx")

  assert.match(panel, /frame\.hooks\.init\.post/)
  assert.match(panel, /context\?\.client\?\.url\?\.href/)
  assert.match(panel, /context\.client\.hooks\.lifecycle\.navigate/)
  assert.match(panel, /hashchange/)
  assert.doesNotMatch(panel, /frame\.hooks\.init\.pre/)
})

test("Browser resolves relative anchors against the upstream page and rejects placeholder routes", () => {
  const panel = read("src/components/browser-panel.tsx")

  assert.match(panel, /safeHttpNavigationUrl\(rawHref, currentUrl\)/)
  assert.match(panel, /scramjet-attr-href/)
  assert.match(panel, /live\.frame\.go\(destination\)/)
  assert.match(panel, /TRAILING_PLACEHOLDER_PATH/)
  assert.match(panel, /stopImmediatePropagation/)
})

test("Browser always launches fresh instead of restoring the last website", () => {
  const panel = read("src/components/browser-panel.tsx")
  const route = read("src/app/api/features/browser/route.ts")

  assert.doesNotMatch(panel, /state\.session\?\.tabs/)
  assert.doesNotMatch(panel, /browser\.action\("save-session"/)
  assert.match(route, /session: null/)
  assert.match(route, /setPreference\(me\.id, "browser\.session", null\)/)
})

test("Browser history traversal stays inside the Scramjet frame", () => {
  const panel = read("src/components/browser-panel.tsx")

  assert.match(panel, /navigationHistoryRef/)
  assert.match(panel, /navigation\.index = nextIndex/)
  assert.match(panel, /frame\.go\(target\)/)
  assert.match(panel, /disabled=\{!canGoBack\}/)
  assert.match(panel, /disabled=\{!canGoForward\}/)
  assert.doesNotMatch(panel, /active\.frame\?\.back\(\)/)
  assert.doesNotMatch(panel, /active\.frame\?\.forward\(\)/)
})
