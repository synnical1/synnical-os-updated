export const NOTABLE_PERSON_TAG = "Notable Person"
export const BIG_SITE_OWNER_TAG = "Big Site Owner"
export const DEV_TAG = "DEV"
export const RECOGNITION_TAGS = [NOTABLE_PERSON_TAG, BIG_SITE_OWNER_TAG, DEV_TAG] as const

export type RecognitionTag = typeof RECOGNITION_TAGS[number]

export function canonicalRecognitionTag(value: unknown): RecognitionTag | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (normalized === NOTABLE_PERSON_TAG.toLowerCase()) return NOTABLE_PERSON_TAG
  if (normalized === BIG_SITE_OWNER_TAG.toLowerCase()) return BIG_SITE_OWNER_TAG
  if (normalized === DEV_TAG.toLowerCase()) return DEV_TAG
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
