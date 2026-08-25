import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("main batch: Continue Watching is account-backed, episode-aware and resumes with context", () => {
  const flix = read("src/components/synnflix-panel.tsx")
  const desktop = read("src/components/desktop-shell.tsx")
  const settings = read("src/lib/os-settings.ts")
  const media = read("src/app/api/features/media/route.ts")
  assert.match(flix, /function ContinueWatchingRail/)
  assert.match(flix, /Continue Watching/)
  assert.match(flix, /mediaFeatures\?\.progress/)
  assert.match(flix, /RESUME_REWIND_SECONDS = 10/)
  assert.match(flix, /resumeStartSeconds\(row\.currentTime\)/)
  assert.match(flix, /row\.mediaType === "tv"/)
  assert.match(flix, /reset-progress/)
  assert.doesNotMatch(flix, /synnflix\.continue\.v1/)
  assert.doesNotMatch(desktop, /desktopContinueWatchingWidget|synnical-continue-watching|synnflix\.continue\.v1/)
  assert.doesNotMatch(settings, /desktopContinueWatchingWidget:\s*(?:true|false)/)
  assert.match(settings, /delete raw\.desktopContinueWatchingWidget/)
  assert.match(settings, /delete nextWorkspace\["continue-watching"\]/)
  assert.match(flix, /function progressKey\(/)
  assert.match(flix, /writeProgress\(eventPlayer, activeProfile\.id, currentTime\)/)
  assert.match(flix, /mediaAction\("progress"/)
  assert.match(flix, /data\.mediaType \?\? data\.type/)
  assert.match(flix, /legacyTimestampSeconds/)
  assert.match(flix, /return "event" in candidate/)
  assert.match(flix, /previous && typeof previous === "object" \? previous : \{ progress: \[\] \}/)
  assert.match(media, /Math\.max\(existing\?\.currentTime \|\| 0, currentTime\)/)
  assert.match(flix, /const playerUrl = useMemo\(/)
  assert.match(flix, /key=\{`\$\{playerRevision\}:\$\{playerUrl\}`\}/)
})

test("main batch: boot animation runs only on real page entry for 1.5 seconds", () => {
  const page = read("src/app/page.tsx")
  const css = read("src/app/globals.css")
  assert.match(page, /performance\.getEntriesByType\("navigation"\)/)
  assert.match(page, /navigation\?\.type !== "navigate"/)
  assert.match(page, /setTimeout\(\(\) => setBootStage\("done"\), 1500\)/)
  assert.match(page, /function SynnicalBoot/)
  assert.match(css, /@keyframes synnical-boot-mark/)
  assert.match(css, /synnical-boot-exit 1\.5s/)
})

test("main batch: normal desktop boot is neutral but configured startup apps remain", () => {
  const desktop = read("src/components/desktop-shell.tsx")
  assert.doesNotMatch(desktop, /openPanel\(initialPanel\)/)
  assert.doesNotMatch(desktop, /initialPanel\?: Panel/)
  assert.match(desktop, /os\.startupApps/)
  assert.match(desktop, /for \(const \w+ of os\.startupApps\)/)
})

test("main batch: newly launched windows maximize and retain a restore rectangle", () => {
  const desktop = read("src/components/desktop-shell.tsx")
  assert.match(desktop, /const restore = defaultRect\(/)
  assert.match(desktop, /maximized: true, restore/)
  assert.match(desktop, /x: 0, y: 0/)
  assert.match(desktop, /height: Math\.max\(MIN_HEIGHT, window\.innerHeight - taskbarMetric\.height\)/)
})

test("main batch: app launch animation uses existing animation controls and reduced motion", () => {
  const desktop = read("src/components/desktop-shell.tsx")
  const css = read("src/app/globals.css")
  assert.match(desktop, /synnical-window-open/)
  assert.match(css, /@keyframes synnical-window-open/)
  assert.match(css, /--synnical-os-animation-scale/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /synnical-os-no-animations/)
})

test("main batch: profile statistics are independent from friends visibility and use real Message rows", () => {
  const settings = read("src/components/settings-extra-sections.tsx")
  const modal = read("src/components/user-profile-modal.tsx")
  const profileApi = read("src/app/api/profile/[id]/route.ts")
  assert.match(settings, /useLocalSetting<boolean>\("profile\.showStats", true\)/)
  assert.doesNotMatch(settings, /showStats[\s\S]{0,120}profile\.showFriends/)
  assert.match(modal, /readSetting\("profile\.showStats", true\)/)
  assert.match(modal, /showStats && data\.privacy\?\.stats !== false/)
  assert.match(profileApi, /db\.message\.count\(\{ where: \{ userId: target\.id, deleted: false \} \}\)/)
})

test("main batch: profile dialog keeps standard backdrop and Escape dismissal", () => {
  const modal = read("src/components/user-profile-modal.tsx")
  const dialog = read("src/components/ui/dialog.tsx")
  assert.match(modal, /<Dialog open=\{!!userId\} onOpenChange=/)
  assert.match(dialog, /<DialogPrimitive\.Overlay/)
  assert.doesNotMatch(modal, /onPointerDownOutside=.*preventDefault|onEscapeKeyDown=.*preventDefault/)
})

test("main batch: staff badges are compact", () => {
  const roles = read("src/components/role-ui.tsx")
  assert.match(roles, /text-\[8px\]/)
  assert.match(roles, /px-1 py-px/)
  assert.match(roles, /leading-3/)
})

test("main batch: global async failures no longer crash the entire OS shell", () => {
  const errors = read("src/components/error-boundary.tsx")
  const shell = read("src/components/app-shell.tsx")
  assert.match(errors, /window\.addEventListener\("unhandledrejection", onUnhandledRejection\)/)
  assert.match(errors, /window\.dispatchEvent\(new CustomEvent\("synnical-client-error"/)
  const globalHandler = errors.slice(errors.indexOf("export function useGlobalErrorHandler"))
  assert.doesNotMatch(globalHandler, /catchError\(/)
  assert.doesNotMatch(globalHandler, /throw\s+error|throw\s+err/)
  assert.match(shell, /<ErrorBoundary name="Synnical Settings"><SynnicalSettingsApp \/><\/ErrorBoundary>/)
})

test("main batch: Games rejects raw non-JSON responses and preserves game-focus chrome isolation", () => {
  const games = read("src/components/games-panel.tsx")
  const shell = read("src/components/app-shell.tsx")
  assert.match(games, /res\.headers\.get\("content-type"\)/)
  assert.match(games, /Cloud gaming returned an invalid service response/)
  assert.doesNotMatch(games, /text\.slice\(0,\s*240\)/)
  assert.match(games, /responseJson<unknown>\(response, "GAME_CATALOG"\)/)
  assert.match(shell, /const gameFocusVisible = gameFocus && \(panel === "games" \|\| panel === "geforce-now"\)/)
})

test("main batch: connection data remains server/account scoped", () => {
  const connections = read("src/lib/connections.ts")
  const route = read("src/app/api/profile/connections/route.ts")
  const modal = read("src/components/user-profile-modal.tsx")
  assert.match(connections, /fetch\("\/api\/profile\/connections"/)
  assert.match(route, /where: \{ id: me\.id \}/)
  assert.doesNotMatch(modal, /loadConnections\(/)
  assert.match(modal, /const connections = data\?\.connections \|\| \[\]/)
})
