import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("local games run without same-origin privileges", () => {
  const panel = read("src/components/games-panel.tsx")
  assert.match(panel, /sandbox="allow-scripts allow-pointer-lock allow-downloads allow-forms allow-modals"/)
  assert.doesNotMatch(panel, /sandbox="[^"]*allow-same-origin/)
  assert.match(panel, /\/api\/games\/local\/catalog/)
})

test("local game file route blocks traversal and uses a restrictive CSP", () => {
  const route = read("src/app/api/games/local/play/[slug]/[...path]/route.ts")
  assert.match(route, /part === "\.\."/)
  assert.match(route, /candidate !== root/)
  assert.match(route, /object-src 'none'/)
  assert.match(route, /form-action 'none'/)
  assert.match(route, /X-Content-Type-Options/)
})

test("third-party local games are explicit allowlist imports", () => {
  const config = JSON.parse(read("config/local-games-approved.json"))
  const importer = read("scripts/import-gmshelf-games.mjs")
  assert.equal(config.repos["gmshelf/ugs"].expectedManifestGames, 1512)
  assert.equal(config.repos["gmshelf/ckv"].expectedManifestGames, 849)
  assert.ok(Object.keys(config.approved).length >= 1)
  assert.match(importer, /config\.approved/)
  assert.match(importer, /Repository is not approved/)
  assert.match(importer, /SYNNICAL-UPSTREAM-LICENSE\.txt/)
  assert.doesNotMatch(importer, /Object\.keys\(config\.repos\).*cp/s)
})

test("local game storage is persistent and outside the source checkout by default", () => {
  const lib = read("src/lib/local-games.ts")
  const env = read(".env.example")
  const deploy = read("DEPLOY-ORACLE-ARM64.md")
  assert.match(lib, /\/var\/lib\/synnical\/games/)
  assert.match(env, /GAMES_DIR=\/var\/lib\/synnical\/games/)
  assert.match(deploy, /npm run games:import/)
})
