import { NextRequest, NextResponse } from "next/server"
import { authenticateDeveloperRequest } from "@/lib/developer-auth"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authenticateDeveloperRequest(req, "read:profile")
  if (!auth) return NextResponse.json({ error: "Invalid token or missing read:profile permission" }, { status: 401 })
  const { user } = auth
  return NextResponse.json({
    account: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      pfpUrl: user.pfpUrl,
      bannerUrl: user.bannerUrl,
      role: user.role,
      createdAt: user.createdAt,
    },
  }, { headers: { "Cache-Control": "private, no-store" } })
}
