import { remove as removeConfusables } from "./vendor/confusables"

export type ChatModerationViolation = {
  code: "AUTOMOD_RACIAL_SLUR" | "AUTOMOD_EXPLICIT_NSFW" | "AUTOMOD_TEXT_LENGTH"
  category: "racial_slur" | "explicit_nsfw" | "oversized_text"
  reason: string
  decision: "block" | "ban"
}

const MAX_TEXT_CHARS = 4096
const MAX_REPRESENTATIONS = 36

// Local permanent bans are limited to unambiguous, high-confidence forms.
// Contextual OpenAI review handles ambiguous/reclaimed/quoted speech and novel
// multilingual evasions so the platform does not recklessly auto-ban users.
const RACIAL_SLUR_PATTERNS: RegExp[] = [
  // Require the doubled consonant in the deterministic auto-ban path so the
  // country name "Niger" is never treated as a high-confidence violation.
  /\bn+i+g{2,}e+r+s?\b/i,
  /\bn+i+g+a+s?\b/i,
  /\bchinks?\b/i,
  /\bcoons?\b/i,
  /\bsambos?\b/i,
  /\bdarkies?\b/i,
  /\bgooks?\b/i,
  /\bspics?\b/i,
  /\bwetbacks?\b/i,
  /\bkikes?\b/i,
  /\bkykes?\b/i,
  /\bpakis?\b/i,
  /\bragheads?\b/i,
  /\btowelheads?\b/i,
  /\bbeaners?\b/i,
  /\bzipperheads?\b/i,
  /\bching\s*chongs?\b/i,
  /\bslant\s*eyes?\b/i,
  /\bdot\s*heads?\b/i,
  /\bredskins?\b/i,
  /\bdagos?\b/i,
  /\bwogs?\b/i,
  /\bjungle\s*bunn(?:y|ies)\b/i,
  /\bporch\s*monk(?:ey|eys)\b/i,
  /\bsand\s*n+i+g+e+r+s?\b/i,
  /\bcamel\s*jock(?:ey|eys)\b/i,
  /\bwhite\s*trash\b/i,
]

const EXPLICIT_NSFW_PATTERNS: RegExp[] = [
  /\bchild\s*porn(?:ography)?\b/i,
  /\b(?:send|trade|share|show)\s*(?:me\s*)?nudes?\b/i,
  /\b(?:rape|raping)\s*(?:porn|fantasy|video)s?\b/i,
  /\b(?:bestiality|zoophilia)\b/i,
  /\b(?:incest|underage)\s*porn\b/i,
  /\b(?:hardcore|explicit)\s*porn(?:ography)?\b/i,
  /\b(?:blowjob|handjob|cumshot|gangbang)s?\b/i,
  /\b(?:pornhub|xvideos|xnxx|redtube|youporn|onlyfans)\s*(?:link|account|video)?s?\b/i,
]

const NSFW_URL_PATTERN = /(?:pornhub|xvideos|xnxx|redtube|youporn|onlyfans)/i

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    })
    .replace(/&#([0-9]{1,7});?/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : ""
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

function unicodeSkeleton(value: string): string {
  // The public entry point rejects longer content. The slice keeps this helper
  // bounded when it is also used for URLs and contextual representations.
  const visible = decodeEntities(value.slice(0, MAX_TEXT_CHARS))
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    // Strip control/format characters, bidi controls and invisible tag text.
    .replace(/[\p{Cf}\p{Cc}\u{E0000}-\u{E007F}]+/gu, "")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/þ/g, "th")
    .replace(/ð/g, "d")

  return removeConfusables(visible).normalize("NFKC").toLowerCase()
}

function leetSkeleton(value: string, fourAs: "a" | "r" | "h"): string {
  return value
    .replace(/\|\s*\\\s*\|/g, "n")
    .replace(/\/\s*\\/g, "a")
    .replace(/@/g, "a")
    .replace(/[!1|]/g, "i")
    .replace(/3/g, "e")
    .replace(/0/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[69]/g, "g")
    .replace(/8/g, "b")
    .replace(/2/g, "z")
    .replace(/7/g, "t")
    .replace(/4/g, fourAs)
}

const SPOKEN_LETTERS: Record<string, string> = {
  a: "a", ay: "a", bee: "b", be: "b", cee: "c", see: "c",
  dee: "d", e: "e", ee: "e", eff: "f", gee: "g", jee: "g",
  aitch: "h", eye: "i", i: "i", jay: "j", kay: "k", el: "l",
  ell: "l", em: "m", en: "n", oh: "o", o: "o", pee: "p",
  cue: "q", queue: "q", ar: "r", are: "r", ess: "s", tea: "t",
  tee: "t", you: "u", u: "u", vee: "v", doubleyou: "w", ex: "x",
  why: "y", zee: "z", zed: "z",
}

function spokenLetterRun(value: string): string | null {
  const tokens = value.replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean)
  if (tokens.length < 4 || tokens.length > 24) return null
  const decoded = tokens.map((token) => SPOKEN_LETTERS[token])
  return decoded.every(Boolean) ? decoded.join("") : null
}

function addVariants(target: Set<string>, value: string): void {
  const spaced = value.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
  const compact = value.replace(/[^a-z0-9]+/g, "")
  const letters = value.replace(/[^a-z]+/g, "")
  for (const candidate of [value, spaced, compact, letters]) {
    if (!candidate) continue
    target.add(candidate)
    target.add(candidate.replace(/([a-z])\1{2,}/g, "$1$1"))
    target.add(candidate.replace(/([a-z])\1+/g, "$1"))
  }
  const spoken = spokenLetterRun(spaced)
  if (spoken) target.add(spoken)
  if (compact.length >= 4 && compact.length <= 40) target.add([...compact].reverse().join(""))
}

/** Representations are only for matching/classification, never display. */
export function moderationRepresentations(raw: string): string[] {
  const base = unicodeSkeleton(raw)
  const variants = new Set<string>()
  addVariants(variants, base)
  addVariants(variants, leetSkeleton(base, "a"))
  addVariants(variants, leetSkeleton(base, "r"))
  addVariants(variants, leetSkeleton(base, "h"))
  return [...variants].filter(Boolean).slice(0, MAX_REPRESENTATIONS)
}

export function moderateChatMessage(content: string, gifUrl?: string | null): ChatModerationViolation | null {
  if (content.length > MAX_TEXT_CHARS) {
    return {
      code: "AUTOMOD_TEXT_LENGTH",
      category: "oversized_text",
      reason: `Content exceeds the ${MAX_TEXT_CHARS}-character moderation limit`,
      decision: "block",
    }
  }

  for (const value of moderationRepresentations(content)) {
    if (RACIAL_SLUR_PATTERNS.some((pattern) => pattern.test(value))) {
      return {
        code: "AUTOMOD_RACIAL_SLUR",
        category: "racial_slur",
        reason: "High-confidence racist slur or deliberate evasion detected",
        decision: "ban",
      }
    }
    if (EXPLICIT_NSFW_PATTERNS.some((pattern) => pattern.test(value))) {
      return {
        code: "AUTOMOD_EXPLICIT_NSFW",
        category: "explicit_nsfw",
        reason: "High-confidence explicit sexual content or solicitation detected",
        decision: "ban",
      }
    }
  }

  if (gifUrl && moderationRepresentations(gifUrl).some((value) => NSFW_URL_PATTERN.test(value))) {
    return {
      code: "AUTOMOD_EXPLICIT_NSFW",
      category: "explicit_nsfw",
      reason: "High-confidence explicit NSFW link detected",
      decision: "ban",
    }
  }
  return null
}
