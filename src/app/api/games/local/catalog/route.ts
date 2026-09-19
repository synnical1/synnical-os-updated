import { NextResponse } from "next/server"
import { getLocalGameCatalog } from "@/lib/local-games"

export const dynamic = "force-dynamic"

export async function GET() {
  const catalog = await getLocalGameCatalog()
  return NextResponse.json(catalog, {
    headers: {
      "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    },
  })
}
