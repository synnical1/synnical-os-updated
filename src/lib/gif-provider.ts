function allowedGiphyUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || !/^(?:media(?:[0-9]+)?|i)\.giphy\.com$/i.test(url.hostname)) return null
    if (url.username || url.password || !url.pathname.toLowerCase().endsWith(".gif")) return null
    // GIPHY may return media0..media4 or i.giphy.com for the same asset.
    // Canonicalising to the documented media host avoids deployment/CSP and
    // privacy-filter rules that allow media.giphy.com but reject numbered
    // aliases. The path and query still point directly at GIPHY's CDN.
    url.hostname = "media.giphy.com"
    return url
  } catch {
    return null
  }
}

// Chat accepts direct GIPHY CDN assets only. GIPHY's current API terms require
// clients to load returned media directly rather than proxying or caching it.
export function verifiedGiphyMediaUrl(value: string): string | null {
  return allowedGiphyUrl(value)?.toString() || null
}
