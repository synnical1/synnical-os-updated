import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const read = (path) => fs.readFileSync(path, "utf8")
const pkg = JSON.parse(read("package.json"))

test("main batch clean install can build and start the custom Synnical server", () => {
  assert.equal(pkg.scripts.prebuild, "prisma generate")
  assert.equal(pkg.scripts.build, "next build")
  assert.equal(pkg.scripts.start, "NODE_ENV=production tsx server.ts")
  assert.equal(pkg.dependencies.tsx, "^4.23.11")
  assert.doesNotMatch(pkg.scripts.build, /\.next\/standalone|\bcp\b/)
  assert.doesNotMatch(pkg.scripts.start, /\bbun\b|\.next\/standalone/)
})

test("main batch exposes one focused dependency-backed preflight command", () => {
  assert.match(pkg.scripts.typecheck || "", /prisma generate/)
  assert.match(pkg.scripts.typecheck || "", /tsc --noEmit/)
  assert.match(pkg.scripts["test:main-batch"] || "", /regressions-20260820-main-batch/)
  assert.match(pkg.scripts["test:main-batch"] || "", /regressions-20260821-main-batch-packaging/)

  const preflight = pkg.scripts["preflight:main-batch"] || ""
  assert.match(preflight, /prisma validate/)
  assert.match(preflight, /typecheck/)
  assert.match(preflight, /test:main-batch/)
  assert.match(preflight, /npm run build/)
})

test("PM2 and npm start use the same checked-in TypeScript runtime", () => {
  const ecosystem = read("ecosystem.config.cjs")
  assert.match(ecosystem, /script:\s*"node_modules\/\.bin\/tsx"/)
  assert.match(ecosystem, /args:\s*"server\.ts"/)
  assert.match(pkg.scripts.start, /tsx server\.ts/)
})

test("both immutable SVG delivery origins can call credentialed APIs", () => {
  const server = read("server.ts")
  const authServer = read("src/lib/auth-server.ts")
  const login = read("src/app/api/auth/login/route.ts")
  const register = read("src/app/api/auth/register/route.ts")
  assert.match(server, /https:\/\/cdn\.jsdelivr\.net/)
  assert.match(server, /https:\/\/jsdelivr\.b-cdn\.net/)
  assert.match(server, /SYNNICAL_SVG_ALLOWED_ORIGINS\.has\(requestOrigin\)/)
  assert.match(server, /Access-Control-Allow-Origin", requestOrigin/)
  assert.match(server, /Access-Control-Allow-Credentials", "true"/)
  assert.match(server, /Access-Control-Allow-Headers", "Content-Type, Authorization, X-Synnical-Client, Range"/)
  assert.match(authServer, /headers\(\).*get\("authorization"\)/)
  assert.match(authServer, /\^Bearer\\s\+\(\[a-f0-9\]\{64\}\)\$/)
  assert.match(authServer, /isTrustedSvgClient/)
  assert.match(login, /isTrustedSvgClient\(req\) \? \{ token \} : \{\}/)
  assert.match(register, /isTrustedSvgClient\(req\) \? \{ token \} : \{\}/)
})
