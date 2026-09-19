import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("new sessions migrate once to Dark before hydration and can still switch to Light", () => {
  const layout = read("src/app/layout.tsx")
  const page = read("src/app/page.tsx")
  const boot = read("src/app/boot.css")
  const applier = read("src/components/theme-applier.tsx")
  const control = read("src/components/appearance-mode-control.tsx")
  const themes = read("src/lib/themes.ts")
  assert.match(layout, /synnical:settings:appearance\.mode/)
  assert.match(layout, /synnical:appearance-dark-default-v1/)
  assert.match(layout, /JSON\.stringify\('dark'\)/)
  assert.match(layout, /mode === 'light' \? 'light' : 'dark'/)
  assert.match(layout, /\.\/boot\.css/)
  assert.match(page, /synnical-boot-stage/)
  assert.doesNotMatch(page, /bg-black\/20|DEFAULT_WALLPAPER/)
  assert.match(boot, /--synnical-boot-bg/)
  assert.match(boot, /:root\[data-appearance="dark"\]/)
  assert.match(applier, /appearance\.mode", "dark"/)
  assert.match(control, /appearance\.mode", "dark"/)
  assert.match(control, /\["light", "dark"\]/)
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


test("SynnFlix exposes one native launcher with no provider-branded duplicate", () => {
  const shell = read("src/components/app-shell.tsx")
  assert.match(shell, /\{ id: "movies", label: "SynnFlix"/)
  assert.doesNotMatch(shell, /SynnFlix CineB/)
  assert.doesNotMatch(shell, /id: "cineb"/)
  assert.doesNotMatch(shell, /target === "cineb"/)
})


test("Music uses dedicated translucent liquid-glass surfaces instead of opaque light-mode utilities", () => {
  const music = read("src/components/music-panel.tsx")
  const css = read("src/app/globals.css")
  assert.match(music, /synnical-music-toolbar/)
  assert.match(music, /synnical-music-search/)
  assert.match(music, /synnical-music-list/)
  assert.match(music, /synnical-music-player/)
  assert.match(music, /synnical-music-track/)
  assert.doesNotMatch(music, /bg-black\/40\/95/)
  assert.match(css, /--synnical-music-glass: color-mix/)
  assert.match(css, /backdrop-filter: blur\(30px\) saturate\(1\.42\)/)
  assert.match(css, /\.synnical-music-track\.is-active/)
})

test("Chat is a core OS app and stale SynnBot controls cannot hide it", () => {
  const registry = read("src/lib/app-registry.ts")
  const shell = read("src/components/app-shell.tsx")
  const owner = read("src/lib/synn-bot-owner.ts")
  assert.match(registry, /CORE_OS_APP_IDS = \["chat"\]/)
  assert.match(shell, /if \(isCoreOsApp\(id\)\) return true/)
  assert.match(shell, /!isCoreOsApp\(target\) && control\?\.maintenance/)
  assert.match(owner, /if \(isCoreOsApp\(app\.id\)\)/)
  assert.match(owner, /core Synnical app/)
})


test("Music search is Audius-native and Home paginates inside a real scroll container", () => {
  const music = read("src/components/music-panel.tsx")
  const server = read("src/lib/music-server.ts")
  const discover = read("src/app/api/music/audius/discover/route.ts")
  const search = read("src/app/api/music/audius/search/route.ts")
  assert.doesNotMatch(music, /Source = "audius" \| "bridge"/)
  assert.match(music, /What do you want to listen to\?/)
  assert.match(music, /fetchAudiusPage/)
  assert.match(music, /loadMoreAudius/)
  assert.match(music, /IntersectionObserver/)
  assert.match(music, /musicScrollRef/)
  assert.match(music, /flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden/)
  assert.match(music, /Quick picks/)
  assert.match(server, /audiusTrending\(limit = 30, offset = 0\)/)
  assert.match(server, /audiusSearch\(query: string, limit = 30, offset = 0\)/)
  assert.match(discover, /nextOffset/)
  assert.match(discover, /hasMore/)
  assert.match(search, /nextOffset/)
  assert.match(search, /hasMore/)
})

test("Appearance theme picker uses the compact theme gallery instead of raw theme cards", () => {
  const settings = read("src/components/synnical-settings-app.tsx")
  assert.match(settings, /function ThemeGallery/)
  assert.match(settings, /Current accent theme/)
  assert.match(settings, /aria-pressed=\{active\}/)
  assert.match(settings, /ThemeGallery activeTheme=\{theme\}/)
  assert.doesNotMatch(settings, /THEMES\.map\(\(item\)=>.*rounded-xl border p-2 text-left transition-colors/)
})

test("Browser no longer advertises LUCIDE and popouts stay inside the Scramjet Browser route", () => {
  const browser = read("src/components/browser-panel.tsx")
  const popout = read("src/app/browser/popout/page.tsx")
  assert.doesNotMatch(browser, /Join LUCIDE Discord|DISCORD_INVITE_URL|DiscordLogo/)
  assert.match(browser, /new URL\("\/browser\/popout", window\.location\.origin\)/)
  assert.match(browser, /target\.searchParams\.set\("url", upstream\)/)
  assert.doesNotMatch(browser, /window\.open\(active\.input/)
  assert.match(popout, /BrowserPanel initialUrl=\{initialUrl\}/)
})

test("Synn Bot purge-all includes bot messages and leaves only an ephemeral acknowledgement", () => {
  const owner = read("src/lib/synn-bot-owner.ts")
  const server = read("src/lib/chat-server.ts")
  assert.match(owner, /purgeAll/)
  assert.match(owner, /including Synn Bot messages/)
  assert.doesNotMatch(owner, /where: \{ channelId: ctx\.channelId, deleted: false, userId: \{ not: null \} \}/)
  assert.match(owner, /ephemeral: true/)
  assert.match(server, /ownerAction\?\.ephemeral/)
  assert.match(server, /bot-command-result/)
})

test("Synn Bot understands natural custom-tag wording including thumbs-up and white glow", () => {
  const owner = read("src/lib/synn-bot-owner.ts")
  const roles = read("src/components/role-ui.tsx")
  const ai = read("src/lib/synn-bot-ai.ts")
  assert.match(owner, /tag\\s+\(\?:called\|named\|that\\s\+says/)
  assert.match(owner, /thumbs\?\\s\*\[- \]\?up/)
  assert.match(roles, /thumbs-up/)
  assert.match(roles, /ThumbsUp/)
  assert.match(roles, /rgba\(255,255,255,.72\)/)
  assert.match(ai, /Your product identity is Synn Bot/)
  assert.match(ai, /Never claim that you are LFM/)
})
