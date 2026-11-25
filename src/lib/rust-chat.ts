import "server-only"

import { NextRequest, NextResponse } from "next/server"

const RUST_CHAT_ORIGIN = process.env.SYNNICAL_RUST_CHAT_URL || "http://127.0.0.1:4401"

export async function forwardRustChat(path: string, request: NextRequest): Promise<NextResponse> {
  const url = new URL(path, RUST_CHAT_ORIGIN)
  url.search = request.nextUrl.search

  const headers = new Headers()
  const cookie = request.headers.get("cookie")
  const authorization = request.headers.get("authorization")
  if (cookie) headers.set("cookie", cookie)
  if (authorization) headers.set("authorization", authorization)

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(3_500),
    })
    const raw = await upstream.text()
    let payload: unknown
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      payload = { error: "The Rust chat service returned an invalid response." }
    }
    return NextResponse.json(payload, {
      status: upstream.status,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    console.error("[rust-chat] upstream unavailable:", error instanceof Error ? error.message : String(error))
    return NextResponse.json(
      { error: "The Rust chat service is unavailable. Check the synnical-rust-chat process." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    )
  }
}
