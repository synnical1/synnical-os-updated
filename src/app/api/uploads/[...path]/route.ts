import { NextRequest } from "next/server"
import { uploadsDir } from "@/lib/uploads"
import { serveUpload } from "@/lib/upload-serving"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return serveUpload(uploadsDir(), (await params).path, req)
}

export const HEAD = GET
