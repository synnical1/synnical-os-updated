export const MAX_SETTINGS = 2000
export const MAX_SERIALIZED_BYTES = 256 * 1024
export type SettingValue = string | number | boolean
const VALID_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/

export function validSettings(value: unknown): value is Record<string, SettingValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const entries = Object.entries(value)
  if (entries.length > MAX_SETTINGS) return false
  return entries.every(([key, setting]) => VALID_KEY.test(key) && !["__proto__", "prototype", "constructor"].includes(key) && (
    typeof setting === "boolean" ||
    (typeof setting === "number" && Number.isFinite(setting)) ||
    (typeof setting === "string" && setting.length <= 4096)
  ))
}

export function sanitizeSettings(value: unknown): Record<string, SettingValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, MAX_SETTINGS).filter(([key, setting]) => validSettings({ [key]: setting })))
}

export async function readSettingsBody(req: Request): Promise<{ settings: Record<string, SettingValue>; accountId?: string } | Response> {
  const tooLarge = () => Response.json({ error: "Settings payload is too large" }, { status: 413 })
  if (Number(req.headers.get("content-length")) > MAX_SERIALIZED_BYTES) return tooLarge()
  const reader = req.body?.getReader()
  if (!reader) return Response.json({ error: "Settings object required" }, { status: 400 })
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SERIALIZED_BYTES) { await reader.cancel(); return tooLarge() }
      chunks.push(value)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!body || !validSettings(body.settings)) throw new Error("Invalid settings")
    if (body.accountId !== undefined && typeof body.accountId !== "string") throw new Error("Invalid account")
    return { settings: body.settings, accountId: body.accountId }
  } catch {
    return Response.json({ error: "Settings must contain valid bounded string, number or boolean values" }, { status: 400 })
  } finally { reader.releaseLock() }
}
