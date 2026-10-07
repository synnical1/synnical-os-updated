// Diagnostics for disposable smoke fixtures only; never log request bodies.
export function createSmokeDiagnostics(env) {
  const secrets = new Set()
  const remember = value => {
    if (!value || typeof value !== "object") return
    for (const [key, item] of Object.entries(value)) {
      if (item && typeof item === "object") remember(item)
      if (typeof item !== "string" || !/password|token|secret|cookie|authorization|api.?key|securityAnswer|lockPin/i.test(key)) continue
      if (item.length > 3) secrets.add(item)
      if (/cookie/i.test(key)) for (const part of item.split(/;\s*/)) {
        const at = part.indexOf("=")
        if (at >= 0 && part.slice(at + 1).length > 3) secrets.add(part.slice(at + 1))
      }
    }
  }
  remember(env)
  const redact = value => {
    let output = String(value)
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) output = output.split(secret).join("[redacted]")
    return output.replace(/\b[a-f0-9]{64}\b|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, "[redacted]")
  }
  return { remember, redact }
}
