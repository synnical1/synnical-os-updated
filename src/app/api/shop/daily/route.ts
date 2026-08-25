import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { claimDaily } from "@/lib/shop"

// POST /api/shop/daily — claim daily coin reward
export async function POST() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const result = await claimDaily(me.id)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Daily claim failed" }, { status: 500 })
  }
}
