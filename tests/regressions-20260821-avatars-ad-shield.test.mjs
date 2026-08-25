import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")

test("SynnFlix keeps 100 stable avatar ids and renders the cinematic sprite atlas", () => {
  const profiles = read("src/lib/synnflix-profiles.ts")
  const panel = read("src/components/synnflix-panel.tsx")
  assert.match(profiles, /Array\.from\(\{ length: 100 \}/)
  assert.match(profiles, /profile-atlas-v1\.webp/)
  assert.doesNotMatch(profiles, /🐼|🦊|PROFILE_EMOJI/)
  assert.match(panel, /backgroundSize: "1000% 1000%"/)
  assert.match(panel, /avatar\.column \* \(100 \/ 9\)/)
})

test("OS-wide ad blocking is wired back into the browser and root layout", () => {
  const browser = read("src/components/browser-panel.tsx")
  const settings = read("src/components/settings-extra-sections.tsx")
  const layout = read("src/app/layout.tsx")
  assert.match(browser, /shouldBlockProxyAdRequest/)
  assert.match(browser, /frame\.hooks\.fetch\.intercept/)
  assert.match(browser, /ads\.enabled/)
  assert.match(settings, /ads\.enabled/)
  assert.match(settings, /Ad Blocking/)
  assert.match(layout, /AdInjector/)
  assert.match(browser, /synnical-popup-guard/)
  assert.match(browser, /Object\.defineProperty\(proxiedWindow, "open"/)
})

test("SynnFlix persists progress when its desktop window unmounts", () => {
  const panel = read("src/components/synnflix-panel.tsx")
  assert.match(panel, /flushPlaybackProgressRef\.current = flushPlaybackProgress/)
  assert.match(panel, /flushPlaybackProgressRef\.current\("close"\)/)
  assert.match(panel, /keepalive: true/)
  assert.match(panel, /buildPlayerUrl\(player, activeProfile\.id, \{ progress: syncedProgress, autoplay: true \}\)/)
  assert.match(panel, /params\.set\("progress", String\(progress\)\)/)
})

test("Scramjet proves its worker route before Ready and recovers lost controller ports", () => {
  const hook = read("src/hooks/use-scramjet.ts")
  const browser = read("src/components/browser-panel.tsx")
  const worker = read("public/sw.js")
  assert.match(hook, /ensureScramjetControllerRoute\(controller\)/)
  assert.match(hook, /\$synnical\$controllerRouteProbe/)
  assert.match(hook, /controller\.setupMessagePort\(\)/)
  assert.match(browser, /await ensureScramjetControllerRoute\(controller\)/)
  assert.match(browser, /if \(routeRecovered\)/)
  assert.match(browser, /location\.href === "about:blank"/)
  assert.match(worker, /recoverAndRoute\(event\)/)
  assert.match(worker, /\$controller\$swrevive/)
  assert.match(worker, /status: 503/)
})
