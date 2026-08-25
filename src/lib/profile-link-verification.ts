import { resolve4, resolve6 } from "dns/promises"
import https from "https"
import net from "net"

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a,b] = parts
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.")
}

function publicIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) return !isPrivateIPv4(ip)
  if (family === 6) return !isPrivateIPv6(ip)
  return false
}

export async function resolvePublicProfileDomain(domain: string): Promise<string[]> {
  const clean = domain.trim().toLowerCase().replace(/\.$/, "")
  if (!clean || clean === "localhost" || clean.endsWith(".local") || net.isIP(clean)) throw new Error("Profile verification requires a public DNS hostname")
  const addresses = [...await resolve4(clean).catch(() => []), ...await resolve6(clean).catch(() => [])]
  if (!addresses.length) throw new Error("Profile domain has no public DNS address")
  if (addresses.some((address) => !publicIp(address))) throw new Error("Profile domain resolves to a private or reserved network address")
  return [...new Set(addresses)]
}

export async function fetchVerificationToken(domain: string): Promise<string> {
  const addresses = await resolvePublicProfileDomain(domain)
  let lastError: Error | null = null
  for (const address of addresses.slice(0, 4)) {
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const request = https.request({
          hostname: address,
          port: 443,
          method: "GET",
          path: "/.well-known/synnical-verification.txt",
          servername: domain,
          headers: { Host: domain, "User-Agent": "Synnical-Profile-Link-Verifier/1.0", Accept: "text/plain" },
          rejectUnauthorized: true,
          timeout: 5000,
        }, (response) => {
          if (response.statusCode !== 200) { response.resume(); reject(new Error(`verification returned HTTP ${response.statusCode}`)); return }
          const chunks: Buffer[] = []
          let bytes = 0
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes > 8192) { request.destroy(new Error("verification response is too large")); return }
            chunks.push(Buffer.from(chunk))
          })
          response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()))
        })
        request.on("timeout", () => request.destroy(new Error("verification timed out")))
        request.on("error", reject)
        request.end()
      })
      return body
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError || new Error("Profile domain verification failed")
}
