// Read-only dependency probe. Never creates an inbox/account/game or follows redirects.
async function probeMalq(url, fetcher = globalThis.fetch) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return "invalid";
    const response = await fetcher(parsed.href, { redirect: "error", signal: AbortSignal.timeout(2000) });
    if (!response.ok) return "unavailable";
    // Bound the root HTML read; never include provider bodies/errors in a report.
    const reader = response.body?.getReader();
    if (!reader) return "unexpected_service";
    let html = "";
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) return "unexpected_service";
        html += new TextDecoder().decode(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return /<title>\s*malq\b/i.test(html) ? "ready" : "unexpected_service";
  } catch { return "unavailable"; }
}
module.exports = { probeMalq };
