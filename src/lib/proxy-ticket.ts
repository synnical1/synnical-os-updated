import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

const TICKET_TTL_MS = 90_000

type ProxyTicketPayload = {
  sid: string
  exp: number
}

function signingSecret() {
  const secret = process.env.IDENTITY_HASH_SECRET?.trim()
  if (secret) return secret
  if (process.env.NODE_ENV === "production") throw new Error("IDENTITY_HASH_SECRET is required for proxy tickets")
  return "synnical-development-proxy-ticket-secret"
}

function sign(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url")
}

export function issueProxyTicket(sessionId: string) {
  const payload: ProxyTicketPayload = { sid: sessionId, exp: Date.now() + TICKET_TTL_MS }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return {
    ticket: `${encoded}.${sign(encoded)}`,
    expiresAt: payload.exp,
  }
}

export function verifyProxyTicket(ticket: string | null | undefined): ProxyTicketPayload | null {
  if (!ticket || ticket.length > 1024) return null
  const [encoded, signature, extra] = ticket.split(".")
  if (!encoded || !signature || extra) return null

  const expected = Buffer.from(sign(encoded))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<ProxyTicketPayload>
    if (typeof payload.sid !== "string" || !payload.sid || typeof payload.exp !== "number") return null
    if (payload.exp <= Date.now() || payload.exp > Date.now() + TICKET_TTL_MS + 5_000) return null
    return { sid: payload.sid, exp: payload.exp }
  } catch {
    return null
  }
}
