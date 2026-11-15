import test from "node:test"
import assert from "node:assert/strict"
import type { PrismaClient } from "@prisma/client"
import { clearSavedWallpaperPreferences } from "../scripts/clear-saved-wallpaper-preferences"
import { WALLPAPER_DEFAULT_VERSION } from "../src/lib/os-settings"

test("database reset clears every pre-v3 account while preserving future selections", async () => {
  const rows = [
    {
      userId: "legacy",
      value: JSON.stringify({
        wallpaperDefaultVersion: 2,
        desktopWallpaper: "/api/uploads/old-desktop.webp",
        lockWallpaper: "https://example.com/old-lock.mp4",
        workspaces: [{ id: 1, name: "Desktop 1", wallpaper: "/api/uploads/old-workspace.webp" }],
        taskbarAlignment: "left",
      }),
    },
    { userId: "malformed", value: "{broken-json" },
    {
      userId: "new",
      value: JSON.stringify({
        wallpaperDefaultVersion: WALLPAPER_DEFAULT_VERSION,
        desktopWallpaper: "/api/uploads/new-desktop.mp4",
        lockWallpaper: "/api/uploads/new-lock.webp",
      }),
    },
  ]
  const updates: Array<{ where: { userId_key: { userId: string; key: string } }; data: { value: string } }> = []
  const fakeDb = {
    userPreference: {
      findMany: async () => rows,
      update: async (args: typeof updates[number]) => { updates.push(args); return args },
    },
  } as unknown as Pick<PrismaClient, "userPreference">

  assert.equal(await clearSavedWallpaperPreferences(fakeDb), 2)
  assert.deepEqual(updates.map((entry) => entry.where.userId_key.userId), ["legacy", "malformed"])

  const clearedLegacy = JSON.parse(updates[0].data.value)
  assert.equal(clearedLegacy.wallpaperDefaultVersion, WALLPAPER_DEFAULT_VERSION)
  assert.equal(clearedLegacy.desktopWallpaper, "")
  assert.equal(clearedLegacy.lockWallpaper, "")
  assert.deepEqual(clearedLegacy.workspaces.map((workspace: { wallpaper: string }) => workspace.wallpaper), [""])
  assert.equal(clearedLegacy.taskbarAlignment, "left", "Unrelated OS preferences survive")

  const malformed = JSON.parse(updates[1].data.value)
  assert.equal(malformed.desktopWallpaper, "")
  assert.equal(malformed.lockWallpaper, "")
  assert.equal(malformed.wallpaperDefaultVersion, WALLPAPER_DEFAULT_VERSION)
})
