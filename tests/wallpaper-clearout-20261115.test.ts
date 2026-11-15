import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { clearWallpaperUploads } from "../scripts/clear-wallpaper-uploads.mjs"

test("wallpaper cleanup removes only generated desktop and lock wallpaper uploads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "synnical-wallpaper-cleanup-"))
  try {
    const files = [
      "user1-os-desktop-wallpaper-123.webp",
      "user2-os-lock-wallpaper-456.mp4",
      "user3-os-desktop-wallpaper-789.webm",
      "user4-os-lock-wallpaper-101.mov",
      "user5-profile-avatar-123.webp",
      "unrelated-os-desktop-wallpaper-not-a-timestamp.webp",
      "user6-os-desktop-wallpaper-123.gif",
    ]
    await Promise.all(files.map((name) => writeFile(path.join(directory, name), "fixture")))
    assert.equal(await clearWallpaperUploads(directory), 4)
    assert.deepEqual((await readdir(directory)).sort(), [
      "unrelated-os-desktop-wallpaper-not-a-timestamp.webp",
      "user5-profile-avatar-123.webp",
      "user6-os-desktop-wallpaper-123.gif",
    ].sort())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
