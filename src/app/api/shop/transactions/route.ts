import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { db } from "@/lib/db"

// GET /api/shop/transactions — returns the user's transaction history
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const transactions = await db.currencyTransaction.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  })

  return NextResponse.json({
    transactions: transactions.map((t) => ({
      id: t.id,
      amount: t.amount,
      type: t.type,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  })
}
