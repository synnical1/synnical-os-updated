import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("SVG runtime marks API requests and stores bearer sessions", () => {
  const source = read("src/lib/svg-client.ts")
  assert.match(source, /synnicalClient/)
  assert.match(source, /X-Synnical-Client/)
  assert.match(source, /Authorization/)
  assert.match(source, /Bearer/)
  assert.match(source, /localStorage\.setItem\(SVG_SESSION_KEY/)
  assert.match(source, /target\.pathname\.startsWith\("\/api\/"\)/)
})

test("SVG auth bootstraps and persists tokens from me/login/register", () => {
  const api = read("src/lib/api.ts")
  const auth = read("src/hooks/use-auth.tsx")
  const me = read("src/app/api/auth/me/route.ts")
  const serverAuth = read("src/lib/auth-server.ts")

  assert.match(api, /user: SafeUser \| null; token\?: string/)
  assert.match(api, /user: SafeUser; token\?: string/)
  assert.match(auth, /if \(result\.token\) setSvgSessionToken\(result\.token\)/)
  assert.match(auth, /clearSvgSessionToken\(\)/)
  assert.match(me, /isTrustedSvgClient\(req\)/)
  assert.match(me, /token: session\.token/)
  assert.match(serverAuth, /refererUrl\.searchParams\.get\("synnicalClient"\) === "svg"/)
})

test("SVG session recovery bridges a first-party session into the embedded runtime", () => {
  const client = read("src/lib/svg-client.ts")
  const handoff = read("src/app/api/auth/svg-handoff/route.ts")

  assert.match(client, /window\.open\(/)
  assert.match(client, /\/api\/auth\/svg-handoff\?synnicalClient=svg/)
  assert.match(client, /window\.addEventListener\("message"/)
  assert.match(client, /event\.origin !== window\.location\.origin/)
  assert.match(client, /requestStorageAccess/)
  assert.match(client, /window\.location\.reload\(\)/)

  assert.match(handoff, /getCurrentSession/)
  assert.match(handoff, /window\.opener\.postMessage/)
  assert.match(handoff, /window\.location\.origin/)
  assert.match(handoff, /Cache-Control/)
  assert.match(handoff, /frame-ancestors 'none'/)
})

test("SVG Chat passes bearer session through Socket.IO handshake auth", () => {
  const realtime = read("src/lib/chat-realtime.ts")
  const server = read("src/lib/chat-server.ts")
  assert.match(realtime, /getSvgSessionToken/)
  assert.match(realtime, /auth: token \? \{ token \} : undefined/)
  assert.match(server, /socket\.handshake\.auth\?\.token/)
})

test("SVG Browser uses signed short-lived Wisp tickets", () => {
  const ticket = read("src/lib/proxy-ticket.ts")
  const route = read("src/app/api/proxy/ticket/route.ts")
  const realtime = read("src/hooks/use-scramjet.ts")
  const requestAuth = read("src/lib/server-request-auth.ts")
  const server = read("server.ts")

  assert.match(ticket, /TICKET_TTL_MS = 90_000/)
  assert.match(ticket, /createHmac\("sha256"/)
  assert.match(ticket, /timingSafeEqual/)
  assert.match(route, /issueProxyTicket\(session\.id\)/)
  assert.match(realtime, /fetch\("\/api\/proxy\/ticket"/)
  assert.match(realtime, /url\.searchParams\.set\("ticket", body\.ticket\)/)
  assert.match(requestAuth, /verifyProxyTicket/)
  assert.match(requestAuth, /where: \{ id: ticket\.sid \}/)
  assert.match(requestAuth, /stripProxyTicketFromRequest/)
  assert.match(server, /stripProxyTicketFromRequest\(req\)/)
})

test("trusted SVG websocket origins remain authenticated, not open", () => {
  const requestAuth = read("src/lib/server-request-auth.ts")
  assert.match(requestAuth, /https:\/\/cdn\.jsdelivr\.net/)
  assert.match(requestAuth, /https:\/\/jsdelivr\.b-cdn\.net/)
  assert.match(requestAuth, /authenticatedProxyRequest/)
  assert.match(requestAuth, /session\.expiresAt\.getTime\(\) <= Date\.now\(\)/)
  assert.match(requestAuth, /isDeviceBanned\(req\.headers\.cookie, session\.deviceHash\)/)
})
