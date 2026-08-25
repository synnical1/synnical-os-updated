import { NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Temp-mail session creation — powered by mail.tm API
// ---------------------------------------------------------------------------
//
// mail.tm API (https://docs.mail.tm):
//   Base URL: https://api.mail.tm
//   GET  /domains          → { hydra:member: [{ domain, ... }] }
//   POST /accounts         → create account { address, password }
//   POST /token            → { token: "JWT" }
//   GET  /messages         → list messages (Bearer auth)
//   GET  /messages/{id}    → message detail (Bearer auth)
//
// No API key required. mail.tm is generally more reliable than mail.gw.
// The browser never sees the upstream URL — every request is proxied through
// this Next.js route so credentials stay server-side.

const MAIL_API_BASE = "https://api.mail.tm"
const MAIL_GW_FALLBACK = "https://api.mail.gw"
const TIMEOUT_MS = 15_000

export const dynamic = "force-dynamic"
export const revalidate = 0

// In-memory cache of domains (refreshed every 10 minutes)
let cachedDomains: string[] = []
let domainsCacheTime = 0
const DOMAINS_CACHE_TTL = 10 * 60 * 1000

async function fetchDomains(): Promise<string[]> {
  if (cachedDomains.length > 0 && Date.now() - domainsCacheTime < DOMAINS_CACHE_TTL) {
    return cachedDomains
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    // Try mail.tm first, fall back to mail.gw
    for (const base of [MAIL_API_BASE, MAIL_GW_FALLBACK]) {
      try {
        const res = await fetch(`${base}/domains`, {
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
          cache: "no-store",
        })
        if (!res.ok) continue
        const data = await res.json()
        const domains = (data?.hydra?.member || data?.member || data || [])
          .filter((d: any) => typeof d?.domain === "string" && d.domain.length > 0)
          .map((d: any) => d.domain)
        if (domains.length > 0) {
          cachedDomains = domains
          domainsCacheTime = Date.now()
          return domains
        }
      } catch {
        continue
      }
    }
    throw new Error("No mail domains available from any provider")
  } finally {
    clearTimeout(timer)
  }
}

function randomString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

export async function GET() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS * 2)
  try {
    // 1. Get available domains
    const domains = await fetchDomains()
    const domain = domains[Math.floor(Math.random() * domains.length)]

    // 2. Create a random account
    const username = `s${randomString(10)}`
    const address = `${username}@${domain}`
    const password = randomString(16)

    // Try mail.tm first, then mail.gw
    for (const base of [MAIL_API_BASE, MAIL_GW_FALLBACK]) {
      try {
        const accountRes = await fetch(`${base}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ address, password }),
          signal: ctrl.signal,
          cache: "no-store",
        })

        if (!accountRes.ok) {
          const txt = await accountRes.text().catch(() => accountRes.statusText)
          // Try next provider
          if (accountRes.status === 422 || accountRes.status === 400) continue
          return NextResponse.json(
            { error: `Failed to create account (${accountRes.status}): ${txt.slice(0, 200)}` },
            { status: 502 },
          )
        }

        // 3. Get the JWT token
        const tokenRes = await fetch(`${base}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ address, password }),
          signal: ctrl.signal,
          cache: "no-store",
        })

        if (!tokenRes.ok) {
          const txt = await tokenRes.text().catch(() => tokenRes.statusText)
          return NextResponse.json(
            { error: `Failed to get token (${tokenRes.status}): ${txt.slice(0, 200)}` },
            { status: 502 },
          )
        }

        const tokenData = await tokenRes.json()
        const token = tokenData?.token
        if (typeof token !== "string" || !token) {
          return NextResponse.json(
            { error: "Invalid token response from mail provider" },
            { status: 502 },
          )
        }

        return NextResponse.json(
          { address, token, provider: base === MAIL_API_BASE ? "mail.tm" : "mail.gw" },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          },
        )
      } catch (e: any) {
        if (e?.name === "AbortError") break
        // Try next provider
        continue
      }
    }

    return NextResponse.json(
      { error: "All mail providers failed. Please try again in a moment." },
      { status: 502 },
    )
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return NextResponse.json(
        { error: "Mail provider request timed out. Please try again." },
        { status: 504 },
      )
    }
    return NextResponse.json(
      { error: `Failed to create temp-mail session: ${e?.message || String(e)}` },
      { status: 502 },
    )
  } finally {
    clearTimeout(timer)
  }
}
