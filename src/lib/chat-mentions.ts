/** Token boundaries exclude email addresses and partial usernames. Resolution is server-side. */
export function mentionNames(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|[^\p{L}\p{N}_@])@([a-zA-Z0-9_]{1,32})(?![\p{L}\p{N}_@])/gu)].map(match => match[1].toLowerCase()))].slice(0, 30)
}
export function parseMentionIds(value: string | null | undefined): string[] {
  try { const ids: unknown = JSON.parse(value || "[]"); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [] } catch { return [] }
}
export function messageNotification(message: { userId?: string | null; mentionedUserIds?: string[] }, viewerId: string) {
  return message.userId !== viewerId && Boolean(message.userId) && Boolean(message.mentionedUserIds?.includes(viewerId))
}
