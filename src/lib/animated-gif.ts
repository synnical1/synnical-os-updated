import "server-only"

import sharp from "sharp"
import { GIF_UPLOAD_MAX_BYTES, GIF_UPLOAD_MAX_LABEL } from "@/lib/media-limits"

export type NormalizedGifCrop = { x: number; y: number; width: number; height: number }

const MAX_ANIMATED_PIXELS = 384_000_000
const MAX_FRAMES = 600

function finiteUnit(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null
}

export function normalizeGifCrop(value: unknown): NormalizedGifCrop | null {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  const x = finiteUnit(input.x), y = finiteUnit(input.y), width = finiteUnit(input.width), height = finiteUnit(input.height)
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) return null
  if (x + width > 1.0001 || y + height > 1.0001) return null
  return { x, y, width, height }
}

export class AnimatedGifCropError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function cropAnimatedGif(input: Buffer, crop: NormalizedGifCrop) {
  if (!input.length) throw new AnimatedGifCropError("The GIF is empty.")
  if (input.length > GIF_UPLOAD_MAX_BYTES) throw new AnimatedGifCropError(GIF_UPLOAD_MAX_LABEL, 413)
  const signature = input.subarray(0, 6).toString("ascii")
  if (signature !== "GIF87a" && signature !== "GIF89a") throw new AnimatedGifCropError("Choose a valid GIF.")

  const metadata = await sharp(input, {
    animated: true,
    pages: -1,
    failOn: "error",
    limitInputPixels: MAX_ANIMATED_PIXELS,
  }).metadata().catch(() => null)
  const sourceWidth = metadata?.width || 0
  const frameHeight = metadata?.pageHeight || metadata?.height || 0
  const pages = metadata?.pages || 1
  if (metadata?.format !== "gif" || sourceWidth < 1 || frameHeight < 1 || pages < 2) {
    throw new AnimatedGifCropError("That GIF could not be decoded as an animation.")
  }
  if (pages > MAX_FRAMES || sourceWidth * frameHeight * pages > MAX_ANIMATED_PIXELS) {
    throw new AnimatedGifCropError("This GIF is too long to crop safely.")
  }

  const left = Math.min(sourceWidth - 1, Math.max(0, Math.round(crop.x * sourceWidth)))
  const top = Math.min(frameHeight - 1, Math.max(0, Math.round(crop.y * frameHeight)))
  const width = Math.min(sourceWidth - left, Math.max(1, Math.round(crop.width * sourceWidth)))
  const height = Math.min(frameHeight - top, Math.max(1, Math.round(crop.height * frameHeight)))

  const encode = (optimised: boolean) => sharp(input, {
    animated: true,
    pages: -1,
    failOn: "error",
    limitInputPixels: MAX_ANIMATED_PIXELS,
  })
    .extract({ left, top, width, height })
    .gif({
      loop: metadata.loop ?? 0,
      delay: metadata.delay,
      keepDuplicateFrames: true,
      reoptimise: true,
      effort: optimised ? 10 : 7,
      ...(optimised ? { interFrameMaxError: 4, interPaletteMaxError: 4 } : {}),
    })
    .toBuffer({ resolveWithObject: true })

  let result = await encode(false)
  if (result.data.length > GIF_UPLOAD_MAX_BYTES) result = await encode(true)
  if (result.data.length > GIF_UPLOAD_MAX_BYTES) throw new AnimatedGifCropError(GIF_UPLOAD_MAX_LABEL, 413)

  const outputMeta = await sharp(result.data, { animated: true, pages: -1, failOn: "error" }).metadata()
  if ((outputMeta.pages || 1) !== pages || (outputMeta.pages || 1) < 2) {
    throw new AnimatedGifCropError("The cropped GIF lost animation frames, so it was not saved.", 500)
  }

  return {
    buffer: result.data,
    width: outputMeta.width || width,
    height: outputMeta.pageHeight || outputMeta.height || height,
    pages,
    loop: outputMeta.loop ?? metadata.loop ?? 0,
    delay: outputMeta.delay || metadata.delay || [],
  }
}
