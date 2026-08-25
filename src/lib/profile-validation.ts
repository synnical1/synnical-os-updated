const HIDDEN_NAME_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u

export function validateDisplayName(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.normalize("NFKC").trim()
  const length = Array.from(value).length
  if (length < 1 || length > 32) return { ok: false, error: "Display name must be 1-32 characters" }
  if (HIDDEN_NAME_CHAR.test(value)) return { ok: false, error: "Display name cannot contain hidden or control characters" }
  if (/\s{4,}/u.test(value)) return { ok: false, error: "Display name cannot contain excessive spacing" }
  return { ok: true, value }
}
