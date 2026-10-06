import { canonicalRole, canModerateTarget } from "./roles"
export type MessageRole = "OWNER" | "HEAD_ADMIN" | "ADMIN" | "MOD" | "MEMBER"

/**
 * One permission matrix shared by the browser UI, HTTP route and Socket.IO
 * server. Authors can always remove their own messages. Staff may only remove
 * messages below their role, except owners who can remove every message.
 */
export function canDeleteMessage(
  actorRole: MessageRole,
  actorId: string,
  targetRole: MessageRole | null | undefined,
  targetUserId: string | null | undefined,
): boolean {
  if (targetUserId && actorId === targetUserId) return true
  if (canonicalRole(actorRole) === "OWNER") return true
  if (!targetUserId || !targetRole) return false
  return canModerateTarget(actorRole, targetRole)
}
