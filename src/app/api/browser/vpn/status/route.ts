import "server-only"
import { NextResponse } from "next/server"
import { parseSocks5Url } from "@/lib/wisp-socks"

export const dynamic = "force-dynamic"

export async function GET() {
  const raw = process.env.SYNNICAL_NL_SOCKS5_URL?.trim() || ""
  let available = false
  if (raw) {
    try {
      parseSocks5Url(raw)
      available = true
    } catch {
      available = false
    }
  }
  return NextResponse.json({
    countries: {
      direct: { available: true },
      netherlands: { available },
    },
  }, { headers: { "Cache-Control": "no-store" } })
}
