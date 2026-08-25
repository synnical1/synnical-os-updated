import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { privacyViewFor } from "@/lib/privacy"
import { friendshipLevel, friendshipPairKey } from "@/lib/friendship-social"

// GET /api/friends/list — returns accepted friends with real graph metadata,
// plus incoming/outgoing requests. Private friend notes are returned only to
// their owner; mutual counts come from the accepted friendship graph.
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [accepted, pending] = await Promise.all([
    db.friendship.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { receiverId: me.id }] },
      include: { requester: true, receiver: true },
    }),
    db.friendship.findMany({
      where: { status: "PENDING", OR: [{ requesterId: me.id }, { receiverId: me.id }] },
      include: { requester: true, receiver: true },
    }),
  ])

  const friendUsers = accepted.map((f) => (f.requesterId === me.id ? f.receiver : f.requester))
  const friendIds = friendUsers.map((u) => u.id)
  const people = [me.id, ...friendIds]

  const metas = friendIds.length
    ? await db.friendMeta.findMany({ where: { userId: me.id, friendId: { in: friendIds } } })
    : []
  const pairKeys = friendIds.map((friendId) => friendshipPairKey(me.id, friendId))
  const bonds = pairKeys.length
    ? await db.friendshipBond.findMany({ where: { pairKey: { in: pairKeys } } })
    : []
  const graph = people.length > 1
    ? await db.friendship.findMany({
        where: {
          status: "ACCEPTED",
          OR: [{ requesterId: { in: people } }, { receiverId: { in: people } }],
        },
        select: { requesterId: true, receiverId: true },
      })
    : []

  const metaByFriend = new Map<string, (typeof metas)[number]>(metas.map((m) => [m.friendId, m] as const))
  const bondByPair = new Map<string, (typeof bonds)[number]>(bonds.map((bond) => [bond.pairKey, bond] as const))
  const neighbors = new Map<string, Set<string>>()
  const addNeighbor = (a: string, b: string) => {
    const set = neighbors.get(a) || new Set<string>()
    set.add(b)
    neighbors.set(a, set)
  }
  for (const edge of graph) {
    addNeighbor(edge.requesterId, edge.receiverId)
    addNeighbor(edge.receiverId, edge.requesterId)
  }
  const mine = neighbors.get(me.id) || new Set<string>()

  const friends = await Promise.all(friendUsers.map(async (u) => {
    const theirs = neighbors.get(u.id) || new Set<string>()
    let mutualCount = 0
    for (const candidate of mine) {
      if (candidate !== u.id && candidate !== me.id && theirs.has(candidate)) mutualCount += 1
    }
    const meta = metaByFriend.get(u.id)
    const view = await privacyViewFor(u.id, me.id)
    const birthdayVisible = view.birthday && (u.birthdayVisibility === "everyone" || u.birthdayVisibility === "friends")
    const safe = toSafeUser(u)
    return {
      ...(view.profile ? safe : { ...safe, bio: "", status: "", bannerUrl: null, bannerIsGif: false, profileEffect: null }),
      mutualCount,
      birthday: birthdayVisible ? u.birthday : null,
      friendMeta: {
        nickname: meta?.nickname || "",
        note: meta?.note || "",
        closeFriend: Boolean(meta?.closeFriend),
        favorite: Boolean(meta?.favorite),
        label: meta?.label || "",
      },
      bondSummary: (() => {
        const bond = bondByPair.get(friendshipPairKey(me.id, u.id))
        return bond ? { level: friendshipLevel(bond.xp), xp: bond.xp, duoName: bond.duoName, title: bond.title, lastInteractionAt: bond.lastInteractionAt } : null
      })(),
    }
  }))

  const incoming = pending.filter((f) => f.receiverId === me.id).map((f) => toSafeUser(f.requester))
  const outgoing = pending.filter((f) => f.requesterId === me.id).map((f) => toSafeUser(f.receiver))

  return NextResponse.json({ friends, incoming, outgoing })
}
