import sharp from "sharp"
import { moderateChatMessage, type ChatModerationViolation } from "./chat-moderation"

const DEFAULT_AUDIO_URL = "https://api.openai.com/v1/audio/transcriptions"
const DEFAULT_OPENAI_MODERATION_URL = "https://api.openai.com/v1/moderations"

export type ModerationDecision = "allow" | "block" | "ban"

export type ModerationResult = {
  decision: ModerationDecision
  code:
    | "MODERATION_OK"
    | "MODERATION_UNAVAILABLE"
    | "AUTOMOD_RACIAL_SLUR"
    | "AUTOMOD_EXPLICIT_NSFW"
    | "AUTOMOD_TEXT_LENGTH"
    | "AUTOMOD_GROOMING"
    | "AUTOMOD_CSEA"
    | "AUTOMOD_HATE"
    | "AUTOMOD_SEXUAL_SOLICITATION"
    | "AUTOMOD_HARASSMENT"
    | "AUTOMOD_SELF_HARM"
    | "AUTOMOD_VIOLENCE"
    | "AUTOMOD_ILLICIT"
    | "AUTOMOD_UNSAFE_LINK"
    | "AUTOMOD_IMAGE_ADULT"
    | "AUTOMOD_IMAGE_MINOR_RISK"
    | "AUTOMOD_IMAGE_HATE"
    | "AUTOMOD_IMAGE_UNSAFE"
    | "AUTOMOD_ANIMATION_TOO_LONG"
    | "AUTOMOD_AUDIO_UNSUPPORTED"
  category: string
  reason: string
  confidence: number
  source: "local" | "openai" | "system"
}

export type ModeratedImage = {
  buffer?: Buffer
  extension?: ".webp"
  mime?: "image/webp"
  animated?: boolean
  result: ModerationResult
}

type ContextMessage = { username: string; content: string }
export type TextModerationMode = "local" | "hybrid" | "strict"
export type ModerationProvider = "openai"

/**
 * Moderation and transcription use the server-side OpenAI key. Synnical AI and Synn Bot completions use the separate provider pool (OpenRouter first).
 */
export function moderationProvider(value = process.env.MODERATION_PROVIDER): ModerationProvider {
  void value
  return "openai"
}

/**
 * Local is the outage-safe default: normalized deterministic rules run without
 * spending an API request per chat message. Hybrid adds contextual OpenAI review
 * but falls back to the local verdict if the provider is unavailable. Strict
 * retains fail-closed provider behaviour for operators who explicitly choose
 * availability loss over degraded moderation.
 */
export function textModerationMode(value = process.env.TEXT_MODERATION_MODE): TextModerationMode {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "hybrid" || normalized === "strict") return normalized
  return "local"
}

const ok = (source: ModerationResult["source"] = "openai"): ModerationResult => ({
  decision: "allow",
  code: "MODERATION_OK",
  category: "safe",
  reason: "Content passed automated safety checks",
  confidence: 1,
  source,
})

const unavailable = (reason: string): ModerationResult => ({
  decision: "block",
  code: "MODERATION_UNAVAILABLE",
  category: "moderation_unavailable",
  reason,
  confidence: 1,
  source: "system",
})

let textProviderPausedUntil = 0

function providerFailure(mode: TextModerationMode, detail: string): ModerationResult {
  if (mode === "strict") {
    return unavailable(`[MODERATION_UNAVAILABLE] Text moderation could not complete: ${detail.slice(0, 140)}`)
  }

  // Hybrid is a second layer, not a single point of failure. Avoid hammering a
  // quota-limited provider after 429 and avoid leaking provider diagnostics to
  // users. High-confidence normalized local rules have already run above.
  const cooldown = /HTTP 429\b/.test(detail) ? 5 * 60_000 : 30_000
  textProviderPausedUntil = Math.max(textProviderPausedUntil, Date.now() + cooldown)
  console.warn(`[moderation/text] contextual provider unavailable; local fallback active (${detail.slice(0, 80)})`)
  return ok("local")
}

function fromLocal(violation: ChatModerationViolation): ModerationResult {
  return {
    decision: violation.decision,
    code: violation.code,
    category: violation.category,
    reason: violation.reason,
    confidence: 1,
    source: "local",
  }
}

type OpenAIModerationResponse = {
  flagged?: boolean
  categories?: Record<string, boolean>
  category_scores?: Record<string, number>
}

async function openAIModeration(input: unknown, timeoutMs = 20_000): Promise<OpenAIModerationResponse> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) throw new Error("OPENAI_API_KEY is missing")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(
      process.env.OPENAI_MODERATION_URL?.trim() || DEFAULT_OPENAI_MODERATION_URL,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODERATION_MODEL?.trim() || "omni-moderation-latest",
          input,
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    )
    const body = await response.text()
    if (!response.ok) throw new Error(`OpenAI moderation HTTP ${response.status}`)
    const parsed = JSON.parse(body)
    const result = parsed?.results?.[0]
    if (!result || typeof result !== "object") throw new Error("OpenAI moderation returned no result")
    return result
  } finally {
    clearTimeout(timer)
  }
}

function categoryScore(result: OpenAIModerationResponse, category: string): number {
  return Math.max(0, Math.min(1, Number(result.category_scores?.[category]) || 0))
}

function mapOpenAITextClassification(result: OpenAIModerationResponse): ModerationResult {
  if (!result.flagged) return ok("openai")
  const categories = result.categories || {}
  const ordered: Array<[string, ModerationResult["code"], string]> = [
    ["sexual/minors", "AUTOMOD_CSEA", "sexual content involving minors"],
    ["hate/threatening", "AUTOMOD_HATE", "threatening hateful content"],
    ["hate", "AUTOMOD_HATE", "hateful content"],
    ["sexual", "AUTOMOD_EXPLICIT_NSFW", "sexual content"],
    ["harassment/threatening", "AUTOMOD_HARASSMENT", "threatening harassment"],
    ["harassment", "AUTOMOD_HARASSMENT", "harassment"],
    ["self-harm/instructions", "AUTOMOD_SELF_HARM", "self-harm instructions"],
    ["self-harm/intent", "AUTOMOD_SELF_HARM", "self-harm intent"],
    ["self-harm", "AUTOMOD_SELF_HARM", "self-harm content"],
    ["illicit/violent", "AUTOMOD_ILLICIT", "violent illicit content"],
    ["illicit", "AUTOMOD_ILLICIT", "illicit content"],
    ["violence/graphic", "AUTOMOD_VIOLENCE", "graphic violence"],
    ["violence", "AUTOMOD_VIOLENCE", "violent content"],
  ]
  const match = ordered.find(([category]) => categories[category])
  if (!match) throw new Error("OpenAI moderation flagged an unknown category")
  const [category, code, label] = match
  const confidence = categoryScore(result, category)
  const severe = category === "sexual/minors" || category === "hate/threatening" || category === "sexual"
  return {
    decision: severe && confidence >= 0.98 ? "ban" : "block",
    code,
    category,
    reason: `Automated safety review detected ${label}.`,
    confidence,
    source: "openai",
  }
}

function mapOpenAIImageClassification(result: OpenAIModerationResponse): ModerationResult {
  if (!result.flagged) return ok("openai")
  const categories = result.categories || {}
  const ordered: Array<[string, ModerationResult["code"], string]> = [
    ["sexual/minors", "AUTOMOD_IMAGE_MINOR_RISK", "possible sexual content involving a minor"],
    ["sexual", "AUTOMOD_IMAGE_ADULT", "sexual imagery"],
    ["violence/graphic", "AUTOMOD_IMAGE_UNSAFE", "graphic violence"],
    ["violence", "AUTOMOD_IMAGE_UNSAFE", "violent imagery"],
    ["self-harm/instructions", "AUTOMOD_IMAGE_UNSAFE", "self-harm instructions"],
    ["self-harm/intent", "AUTOMOD_IMAGE_UNSAFE", "self-harm intent"],
    ["self-harm", "AUTOMOD_IMAGE_UNSAFE", "self-harm imagery"],
    // These currently apply to text in OpenAI's published category table, but
    // keep the mapping fail-safe if image coverage expands in a model update.
    ["hate/threatening", "AUTOMOD_IMAGE_HATE", "threatening hateful imagery"],
    ["hate", "AUTOMOD_IMAGE_HATE", "hateful imagery"],
  ]
  const match = ordered.find(([category]) => categories[category])
  if (!match) throw new Error("OpenAI image moderation flagged an unknown category")
  const [category, code, label] = match
  const confidence = categoryScore(result, category)
  return {
    decision: category === "sexual" && confidence >= 0.98 ? "ban" : "block",
    code,
    category,
    reason: `Automated safety review detected ${label}.`,
    confidence,
    source: "openai",
  }
}

/**
 * Text moderation always runs deterministic normalization and high-confidence
 * rules first. Optional hybrid/strict modes can add contextual provider review.
 */
export async function moderateTextContent(input: {
  content: string
  context?: ContextMessage[]
  surface: "chat" | "message_edit" | "profile" | "status" | "username" | "voice"
}): Promise<ModerationResult> {
  const local = moderateChatMessage(input.content)
  if (local) return fromLocal(local)

  const content = input.content.trim()
  if (!content) return ok("local")

  const mode = textModerationMode()
  if (mode === "local") return ok("local")
  if (mode === "hybrid" && Date.now() < textProviderPausedUntil) return ok("local")

  try {
    return mapOpenAITextClassification(await openAIModeration(content))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    if (mode === "strict") console.error("[moderation/text]", detail)
    return providerFailure(mode, detail)
  }
}

function boundedIntegerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(process.env[name] || "", 10)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

// Long profile animations are scanned in small sequential batches. Operators
// with more CPU/RAM can raise these values without editing source, while hard
// ceilings and the semaphore still prevent one upload from exhausting Node.
const MAX_ANIMATED_FRAMES = boundedIntegerEnv("PROFILE_ANIMATION_MAX_FRAMES", 600, 120, 1_200)
const MAX_ANIMATED_PIXELS = boundedIntegerEnv("PROFILE_ANIMATION_MAX_PIXELS", 384_000_000, 96_000_000, 768_000_000)
export const PROFILE_UPLOAD_MAX_BYTES = boundedIntegerEnv("PROFILE_UPLOAD_MAX_BYTES", 16 * 1024 * 1024, 4 * 1024 * 1024, 32 * 1024 * 1024)
const MAX_FRAME_EDGE = 4_096
const FRAMES_PER_SHEET = 16
const FRAME_THUMB_SIZE = 192

class BoundedSemaphore {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private limit: number, private maxQueued: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maxQueued) throw new Error("IMAGE_MODERATION_OVERLOADED")
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    this.active += 1
    try {
      return await operation()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

// Sharp decode/contact-sheet work is memory intensive. Bound it so a burst of
// uploads cannot freeze the Node process or starve browser/chat requests.
const imageModerationSemaphore = new BoundedSemaphore(1, 24)

function blockedImage(
  code: ModerationResult["code"],
  category: string,
  reason: string,
): ModeratedImage {
  return { result: { decision: "block", code, category, reason, confidence: 1, source: "system" } }
}

/**
 * Decode every animation frame and tile them into contact sheets. Sharp exposes
 * multi-page inputs as a vertically stacked image, so no frame is skipped.
 */
async function makeFrameContactSheets(buffer: Buffer, expectedPages: number): Promise<Buffer[]> {
  const sheets: Buffer[] = []
  for (let first = 0; first < expectedPages; first += FRAMES_PER_SHEET) {
    const count = Math.min(FRAMES_PER_SHEET, expectedPages - first)
    const { data, info } = await sharp(buffer, {
      page: first,
      pages: count,
      failOn: "error",
      limitInputPixels: MAX_ANIMATED_PIXELS,
    })
      .resize({
        width: FRAME_THUMB_SIZE,
        height: FRAME_THUMB_SIZE,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Sharp reports source `info.pages` even when `options.pages` decodes only
    // this batch. Derive the decoded count from the returned stacked height.
    const frameHeight = info.pageHeight || info.height
    const decodedPages = Math.floor(info.height / frameHeight)
    if (decodedPages !== count || frameHeight < 1 || info.width < 1) {
      throw new Error(`Frame decode mismatch at frame ${first + 1} (expected ${count}, got ${decodedPages})`)
    }
    const channels = info.channels as 1 | 2 | 3 | 4
    const bytesPerFrame = info.width * frameHeight * channels
    if (bytesPerFrame * decodedPages > data.length) throw new Error("Decoded frame buffer is incomplete")

    const columns = 4
    const rows = Math.ceil(count / columns)
    const composites: sharp.OverlayOptions[] = []
    for (let index = 0; index < count; index++) {
      const frame = first + index
      const start = index * bytesPerFrame
      const left = (index % columns) * info.width
      const top = Math.floor(index / columns) * frameHeight
      composites.push({
        input: data.subarray(start, start + bytesPerFrame),
        raw: { width: info.width, height: frameHeight, channels },
        left,
        top,
      })
      composites.push({
        input: Buffer.from(`<svg width="${info.width}" height="${frameHeight}"><rect x="3" y="3" width="48" height="22" rx="4" fill="black" fill-opacity=".78"/><text x="8" y="19" fill="white" font-size="14" font-family="sans-serif">F${frame + 1}</text></svg>`),
        left,
        top,
      })
    }
    sheets.push(await sharp({
      create: {
        width: columns * info.width,
        height: rows * frameHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    }).composite(composites).webp({ quality: 82, effort: 4 }).toBuffer())
  }
  return sheets
}

/** Validate, strip metadata, re-encode, then classify an avatar/banner before storage. */
type ImageModerationSurface = "pfp" | "banner" | "chat"

async function moderateAndSanitizeImageInner(buffer: Buffer, surface: ImageModerationSurface): Promise<ModeratedImage> {
  if (!buffer.length || buffer.length > PROFILE_UPLOAD_MAX_BYTES) {
    const maxMegabytes = Math.floor(PROFILE_UPLOAD_MAX_BYTES / (1024 * 1024))
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "invalid_image", `[AUTOMOD_IMAGE_UNSAFE] Image is empty or exceeds the ${maxMegabytes} MB limit.`)
  }
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(buffer, { animated: true, pages: -1, failOn: "error", limitInputPixels: MAX_ANIMATED_PIXELS }).metadata()
  } catch {
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "invalid_image", "[AUTOMOD_IMAGE_UNSAFE] The image could not be safely decoded.")
  }

  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp", "avif", "gif"].includes(metadata.format || "")) {
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "invalid_image", "[AUTOMOD_IMAGE_UNSAFE] Unsupported or malformed image.")
  }

  const pages = metadata.pages || 1
  const isAnimated = pages > 1
  const perFrameHeight = metadata.pageHeight || metadata.height
  if (metadata.width > MAX_FRAME_EDGE || perFrameHeight > MAX_FRAME_EDGE) {
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "image_dimensions", `[AUTOMOD_IMAGE_UNSAFE] Image dimensions exceed ${MAX_FRAME_EDGE}px per edge.`)
  }
  if (isAnimated && metadata.format !== "gif" && metadata.format !== "webp") {
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "animation_format", "[AUTOMOD_IMAGE_UNSAFE] Only GIF and WebP animations are supported.")
  }
  if (isAnimated && (pages > MAX_ANIMATED_FRAMES || metadata.width * perFrameHeight * pages > MAX_ANIMATED_PIXELS)) {
    return blockedImage(
      "AUTOMOD_ANIMATION_TOO_LONG",
      "animation_scan_limit",
      `[AUTOMOD_ANIMATION_TOO_LONG] Animation exceeds the full-scan limit (${MAX_ANIMATED_FRAMES} frames / ${MAX_ANIMATED_PIXELS} decoded pixels).`,
    )
  }

  let safeBuffer: Buffer
  try {
    const target = isAnimated
      ? surface === "pfp"
        ? { width: 384, height: 384 }
        : surface === "chat"
          ? { width: 960, height: 960 }
          : { width: 768, height: 432 }
      : surface === "pfp"
        ? { width: 768, height: 768 }
        : surface === "chat"
          ? { width: 1600, height: 1600 }
          : { width: 1280, height: 720 }
    const pipeline = sharp(buffer, {
      animated: isAnimated,
      pages: isAnimated ? -1 : 1,
      failOn: "error",
      limitInputPixels: MAX_ANIMATED_PIXELS,
    })
    if (!isAnimated) pipeline.rotate()
    safeBuffer = await pipeline
      .resize({ ...target, fit: "inside", withoutEnlargement: true })
      .webp({ quality: isAnimated ? 80 : 86, effort: 4, loop: 0 })
      .toBuffer()
  } catch {
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "image_processing", "[AUTOMOD_IMAGE_UNSAFE] Image sanitisation failed.")
  }

  if (surface === "chat") {
    return {
      buffer: safeBuffer,
      extension: ".webp",
      mime: "image/webp",
      animated: isAnimated,
      result: ok("local"),
    }
  }

  let reviewImages: Buffer[]
  let reviewPages = 1
  try {
    if (isAnimated) {
      const sanitizedMetadata = await sharp(safeBuffer, {
        animated: true,
        pages: -1,
        failOn: "error",
        limitInputPixels: MAX_ANIMATED_PIXELS,
      }).metadata()
      reviewPages = sanitizedMetadata.pages || 1
      if (reviewPages < 1 || reviewPages > pages) throw new Error("Sanitized animation reported an invalid frame count")
      reviewImages = reviewPages > 1 ? await makeFrameContactSheets(safeBuffer, reviewPages) : [safeBuffer]
    } else {
      reviewImages = [safeBuffer]
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return blockedImage("AUTOMOD_IMAGE_UNSAFE", "animation_decode", `[AUTOMOD_IMAGE_UNSAFE] Full animation scan failed: ${detail.slice(0, 120)}`)
  }

  try {
    // Bound request bodies and rate pressure for long animations. Each item
    // is a contact sheet containing up to sixteen consecutive source frames.
    for (let first = 0; first < reviewImages.length; first += 8) {
      const input = reviewImages.slice(first, first + 8).map((image) => ({
        type: "image_url",
        image_url: { url: `data:image/webp;base64,${image.toString("base64")}` },
      }))
      const classification = mapOpenAIImageClassification(await openAIModeration(input, 35_000))
      if (classification.decision !== "allow") {
        return {
          buffer: safeBuffer,
          extension: ".webp",
          mime: "image/webp",
          animated: reviewPages > 1,
          result: classification,
        }
      }
    }
    return {
      buffer: safeBuffer,
      extension: ".webp",
      mime: "image/webp",
      animated: reviewPages > 1,
      result: ok("openai"),
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error("[moderation/image]", detail)
    return {
      buffer: safeBuffer,
      extension: ".webp",
      mime: "image/webp",
      animated: reviewPages > 1,
      result: unavailable(`[MODERATION_UNAVAILABLE] Image moderation could not complete: ${detail.slice(0, 140)}`),
    }
  }
}

export async function moderateAndSanitizeImage(buffer: Buffer, surface: ImageModerationSurface): Promise<ModeratedImage> {
  try {
    return await imageModerationSemaphore.run(() => moderateAndSanitizeImageInner(buffer, surface))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error("[moderation/image-queue]", detail)
    return { result: unavailable("[MODERATION_UNAVAILABLE] Image moderation is busy; retry shortly.") }
  }
}

export async function transcribeAndModerateAudio(file: File): Promise<{ transcript?: string; result: ModerationResult }> {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return { result: unavailable("[MODERATION_UNAVAILABLE] Voice moderation is not configured.") }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const form = new FormData()
    form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe")
    form.append("file", file, file.name || "voice-message")
    const response = await fetch(process.env.OPENAI_TRANSCRIPTION_URL?.trim() || DEFAULT_AUDIO_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      cache: "no-store",
      signal: controller.signal,
    })
    const body = await response.text()
    if (!response.ok) {
      return { result: { decision: "block", code: "AUTOMOD_AUDIO_UNSUPPORTED", category: "audio_transcription", reason: `[AUTOMOD_AUDIO_UNSUPPORTED] Voice transcription failed with OpenAI HTTP ${response.status}.`, confidence: 1, source: "system" } }
    }
    const parsed = JSON.parse(body)
    const transcript = String(parsed?.text || "").trim()
    if (!transcript) return { result: unavailable("[MODERATION_UNAVAILABLE] Voice transcription returned no text.") }
    return { transcript, result: await moderateTextContent({ content: transcript, surface: "voice" }) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error("[moderation/audio]", detail)
    return { result: unavailable(`[MODERATION_UNAVAILABLE] Voice moderation could not complete: ${detail.slice(0, 140)}`) }
  } finally {
    clearTimeout(timer)
  }
}
