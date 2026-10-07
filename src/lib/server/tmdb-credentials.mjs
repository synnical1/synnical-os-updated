// Only server-side callers supply environment values. Never return these in an API response.
export function resolveTmdbCredentials(env) {
  const tokens = [env.TMDB_API_READ_TOKEN, env.TMDB_READ_TOKEN].map(value => value?.trim() || "")
  const token = tokens.find(value => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))
  if (token) return { token, apiKey: null }
  const apiKey = env.TMDB_API_KEY?.trim() || ""
  if (/^[a-f0-9]{32}$/i.test(apiKey)) return { token: null, apiKey }
  return null
}
