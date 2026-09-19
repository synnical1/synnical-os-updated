import test from "node:test"
import assert from "node:assert/strict"
import sharp from "sharp"
import { GIF_UPLOAD_MAX_BYTES } from "../src/lib/media-limits.ts"
import { AnimatedGifCropError, cropAnimatedGif, normalizeGifCrop } from "../src/lib/animated-gif.ts"

async function twoFrameGif() {
  const width = 4, frameHeight = 4, pages = 2, channels = 4
  const raw = Buffer.alloc(width * frameHeight * pages * channels)
  for (let i = 0; i < width * frameHeight; i++) {
    raw[i * 4] = 255
    raw[i * 4 + 3] = 255
  }
  const second = width * frameHeight * channels
  for (let i = 0; i < width * frameHeight; i++) {
    raw[second + i * 4 + 2] = 255
    raw[second + i * 4 + 3] = 255
  }
  return sharp(raw, { raw: { width, height: frameHeight * pages, channels, pageHeight: frameHeight } })
    .gif({ loop: 0, delay: [90, 170], keepDuplicateFrames: true })
    .toBuffer()
}

test("normalized GIF crop rejects out-of-bounds selections", () => {
  assert.deepEqual(normalizeGifCrop({ x: .1, y: .2, width: .5, height: .5 }), { x: .1, y: .2, width: .5, height: .5 })
  assert.equal(normalizeGifCrop({ x: .8, y: 0, width: .4, height: 1 }), null)
  assert.equal(normalizeGifCrop({ x: 0, y: 0, width: 0, height: 1 }), null)
})

test("animated GIF crop preserves frames, timing and output format", async () => {
  const source = await twoFrameGif()
  const before = await sharp(source, { animated: true, pages: -1 }).metadata()
  const result = await cropAnimatedGif(source, { x: .25, y: .25, width: .5, height: .5 })
  const after = await sharp(result.buffer, { animated: true, pages: -1 }).metadata()
  assert.equal(after.format, "gif")
  assert.equal(after.pages, before.pages)
  assert.equal(after.width, 2)
  assert.equal(after.pageHeight, 2)
  assert.deepEqual(after.delay, before.delay)
  assert.equal(after.loop, before.loop)
})

test("animated GIF crop enforces the canonical 10 MB file limit", async () => {
  await assert.rejects(
    () => cropAnimatedGif(Buffer.alloc(GIF_UPLOAD_MAX_BYTES + 1), { x: 0, y: 0, width: 1, height: 1 }),
    (error) => error instanceof AnimatedGifCropError && error.status === 413,
  )
})
