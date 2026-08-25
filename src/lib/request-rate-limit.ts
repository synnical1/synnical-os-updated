import type { NextRequest } from "next/server"

type WindowStore = Map<string, number[]>
const runtime = globalThis as typeof globalThis & { __synnicalRateWindows?: WindowStore }
const windows = runtime.__synnicalRateWindows || new Map<string, number[]>()
runtime.__synnicalRateWindows = windows

function requestIdentity(req: NextRequest): string {
  return (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown")
    .trim()
    .slice(0, 80)
}

export function consumeRequestLimit(
  req: NextRequest,
  bucket: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const cutoff = now - windowMs
  const key = `${bucket}:${requestIdentity(req)}`
  const recent = (windows.get(key) || []).filter((time) => time > cutoff)

  if (recent.length >= limit) {
    windows.set(key, recent)
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1_000)) }
  }

  recent.push(now)
  windows.set(key, recent)
  if (windows.size > 10_000) {
    for (const [storedKey, times] of windows) {
      if (!times.some((time) => time > cutoff)) windows.delete(storedKey)
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}
