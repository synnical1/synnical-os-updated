import "server-only"
import { db } from "@/lib/db"

export type DmSafetyNotice = {
  code: "DM_MANIPULATION_WARNING"
  summary: string
  tactics: string[]
  messageId: string | null
}

type Rule = { label: string; pattern: RegExp; weight: number }

const RULES: Rule[] = [
  { label: "secrecy or isolation", pattern: /\b(don'?t tell|keep (?:this|it) (?:a )?secret|between (?:you and me|us)|your parents (?:don'?t|won'?t) understand)\b/i, weight: 2 },
  { label: "age or school probing", pattern: /\b(how old are you|what age are you|what school (?:do you|are you)|where do you go to school|what grade are you in)\b/i, weight: 2 },
  { label: "moving off-platform", pattern: /\b(add me on|message me on|move to|talk on)\s+(snap(?:chat)?|telegram|whats?app|signal|instagram|insta)\b/i, weight: 1 },
  { label: "image solicitation", pattern: /\b(send|show|give) (?:me )?(?:a |your )?(?:pic|pics|picture|photo|selfie|image)\b/i, weight: 2 },
  { label: "pressure or leverage", pattern: /\b(if you (?:really )?(?:trust|like|love) me|prove (?:that )?you trust me|you owe me|if you don'?t .{0,40}(?:i'?ll|I will))\b/i, weight: 2 },
  { label: "gift or money leverage", pattern: /\b(i'?ll (?:buy|give|send) you .{0,30} if you|gift card|send you money if)\b/i, weight: 1 },
  { label: "relationship isolation", pattern: /\b(i'?m the only one who understands|you only need me|don'?t listen to (?:your )?(?:parents|friends|family))\b/i, weight: 2 },
]

export function detectManipulation(messages: Array<{ id: string; content: string; userId: string | null }>, viewerId: string): DmSafetyNotice | null {
  let score = 0
  const tactics = new Set<string>()
  let trigger: string | null = null

  for (const message of messages.slice(-30)) {
    if (!message.content || message.userId === viewerId) continue
    for (const rule of RULES) {
      if (rule.pattern.test(message.content)) {
        score += rule.weight
        tactics.add(rule.label)
        trigger = message.id
      }
    }
  }
  const highRiskPair = tactics.has("age or school probing") && (tactics.has("image solicitation") || tactics.has("secrecy or isolation"))
  if (score < 3 && !highRiskPair) return null
  return {
    code: "DM_MANIPULATION_WARNING",
    summary: "This DM is matching patterns commonly used to pressure, isolate, or move someone into a less safe conversation. You can block the person or report the triggering message.",
    tactics: [...tactics],
    messageId: trigger,
  }
}

export async function getDmSafetyNotice(channelId: string, viewerId: string): Promise<DmSafetyNotice | null> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    include: { memberships: { select: { userId: true } } },
  })
  if (!channel?.isDM || !channel.memberships.some((m) => m.userId === viewerId)) return null
  const messages = await db.message.findMany({
    where: { channelId, deleted: false },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, content: true, userId: true },
  })
  return detectManipulation(messages.reverse(), viewerId)
}
