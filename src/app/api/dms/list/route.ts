import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { isDmSendBlocked } from "@/lib/blocks"

// GET /api/dms/list — list DM channels for current user (with the other member's info)
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const memberships = await db.membership.findMany({
    where: { userId: me.id, channel: { OR: [{ isDM: true }, { isGroup: true }] } },
    include: {
      channel: {
        include: {
          memberships: { include: { user: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: { channel: { createdAt: "desc" } },
  })

  const dms = memberships
    .filter((m) => m.channel.isDM)
    .map((m) => {
      const other = m.channel.memberships.find((mm) => mm.userId !== me.id)
      return {
        id: m.channel.id,
        other: other ? toSafeUser(other.user) : null,
        lastMessage: m.channel.messages[0] || null,
      }
    })
    .filter((d) => d.other)

  const groups = memberships
    .filter((m) => m.channel.isGroup)
    .map((m) => ({
      id: m.channel.id,
      name: m.channel.name.replace(/^group-/, "").replace(/-[a-z0-9]+$/, ""),
      members: m.channel.memberships.map((mm) => toSafeUser(mm.user)),
      lastMessage: m.channel.messages[0] || null,
    }))

  return NextResponse.json({ dms, groups })
}

// POST /api/dms — create or get a DM channel with a user
// body: { userId }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId } = await req.json()
  if (typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }
  const other = await db.user.findUnique({ where: { id: userId } })
  if (!other) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (other.id === me.id) return NextResponse.json({ error: "Can't DM yourself" }, { status: 400 })
  if (await isDmSendBlocked(me.id, other.id)) return NextResponse.json({ error: "Direct messages are blocked between these accounts" }, { status: 403 })

  // Find existing DM channel between these two users
  const myDMs = await db.membership.findMany({
    where: { userId: me.id, channel: { isDM: true } },
    include: { channel: { include: { memberships: true } } },
  })
  const existing = myDMs.find((m) =>
    m.channel.memberships.some((mm) => mm.userId === other.id)
  )

  if (existing) {
    return NextResponse.json({ id: existing.channelId, other: toSafeUser(other) })
  }

  // Create new DM channel
  const name = `dm_${[me.id, other.id].sort().join("_")}`
  const channel = await db.channel.create({ data: { name, isDM: true } })
  await db.membership.createMany({
    data: [
      { userId: me.id, channelId: channel.id },
      { userId: other.id, channelId: channel.id },
    ],
  })
  return NextResponse.json({ id: channel.id, other: toSafeUser(other) })
}
