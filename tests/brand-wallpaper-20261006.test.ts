import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { THEMES, applyTheme } from "../src/lib/themes"
import { DEFAULT_OS_WALLPAPER, DEFAULT_OS_WALLPAPER_POSTER, WALLPAPER_DEFAULT_VERSION, sanitizeOsSettings } from "../src/lib/os-settings"
import sharp from "sharp"

const source = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
test("every accent theme resolves OLED surfaces; light palettes and accents survive switches", () => {
  const previous = globalThis.document
  const vars = new Map<string, string>()
  const root = { dataset: {}, style: { colorScheme: "", setProperty: (key: string, value: string) => vars.set(key, value) }, classList: { toggle() {} } }
  Object.assign(globalThis, { document: { documentElement: root } })
  try {
    for (const theme of THEMES) {
      applyTheme(theme.id, "dark")
      for (const key of ["bg", "surface", "surface-2", "page"]) assert.equal(vars.get(`--synnical-${key}`), "#000000", theme.id)
      assert.equal(vars.get("--synnical-accent"), theme.vars["--synnical-accent"])
      applyTheme(theme.id, "light")
      assert.equal(vars.get("--synnical-page"), "#edf2f8")
      assert.equal(vars.get("--synnical-surface"), "#f7faff")
      assert.equal(vars.get("--synnical-accent"), ["synnical", "monochrome"].includes(theme.id) ? "#334155" : theme.vars["--synnical-accent"])
    }
  } finally { Object.assign(globalThis, { document: previous }) }
})

test("wallpaper migration changes old defaults once and preserves deliberate choices/workspace inheritance", () => {
  assert.equal(sanitizeOsSettings({}).desktopWallpaper, DEFAULT_OS_WALLPAPER)
  for (const old of ["thorfinn.webp", "synnical-static-ink-wallpaper.png", "synnical-default-wallpaper.mp4"]) {
    const migrated = sanitizeOsSettings({ desktopWallpaper: `/brand/wallpapers/${old}`, lockWallpaper: `/brand/wallpapers/${old}` })
    assert.equal(migrated.desktopWallpaper, DEFAULT_OS_WALLPAPER)
    assert.equal(migrated.lockWallpaper, DEFAULT_OS_WALLPAPER)
    assert.equal(migrated.wallpaperDefaultVersion, WALLPAPER_DEFAULT_VERSION)
    assert.deepEqual(sanitizeOsSettings(migrated), migrated)
  }
  for (const custom of ["/api/uploads/custom.webp", "https://example.com/custom.webm", "/brand/wallpapers/sakura-samurai-1.png"]) {
    const settings = sanitizeOsSettings({ desktopWallpaper: custom, lockWallpaper: custom, workspaces: [{ id: 1, name: "A", wallpaper: custom }, { id: 2, name: "B", wallpaper: "" }] })
    assert.equal(settings.desktopWallpaper, custom)
    assert.equal(settings.lockWallpaper, custom)
    assert.equal(settings.workspaces[0].wallpaper, custom)
    assert.equal(settings.workspaces[1].wallpaper, "")
    assert.equal(settings.lockUseDesktopWallpaper, true)
  }
  assert.equal(sanitizeOsSettings({ wallpaperDefaultVersion: WALLPAPER_DEFAULT_VERSION, desktopWallpaper: "/brand/wallpapers/thorfinn.webp" }).desktopWallpaper, "/brand/wallpapers/thorfinn.webp")
  for (const path of [DEFAULT_OS_WALLPAPER, DEFAULT_OS_WALLPAPER_POSTER]) assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)))
})

test("layered assets retain neutral whites and intensity detail without an opaque rectangle", async () => {
  for (const variant of ["logo", "mark", "mark-small"]) {
    const base = await sharp(new URL(`../public/brand/synnical/synnical-${variant}-base.webp`, import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const mask = await sharp(new URL(`../public/brand/synnical/synnical-${variant}-accent-mask.png`, import.meta.url).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    assert.equal(base.info.width, mask.info.width)
    assert.equal(base.info.height, mask.info.height)
    const intensities = new Set<number>()
    let white = 0
    let transparent = 0
    for (let i = 3; i < base.data.length; i += 4) {
      if (base.data[i] > 250 && mask.data[i] < 5) white++
      if (base.data[i] === 0 && mask.data[i] === 0) transparent++
      intensities.add(mask.data[i])
    }
    assert.ok(white > 0, `${variant}: white S/wordmark remains separate`)
    assert.ok(transparent > 0, `${variant}: background removed`)
    assert.ok(intensities.size > 50, `${variant}: accent shading is not flat`)
  }
})

test("boot/start/auth share supplied logo, theme CSS and wallpaper; tab cloak remains unchanged", () => {
  const logo = source("src/components/synnical-logo.tsx")
  const css = source("src/app/globals.css")
  const page = source("src/app/page.tsx")
  const desktop = source("src/components/desktop-shell.tsx")
  assert.match(logo, /synnical-.*-base.webp/)
  assert.match(source("src/components/profile-card-preview.tsx"), /data-profile-base=.*DEFAULT_PROFILE_THEME.primary/);
  assert.match(css, /:root\[data-appearance="dark"\] \[data-profile-base="true"\] \{ background:#000000/);
  assert.match(css, /synnical-logo-accent[^}]*var\(--synnical-accent\)/)
  assert.match(page, /<SynnicalLogo variant="logo"/)
  assert.match(page, /<WallpaperVideo src=\{DEFAULT_OS_WALLPAPER\}/)
  assert.match(desktop, /aria-label="Start"><SynnicalLogo small decorative/)
  for (const path of ["src/app/page.tsx", "src/components/desktop-shell.tsx", "src/components/animated-brand-mark.tsx"]) assert.doesNotMatch(source(path), /\/logo.svg|\/brand\/rose.png/)
  assert.match(source("src/components/animated-brand-mark.tsx"), /<SynnicalLogo/)
  const layout = source("src/app/layout.tsx")
  for (const key of ["icon", "shortcut", "apple"]) assert.match(layout, new RegExp(`${key}: "/brand/google-classroom.png"`))
  assert.doesNotMatch(logo, /hue-rotate/)
  const video = source("src/components/wallpaper-video.tsx")
  assert.match(video, /prefers-reduced-motion/)
  assert.match(video, /document.hidden/)
  assert.match(video, /poster=\{poster\}/)
  assert.match(video, /muted loop playsInline preload="metadata"/)
})
