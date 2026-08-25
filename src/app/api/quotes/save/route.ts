import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateTextContent } from "@/lib/content-moderation"
import { moderationPublicError, recordModerationBlock } from "@/lib/moderation-enforcement"

// POST /api/quotes/save — save a message as a quote card
// body: { authorName, authorPfp?, content }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { authorName, authorPfp, content } = await req.json()
  if (typeof authorName !== "string" || typeof content !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  if (authorName.trim().length < 1 || authorName.length > 32) {
    return NextResponse.json({ error: "Invalid author name" }, { status: 400 })
  }
  if (content.length === 0 || content.length > 2000) {
    return NextResponse.json({ error: "Invalid content length" }, { status: 400 })
  }
  const moderation = await moderateTextContent({ content: `${authorName}: ${content}`, surface: "profile" })
  if (moderation.decision !== "allow") {
    await recordModerationBlock(me.id, moderation)
    return NextResponse.json(moderationPublicError({ ...moderation, decision: "block" }), {
      status: moderation.code === "MODERATION_UNAVAILABLE" ? 503 : 422,
    })
  }
  const safeAuthorPfp = typeof authorPfp === "string" && /^\/api\/uploads\/[a-zA-Z0-9._-]+(?:\?v=\d+)?$/.test(authorPfp)
    ? authorPfp
    : null
  const quote = await db.quote.create({
    data: { saverId: me.id, authorName: authorName.trim(), authorPfp: safeAuthorPfp, content },
  })
  return NextResponse.json({ ok: true, quote })
}
