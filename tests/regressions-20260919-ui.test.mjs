import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("new sessions resolve Light mode before hydration without OLED boot utilities", () => {
  const layout = read("src/app/layout.tsx")
  const page = read("src/app/page.tsx")
  const boot = read("src/app/boot.css")
  const applier = read("src/components/theme-applier.tsx")
  const themes = read("src/lib/themes.ts")
  assert.match(layout, /synnical:settings:appearance\.mode/)
  assert.match(layout, /: 'light'/)
  assert.match(layout, /\.\/boot\.css/)
  assert.match(page, /synnical-boot-stage/)
  assert.doesNotMatch(page, /bg-black\/20|DEFAULT_WALLPAPER/)
  assert.match(boot, /--synnical-boot-bg/)
  assert.match(boot, /:root\[data-appearance="dark"\]/)
  assert.match(applier, /appearance\.mode", "light"/)
  assert.match(themes, /Resolve the final palette before mutating the DOM/)
})

test("desktop windows restore safely against the current viewport", () => {
  const settings = read("src/lib/os-settings.ts")
  const desktop = read("src/components/desktop-shell.tsx")
  assert.match(settings, /restoreWindows: true/)
  assert.match(desktop, /os\.restoreWindows \? fitWindowsToViewport\(readWindows\(\)\) : \[\]/)
  assert.match(desktop, /function fitWindowToViewport/)
  assert.match(desktop, /if \(win\.maximized\)/)
  assert.match(desktop, /window\.visualViewport\?\.addEventListener\("resize", refit\)/)
  assert.doesNotMatch(desktop, /FREE_DESKTOP_MIGRATION_KEY/)
  assert.doesNotMatch(desktop, /window\.localStorage\.removeItem\("synnical:os:windows:v1"\)/)
})

test("oversized GIFs are rejected consistently before upload", async () => {
  const { GIF_UPLOAD_MAX_BYTES, GIF_UPLOAD_MAX_LABEL, gifUploadError } = await import("../src/lib/media-limits.ts")
  assert.equal(GIF_UPLOAD_MAX_BYTES, 10 * 1024 * 1024)
  assert.equal(gifUploadError({ name: "avatar.gif", type: "image/gif", size: GIF_UPLOAD_MAX_BYTES + 1 }), GIF_UPLOAD_MAX_LABEL)
  assert.equal(gifUploadError({ name: "avatar.png", type: "image/png", size: GIF_UPLOAD_MAX_BYTES + 1 }), null)
  assert.match(read("src/app/api/chat/image/upload/route.ts"), /hasGifSignature/)
  assert.match(read("src/app/api/profile/upload/route.ts"), /hasGifSignature/)
})

test("provider-dependent video surfaces remain unavailable until a provider is ready", () => {
  assert.match(read("src/components/app-shell.tsx"), /synnflix-unavailable-panel/)
  for (const path of ["src/components/synnflix-unavailable-panel.tsx", "src/components/synnime-panel.tsx", "src/components/cineb-panel.tsx"]) {
    assert.match(read(path), /UnderConstructionPanel/)
    assert.match(read(path), /reliab|dependable|authorised/i)
  }
})

test("browser tab keeps the requested Google Classroom favicon", () => {
  const layout = read("src/app/layout.tsx")
  assert.match(layout, /\/brand\/google-classroom\.png/)
  assert.doesNotMatch(layout, /icons:\s*\{[\s\S]*\/brand\/rose\.png/)
})

test("theme styles no longer contain the retired OLED force-overrides", () => {
  const css = read("src/app/globals.css")
  assert.doesNotMatch(css, /\.synnical-wallpaper \{ display: none !important; \}/)
  assert.doesNotMatch(css, /\.synnical-shell \[class\*="bg-pink-"\]/)
  assert.doesNotMatch(css, /Primary app surfaces never use glass blur/)
  assert.match(css, /--synnical-page: #edf2f8/)
  assert.match(css, /:root\[data-appearance="dark"\]/)
  assert.match(css, /:root\[data-appearance="dark"\][\s\S]*--synnical-bg: #090d16/)
})
