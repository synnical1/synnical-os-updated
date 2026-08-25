// App-wide constants.
//
// SECURITY: the owner password used to live here as a literal, which meant it
// was committed to the repo AND bundled into any file that imported it. It now
// comes from the environment; set OWNER_PASSWORD in .env on the server.
export const OWNER_PASSWORD = process.env.OWNER_PASSWORD || ""
// Session lasts 1 year so users stay logged in across visits.
export const SESSION_COOKIE = "stratus_session"
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365

// Chat mini-service port (socket.io) — sandbox dev mode.
export const CHAT_SERVICE_PORT = 3001

// Upload directory.
//
// Always resolve to an ABSOLUTE path. A relative "./uploads" is interpreted
// against the process working directory, which under PM2/systemd is often not
// the project root — uploads then landed in one folder and were served from
// another, so freshly uploaded avatars 404'd.
//
// uploadsDir() has been moved to src/lib/uploads.ts (server-only) so that this
// file stays client-safe (no `path` import).
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads"

// Roles
export type Role = "OWNER" | "HEAD_ADMIN" | "ADMIN" | "MOD" | "MEMBER"
export const ROLES: Role[] = ["OWNER", "HEAD_ADMIN", "ADMIN", "MOD", "MEMBER"]

// Legacy compatibility only. Selectable avatar animations were retired.
export const AVATAR_DECOS = [
  { id: "none", name: "None" },
] as const

// Auto-punishment thresholds (configurable)
export const AUTO_PUNISHMENTS = {
  WARN_THRESHOLD_1H_MUTE: 3,    // 3 warns → 1h mute
  WARN_THRESHOLD_24H_MUTE: 5,   // 5 warns → 24h mute
  WARN_THRESHOLD_PERM_BAN: 7,   // 7 warns → permanent ban
}

// Trusted user requirements
export const TRUSTED_REQUIREMENTS = {
  MIN_ACCOUNT_AGE_DAYS: 7,
  MIN_MESSAGES: 1000,
  NO_INFRACTION_DAYS: 30, // no infractions in last 30 days
}

