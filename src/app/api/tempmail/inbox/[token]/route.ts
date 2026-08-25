import { NextRequest, NextResponse } from "next/server"

// ---------------------------------------------------------------------------
// Temp-mail inbox — powered by mail.tm / mail.gw API
// ---------------------------------------------------------------------------
//
//   GET /api/tempmail/inbox/<token>
//
// The <token> is the JWT from mail.tm or mail.gw (returned by /api/tempmail/session).
// Uses it as a Bearer token to fetch:
//   GET  https://api.mail.tm/messages       → list of message summaries
//   GET  https://api.mail.tm/messages/{id}  → full message with body
//
// Returns an array of { from, to, subject, body, date }.

const MAIL_PROVIDERS = ["https://api.mail.tm", "https://api.mail.gw"]
const TIMEOUT_MS = 15_000

export const dynamic = "force-dynamic"
export const revalidate = 0

// JWT tokens can be very long (200+ chars). Allow up to 4096.
const TOKEN_RE = /^[A-Za-z0-9_.-]{8,4096}$/

interface MailMessage {
  id: string
  from: { address: string; name?: string }
  to: { address: string; name?: string }[]
  subject: string
  intro?: string
  seen?: boolean
  createdAt: string
}

interface MailMessageDetail extends MailMessage {
  text?: string
  html?: string[]
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || !TOKEN_RE.test(token)) {
    return NextResponse.json(
      { error: "Invalid session token." },
      { status: 400 },
    )
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  // Try each provider until one works
  for (const base of MAIL_PROVIDERS) {
    try {
      // 1. Fetch the message list
      const listRes = await fetch(`${base}/messages`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: ctrl.signal,
        cache: "no-store",
      })

      if (!listRes.ok) {
        // 401 = token not valid for this provider, try next
        if (listRes.status === 401) continue
        const txt = await listRes.text().catch(() => listRes.statusText)
        return NextResponse.json(
          { error: `Mail provider returned ${listRes.status}: ${txt.slice(0, 200)}` },
          { status: listRes.status },
        )
      }

      const listData = await listRes.json()
      const messages: MailMessage[] = listData?.hydra?.member || listData?.member || []

      if (messages.length === 0) {
        return NextResponse.json(
          { emails: [] },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          },
        )
      }

      // 2. Fetch full message details (including body) for each message
      const detailed = await Promise.all(
        messages.slice(0, 20).map(async (msg): Promise<{
          from: string
          to: string
          subject: string
          body: string
          date: number
        } | null> => {
          try {
            const detailRes = await fetch(`${base}/messages/${msg.id}`, {
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
              signal: ctrl.signal,
              cache: "no-store",
            })
            if (!detailRes.ok) return null
            const detail: MailMessageDetail = await detailRes.json()
            return {
              from: msg.from?.name
                ? `${msg.from.name} <${msg.from.address}>`
                : msg.from?.address || "unknown",
              to: (msg.to || []).map((t) => t.address).join(", "),
              subject: msg.subject || "(no subject)",
              body: detail.text || detail.intro || "",
              date: new Date(msg.createdAt).getTime(),
            }
          } catch {
            return null
          }
        }),
      )

      const emails = detailed.filter((e): e is NonNullable<typeof e> => e !== null)

      return NextResponse.json(
        { emails },
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

  clearTimeout(timer)
  return NextResponse.json(
    { error: "Failed to fetch inbox from any provider. Your session may have expired." },
    { status: 502 },
  )
}
