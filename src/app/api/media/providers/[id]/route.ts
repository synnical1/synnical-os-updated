import { NextResponse } from "next/server"
export const dynamic = "force-dynamic"
/** No network probes or legacy provider URLs are exposed by this retired route. */
export async function GET() { return NextResponse.json({ error: "Website playback providers have been retired", available: false }, { status: 410, headers: { "Cache-Control": "no-store" } }) }
