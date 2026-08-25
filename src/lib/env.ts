// Environment variable validation — fails fast if missing required vars
function required(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`[env] Missing required environment variable: ${name}`)
    console.error(`[env] Set it in .env or your hosting platform's environment variables.`)
    process.exit(1)
  }
  return val
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback
}

// Validate environment on startup
export function validateEnv() {
  const isProduction = process.env.NODE_ENV === "production"

  // DATABASE_URL is always required
  const DATABASE_URL = required("DATABASE_URL")

  // In production with Turso, auth token is required
  const isTurso = DATABASE_URL.startsWith("libsql://") || DATABASE_URL.startsWith("https://")
  if (isProduction && isTurso) {
    required("DATABASE_AUTH_TOKEN")
  }

  // Socket URL — defaults to /socket.io
  const NEXT_PUBLIC_SOCKET_URL = optional("NEXT_PUBLIC_SOCKET_URL", "/socket.io")

  // Port — defaults to 3000
  const PORT = parseInt(optional("PORT", "3000"), 10)

  // AI completions use the shared provider pool. OpenRouter is the owner-requested
  // primary provider; Groq and Gemini are optional failover providers. OpenAI is
  // intentionally reserved for moderation/transcription and is never inserted into
  // the completion pool by validateEnv().
  const AI_PROVIDER_ORDER = optional("AI_PROVIDER_ORDER", "openrouter,groq,gemini")
  const OPENROUTER_CONFIGURED = Boolean(process.env.OPENROUTER_API_KEY?.trim())

  // Gate passwords. These used to be hardcoded literals in src/lib/constants.ts,
  // so they were committed to the repo and shipped in the bundle. They are now
  // environment-only. Empty values are refused in production, otherwise the
  // owner gate would accept an empty password.
  if (isProduction) {
    required("OWNER_PASSWORD")
  } else if (!process.env.OWNER_PASSWORD) {
    console.warn("[env] OWNER_PASSWORD is unset — the owner gate is disabled until you set it in .env")
  }

  // Where avatars, banners and voice notes are written.
  const UPLOAD_DIR = optional("UPLOAD_DIR", "./uploads")

  if (isProduction) {
    console.log("[env] Production mode")
    console.log(`[env] Database: ${isTurso ? "Turso (cloud)" : "SQLite (local)"}`)
    console.log(`[env] AI completions: ${AI_PROVIDER_ORDER}${OPENROUTER_CONFIGURED ? " (OpenRouter configured)" : " (OpenRouter key missing; optional fallbacks may apply)"}`)
    console.log(`[env] OpenAI: moderation/transcription only`)
    console.log(`[env] Port: ${PORT}`)
    console.log(`[env] Socket: ${NEXT_PUBLIC_SOCKET_URL}`)
    console.log(`[env] Uploads: ${UPLOAD_DIR}`)
  }

  return { DATABASE_URL, NEXT_PUBLIC_SOCKET_URL, PORT, AI_PROVIDER_ORDER, UPLOAD_DIR, isTurso }
}
