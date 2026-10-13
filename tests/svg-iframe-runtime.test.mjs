import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("SVG iframe auth requests are explicitly marked by the client", () => {
  const api = read("src/lib/api.ts")
  assert.match(api, /window\.self !== window\.top/)
  assert.match(api, /synnicalClient/)
  assert.match(api, /X-Synnical-Client/)
  assert.match(api, /svgClientRequestHeaders/)
})

test("SVG iframe sessions use secure partitioned cookies without changing normal sessions", () => {
  const auth = read("src/lib/auth-server.ts")
  assert.match(auth, /isSvgEmbedRequest/)
  assert.match(auth, /sameSite: svgEmbed && secure \? "none" : "lax"/)
  assert.match(auth, /partitioned: true/)
  assert.match(auth, /page\.searchParams\.get\("synnicalClient"\) === "svg"/)
  assert.match(auth, /await clearSessionCookie\(store\)/)
})

test("Chat and proxy backends continue accepting the shared session cookie", () => {
  const chat = read("src/lib/chat-server.ts")
  const auth = read("src/lib/server-request-auth.ts")
  assert.match(chat, /readCookie\(socket\.handshake\.headers\.cookie\)/)
  assert.match(chat, /socket\.handshake\.auth\?\.token/)
  assert.match(auth, /const token = bearer \|\| cookie/)
})
