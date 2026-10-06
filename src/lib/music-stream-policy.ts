/** Source URLs are returned by upstream bridges, not trusted request input. */
export function allowedMusicStreamUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash) return null
    // Optional local bridge sources must match an operator's exact configured origin.
    const configured = [process.env.PIPED_API_BASE, process.env.INVIDIOUS_API_BASE, ...(process.env.MUSIC_STREAM_ALLOWED_ORIGINS || "").split(",")]
      .filter(Boolean).flatMap(raw => { try { return [new URL(raw!.trim()).origin] } catch { return [] } })
    const vendor = url.hostname.endsWith(".googlevideo.com")
    if (url.protocol === "https:" && (vendor || configured.includes(url.origin))) return url
    if (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && configured.includes(url.origin)) return url
    return null
  } catch { return null }
}
