export const NOTABLE_PERSON_TAG = "Notable Person"
export const DEV_TAG = "DEV"
export const BETA_TESTER_TAG = "Beta Tester"
export const GOAT_TAG = "GOAT"

// Kept as a source-compatible legacy constant. It is no longer a first-class
// recognition role and will render as an ordinary tag on existing accounts.
export const BIG_SITE_OWNER_TAG = "Big Site Owner"

export const RECOGNITION_TAGS = [DEV_TAG, NOTABLE_PERSON_TAG, BETA_TESTER_TAG, GOAT_TAG] as const

export type RecognitionTag = typeof RECOGNITION_TAGS[number]

export function canonicalRecognitionTag(value: unknown): RecognitionTag | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (normalized === DEV_TAG.toLowerCase()) return DEV_TAG
  if (normalized === NOTABLE_PERSON_TAG.toLowerCase()) return NOTABLE_PERSON_TAG
  if (normalized === BETA_TESTER_TAG.toLowerCase()) return BETA_TESTER_TAG
  if (normalized === GOAT_TAG.toLowerCase()) return GOAT_TAG
  return null
}

export function isRecognitionTag(value: unknown): value is RecognitionTag {
  return canonicalRecognitionTag(value) !== null
}

export function recognitionTags(tags: readonly string[] | null | undefined): RecognitionTag[] {
  const out: RecognitionTag[] = []
  for (const value of tags || []) {
    const tag = canonicalRecognitionTag(value)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

export function ordinaryTags(tags: readonly string[] | null | undefined): string[] {
  return (tags || []).filter((tag) => !isRecognitionTag(tag))
}
