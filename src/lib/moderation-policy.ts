/** Staff content is still blocked and audited, but automated moderation never destroys staff access. */
export function isAutomaticBanExemptRole(role: unknown): boolean {
  return role === "OWNER" || role === "HEAD_ADMIN" || role === "ADMIN" || role === "MOD"
}
