import type { Role } from "@/lib/constants"

/**
 * HEAD_ADMIN is a legacy recovered database value only. New assignments never
 * create it; permission checks and public user data treat it exactly as ADMIN.
 */
export const STAFF_ROLES = ["OWNER", "ADMIN", "MOD"] as const
export const ASSIGNABLE_ROLES: Role[] = ["ADMIN", "MOD", "MEMBER"]

export function canonicalRole(role: string): Exclude<Role, "HEAD_ADMIN"> {
  return role === "OWNER" ? "OWNER"
    : role === "ADMIN" || role === "HEAD_ADMIN" ? "ADMIN"
    : role === "MOD" ? "MOD"
    : "MEMBER"
}

export function roleRank(role: string): number {
  const normalized = canonicalRole(role)
  return normalized === "OWNER" ? 3 : normalized === "ADMIN" ? 2 : normalized === "MOD" ? 1 : 0
}

export function isStaffRole(role: string): boolean {
  return roleRank(role) >= roleRank("MOD")
}

export function canModerateTarget(actorRole: string, targetRole: string): boolean {
  return roleRank(actorRole) > roleRank(targetRole)
}

export function canAssignRole(actorRole: string, requestedRole: string): boolean {
  const actor = canonicalRole(actorRole)
  const requested = canonicalRole(requestedRole)
  if (requestedRole === "HEAD_ADMIN" || requested === "OWNER") return false
  if (actor === "OWNER") return requested === "ADMIN" || requested === "MOD" || requested === "MEMBER"
  if (actor === "ADMIN") return requested === "MOD" || requested === "MEMBER"
  return false
}
