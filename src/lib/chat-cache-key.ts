/** Private history must never be shared by accounts on the same browser. */
export function chatHistoryCacheKey(accountId: string, channelId: string): string {
  return `synnical-chat-messages:${encodeURIComponent(accountId)}:${encodeURIComponent(channelId)}`
}
