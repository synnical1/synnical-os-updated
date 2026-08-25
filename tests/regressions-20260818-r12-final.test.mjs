import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

async function importTs(file) {
  const source = read(file)
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: file,
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

test('r12 final: forced one-time password migration is gone', () => {
  const auth = read('src/lib/auth.ts')
  const shell = read('src/components/app-shell.tsx')
  const security = read('src/app/api/features/security/route.ts')
  const register = read('src/app/api/auth/register/route.ts')
  assert.match(auth, /securitySetupRequired: false/)
  assert.doesNotMatch(shell, /SecuritySetupScreen/)
  assert.equal(exists('src/components/security-setup-screen.tsx'), false)
  assert.match(security, /mandatory one-time password migration has been removed/i)
  assert.match(register, /securitySetupCompletedAt:\s*new Date\(\)/)
  assert.match(register, /securityQuestion/)
  assert.match(register, /securityAnswer/)
})

test('r12 final: taskbar hover preview windows are removed globally', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.doesNotMatch(shell, /TaskbarPreview|previewLater|taskbarPreview|taskbar-preview/i)
  assert.match(shell, /synnical-taskbar-app/)
  assert.match(shell, /synnical-media-command/)
})

test('r12 final: desktop labels are plain readable text rather than permanent dark pills', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /\[text-shadow:/)
  assert.doesNotMatch(shell, /desktop-label[^\n]*bg-black\/45/i)
})

test('r12 final: window chrome has real minimize maximize restore and close controls', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /aria-label="Minimize"/)
  assert.match(shell, /aria-label=\{win\.maximized \? "Restore" : "Maximize"\}/)
  assert.match(shell, /aria-label="Close"/)
  assert.match(shell, /#c42b1c/)
  assert.match(shell, /win\.maximized[\s\S]*border-[lrtb]/)
})

test('r12 final: GeForce NOW owns Synnical input while immersive and uses Keyboard Lock when available', () => {
  const browser = read('src/components/browser-panel.tsx')
  const geforce = read('src/components/geforce-now-panel.tsx')
  const shell = read('src/components/desktop-shell.tsx')
  const appShell = read('src/components/app-shell.tsx')
  assert.match(geforce, /immersiveGame/)
  assert.match(browser, /navigator[\s\S]*keyboard[\s\S]*lock/)
  assert.match(browser, /synnical-game-focus/)
  assert.match(browser, /Release controls/)
  assert.match(shell, /dataset\.synnicalGameFocus === "1"/)
  assert.match(appShell, /panel === "games" \|\| panel === "geforce-now"/)
})

test('r12 final: Browser address typing stays local until navigation', () => {
  const browser = read('src/components/browser-panel.tsx')
  assert.match(browser, /function BrowserAddressInput/)
  assert.match(browser, /const \[value, setValue\] = useState/)
  assert.match(browser, /onNavigate\(value\)/)
  assert.doesNotMatch(browser, /onChange=\{\(e\) => updateTab\(active\.id, \{ input:/)
})

test('r12 final: Chat composer does not drive the whole panel on every keystroke', () => {
  const chat = read('src/components/chat-panel.tsx')
  assert.match(chat, /draftRef/)
  assert.match(chat, /draftRef\.current/)
  assert.match(chat, /draftSyncTimerRef/)
  assert.doesNotMatch(chat, /value=\{draft\}\s+onChange=\{\(e\)\s*=>\s*setDraft/)
})

test('r12 final: SynnFlix follows provider episode identity and feeds durable Continue Watching', () => {
  const flix = read('src/components/synnflix-panel.tsx')
  const media = read('src/app/api/features/media/route.ts')
  assert.match(flix, /trackedPlayerRef/)
  assert.match(flix, /const eventSeason = Number\(data\.season\)/)
  assert.match(flix, /const eventEpisode = Number\(data\.episode\)/)
  assert.match(flix, /eventPlayer = \{/)
  assert.match(flix, /writeProgress\(eventPlayer, currentTime\)/)
  assert.match(flix, /featureApi\.media\.action\("progress"/)
  assert.match(media, /Math\.max\(existing\?\.currentTime \|\| 0, currentTime\)/)
  assert.match(flix, /ContinueWatchingRail/)
  assert.match(flix, /continueWatching/)
  assert.match(flix, /resumeStartSeconds/)
  assert.doesNotMatch(flix, /synnical-continue-watching-changed|synnical-synnflix-resume|storeContinueWatching/)
})

test('r12 final: workspaces and desktop layouts are dynamic persisted models', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const sanitized = settings.sanitizeOsSettings({
    workspaces: [{ id: 8, name: 'Gaming', wallpaper: '' }],
    desktopLayouts: { '8': { order: ['games'], hidden: [], labels: {}, customIcons: {}, positions: {}, folders: [] } },
  })
  assert.equal(sanitized.workspaces[0].name, 'Gaming')
  assert.deepEqual(sanitized.desktopLayouts['8'].order, ['games'])
  assert.match(shell, /createWorkspace/)
  assert.match(shell, /removeWorkspace/)
  assert.match(shell, /renameWorkspace/)
  assert.match(shell, /text\/synnical-window/)
  assert.match(shell, /workspace:\s*desktop\.id/)
  assert.match(shell, /createDesktopFolder/)
})

test('r12 final: widgets use live Synnical sources and persist layout', () => {
  const settings = read('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const chat = read('src/components/chat-panel.tsx')
  const games = read('src/components/games-panel.tsx')
  assert.match(settings, /widgetLayouts/)
  assert.match(shell, /DesktopWidgetCard/)
  assert.doesNotMatch(shell, /desktopContinueWatchingWidget/)
  assert.match(shell, /desktopCreditsWidget/)
  assert.match(chat, /synnical-chat-online-users/)
  assert.match(games, /synnical-recent-games-changed/)
})

test('r12 final: focused window clicks and pointer moves avoid React/localStorage churn', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /if \(win\.z !== maxZ \|\| win\.minimized\) focusWindow/)
  assert.match(shell, /element\.style\.left/)
  assert.match(shell, /element\.style\.top/)
  assert.match(shell, /element\.style\.width/)
  assert.match(shell, /element\.style\.height/)
})

test('r12 final: Files has a real screenshot Recycle Bin with restore rename and purge', () => {
  const schema = read('prisma/schema.prisma')
  const api = read('src/app/api/features/games/screenshot/[id]/route.ts')
  const gamesApi = read('src/app/api/features/games/route.ts')
  const files = read('src/components/synnical-files-panel.tsx')
  assert.match(schema, /deletedAt\s+DateTime\?/)
  assert.match(schema, /name\s+String\?/)
  assert.match(api, /action === "restore"/)
  assert.match(api, /action === "rename"/)
  assert.match(api, /action !== "purge"/)
  assert.match(gamesApi, /recycleScreenshots/)
  assert.match(gamesApi, /deletedAt: new Date\(\)/)
  assert.match(files, /Move to Recycle Bin/)
  assert.match(files, /Delete permanently/)
  assert.match(files, /Restore/)
})

test('r12 final: live wallpapers slideshow and window presentation controls are real settings', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const wallpaper = read('src/app/api/features/os/wallpaper/route.ts')
  const uploads = read('src/app/api/uploads/[...path]/route.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const sanitized = settings.sanitizeOsSettings({ wallpaperSlideshow: true, wallpaperShuffle: true, wallpaperSlideshowMinutes: 5, animationSpeed: 130, windowTransparency: 88, windowCornerRadius: 0 })
  assert.equal(sanitized.wallpaperSlideshow, true)
  assert.equal(sanitized.wallpaperSlideshowMinutes, 5)
  assert.equal(sanitized.windowTransparency, 88)
  assert.equal(sanitized.windowCornerRadius, 0)
  assert.match(wallpaper, /video\/mp4/)
  assert.match(uploads, /"\.mp4": "video\/mp4"/)
  assert.match(shell, /desktopWallpaperIsVideo/)
  assert.match(shell, /wallpaperSlideIndex/)
})

test('r12 final: startup apps and portable OS settings backups are functional', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const app = read('src/components/synnical-settings-app.tsx')
  const sanitized = settings.sanitizeOsSettings({ startupApps: ['chat', 'browser', '../bad'] })
  assert.deepEqual(sanitized.startupApps, ['chat', 'browser'])
  assert.match(shell, /startupAppliedRef/)
  assert.match(shell, /for \(const raw of os\.startupApps\)/)
  assert.match(app, /synnical-os-settings-v1/)
  assert.match(app, /sanitizeOsSettings\(parsed\.settings\)/)
})

test('r12 final: auto-lock, Run and real Synnical Task Manager are wired', () => {
  const settings = read('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(settings, /autoLockMinutes/)
  assert.match(shell, /os\.autoLockMinutes \* 60_000/)
  assert.match(shell, /setRunOpen\(true\)/)
  assert.match(shell, /Task Manager/)
  assert.match(shell, /performance as any\)\.memory/)
  assert.match(shell, /End task/)
})

test('r12 final: release identity is 0.8.0 r12 final', () => {
  const pkg = JSON.parse(read('package.json'))
  const info = read('src/lib/build-info.ts')
  assert.equal(pkg.version, '0.8.0')
  assert.match(info, /synnical-r23-synnical-os-r12-final-20260818/)
})

test('r12 final: optional PIN unlock is secure and never replaces password sign-in', () => {
  const schema = read('prisma/schema.prisma')
  const security = read('src/app/api/features/security/route.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const ui = read('src/components/r7-settings.tsx')
  assert.match(schema, /lockPinHash\s+String\?/)
  assert.match(security, /action === "set-lock-pin"/)
  assert.match(security, /hashPassword\(pin\)/)
  assert.match(security, /action === "verify-pin"/)
  assert.match(security, /Too many PIN attempts/)
  assert.match(ui, /Optional lock-screen PIN/)
  assert.match(ui, /Enter your account password first/)
  assert.match(shell, /unlockMode === "pin"/)
  assert.match(shell, /action: "verify-password"/)
  assert.match(shell, /action: "verify-pin"/)
})

test('r12 final: OS global shortcuts are editable persisted and suppressed during games', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const ui = read('src/components/settings-panel.tsx')
  const sanitized = settings.sanitizeOsSettings({ shortcuts: { run: 'Ctrl+Shift+R', taskManager: 'Alt+T' } })
  assert.equal(sanitized.shortcuts.run, 'Ctrl+Shift+R')
  assert.equal(sanitized.shortcuts.taskManager, 'Alt+T')
  assert.match(shell, /shortcutMatches\(event, os\.shortcuts\.run\)/)
  assert.match(shell, /gameInputCaptured \|\| document\.documentElement\.dataset\.synnicalGameFocus/)
  assert.match(ui, /Custom global shortcuts for Synnical OS/)
  assert.match(ui, /persistOsSettings\(next\)/)
  assert.match(ui, /already assigned/)
})

test('r12 final: Weather cursor and editable Quick Settings are live OS behavior', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const app = read('src/components/synnical-settings-app.tsx')
  const sanitized = settings.sanitizeOsSettings({ widgetDefaultsVersion: 1, desktopWeatherWidget: true, cursorTheme: 'dark', cursorSize: 140, quickSettingsOrder: ['night','wifi'] })
  assert.equal(sanitized.desktopWeatherWidget, true)
  assert.equal(sanitized.cursorTheme, 'dark')
  assert.equal(sanitized.cursorSize, 140)
  assert.equal(sanitized.quickSettingsOrder[0], 'night')
  assert.match(shell, /navigator\.geolocation\.getCurrentPosition/)
  assert.match(shell, /api\.open-meteo\.com/)
  assert.match(shell, /quickSettingsOrder/)
  assert.match(shell, /synnical-media-command/)
  assert.match(app, /Cursor/)
})

test('r12 final: Safe Mode Recovery and compact always-on-top windows are functional', () => {
  const appShell = read('src/components/app-shell.tsx')
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(appShell, /SAFE_MODE_APPS/)
  assert.match(appShell, /URLSearchParams\(window\.location\.search\)\.get\("safe"\)/)
  assert.match(appShell, /URLSearchParams\(window\.location\.search\)\.get\("recover"\)/)
  assert.match(appShell, /Reset local OS preferences/)
  assert.match(shell, /alwaysOnTop/)
  assert.match(shell, /toggleAlwaysOnTop/)
  assert.match(shell, /Mini player size/)
  assert.match(shell, /Compact chat size/)
})

test('r12 final: Capture uses browser permissioned screenshot and recording APIs', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /Synnical Capture/)
  assert.match(shell, /getDisplayMedia/)
  assert.match(shell, /canvas\.toBlob/)
  assert.match(shell, /new MediaRecorder/)
  assert.match(shell, /Stop & save recording/)
  assert.match(shell, /ClipboardItem/)
})

test('r12 final: Files can pin locations and ZIP Synnical-owned screenshots', () => {
  const files = read('src/components/synnical-files-panel.tsx')
  assert.match(files, /from "jszip"/)
  assert.match(files, /archiveSelectedScreenshots/)
  assert.match(files, /generateAsync/)
  assert.match(files, /synnical:files:favorites:v1/)
  assert.match(files, /Quick access/)
})

test('r12 final: Start understands aliases and can hand a query to unified Synnical search', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const discovery = read('src/components/discovery-panel.tsx')
  assert.match(shell, /films.*synnflix/i)
  assert.match(shell, /Search all Synnical/)
  assert.match(shell, /synnical-global-search/)
  assert.match(discovery, /synnical-global-search/)
  assert.match(discovery, /api\/features\/search/)
})

test('r12 final: lock screen media status and slideshow preferences have real consumers', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const music = read('src/components/music-panel.tsx')
  const sanitized = settings.sanitizeOsSettings({ lockShowMedia: true, lockShowStatus: true, lockWallpaperSlideshow: true })
  assert.equal(sanitized.lockShowMedia, true)
  assert.equal(sanitized.lockShowStatus, true)
  assert.equal(sanitized.lockWallpaperSlideshow, true)
  assert.match(shell, /os\.lockShowMedia/)
  assert.match(shell, /os\.lockShowStatus/)
  assert.match(shell, /os\.lockWallpaperSlideshow/)
  assert.match(shell, /state!\.artwork/)
  assert.match(music, /artwork/)
})

test('r12 final: accessibility color filters transparency zoom and captions affect runtime CSS', () => {
  const runtime = read('src/lib/settings-runtime.ts')
  const ui = read('src/components/settings-panel.tsx')
  const css = read('src/app/globals.css')
  assert.match(runtime, /a11y\.colorFilter/)
  assert.match(runtime, /a11y\.reduceTransparency/)
  assert.match(runtime, /a11y\.captionScale/)
  assert.match(runtime, /interfaceZoom.*200/s)
  assert.match(ui, /Color Filter/)
  assert.match(ui, /Reduced Transparency/)
  assert.match(ui, /Caption Background/)
  assert.match(css, /video::cue/)
  assert.match(css, /data-synnical-color-filter/)
})

test('r12 final: Browser suspends expensive hidden frames and restores them on activation', () => {
  const browser = read('src/components/browser-panel.tsx')
  assert.match(browser, /tabLastActiveRef/)
  assert.match(browser, /90_000/)
  assert.match(browser, /180_000/)
  assert.match(browser, /remove\(\)/)
  assert.match(browser, /ensureFrame/)
  assert.match(browser, /splitTabId/)
})

test('r12 final: clipboard history can pin entries and clear only unpinned history', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /setClipboardPinned/)
  assert.match(shell, /clearUnpinnedClipboardHistory/)
  assert.match(shell, /Pinned ·/)
  assert.match(shell, /Unpin clipboard item/)
})

test('r12 final: Chat socket listeners clean up only their own handlers and typing timers', () => {
  const chat = read('src/components/chat-panel.tsx')
  assert.match(chat, /socket\.off\("message", onMessage\)/)
  assert.match(chat, /socket\.off\("typing", onTyping\)/)
  assert.doesNotMatch(chat, /socket\.off\("message"\)\s*$/m)
  assert.doesNotMatch(chat, /socket\.off\("typing"\)\s*$/m)
  assert.match(chat, /typingExpiryTimersRef/)
  assert.match(chat, /typingExpiryTimersRef\.current\.clear\(\)/)
})

test('r12 final: touch keyboard has local themes and real browser voice typing', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const css = read('src/app/globals.css')
  assert.match(shell, /webkitSpeechRecognition/)
  assert.match(shell, /Voice typing/)
  assert.match(shell, /a11y\.keyboardTheme/)
  assert.match(shell, /data-keyboard-theme/)
  assert.match(css, /data-keyboard-theme="light"/)
})

test('r12 final: Start folders and optional search history are persistent real state', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const ui = read('src/components/synnical-settings-app.tsx')
  const sanitized = settings.sanitizeOsSettings({ startSearchHistory: false, startFolders: [{ id: 'games', name: 'Gaming', apps: ['games','geforce-now'] }] })
  assert.equal(sanitized.startSearchHistory, false)
  assert.deepEqual(sanitized.startFolders[0].apps, ['games','geforce-now'])
  assert.match(shell, /createStartFolder/)
  assert.match(shell, /addAppToStartFolder/)
  assert.match(shell, /START_SEARCH_HISTORY_KEY/)
  assert.match(ui, /Search history/)
})

test('r12 final: app maintenance library and settings restore points are functional', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const ui = read('src/components/synnical-settings-app.tsx')
  const sanitized = settings.sanitizeOsSettings({ hiddenLauncherApps: ['browser','music'] })
  assert.deepEqual(sanitized.hiddenLauncherApps, ['browser','music'])
  assert.match(ui, /App maintenance/)
  assert.match(ui, /Clear cache/)
  assert.match(ui, /Repair \/ restart app/)
  assert.match(ui, /First-party app library/)
  assert.match(ui, /settings-snapshots:v1/)
  assert.match(ui, /createSettingsSnapshot/)
  assert.match(ui, /restoreSettingsSnapshot/)
  assert.match(shell, /synnical-repair-panel/)
  assert.match(shell, /hiddenLauncherApps/)
})

test('r12 final: Whats New and update history are real installed-build surfaces', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const settings = read('src/components/synnical-settings-app.tsx')
  assert.match(shell, /last-seen-build:v1/)
  assert.match(shell, /What's new in Synnical OS/)
  assert.match(settings, /What's New/)
  assert.match(settings, /Update history/)
  assert.match(settings, /0\.8\.0 · r12 Final/)
})

test('r12 final: Files Recycle Bin auto-clean and F2 rename are real behaviors', () => {
  const files = read('src/components/synnical-files-panel.tsx')
  assert.match(files, /recycle-autoclean-days:v1/)
  assert.match(files, /recycleAutoCleanDays/)
  assert.match(files, /expired=recycleScreenshots\.filter/)
  assert.match(files, /event\.key!=="F2"/)
  assert.match(files, /renameSelected/)
})

test('r12 final: live wallpapers pause under Battery Saver or automatic low-end mode', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const runtime = read('src/lib/settings-runtime.ts')
  assert.match(shell, /desktopVideoRef/)
  assert.match(shell, /os\.batterySaver\|\|root\.classList\.contains\("synnical-perf-mode"\)/)
  assert.match(shell, /video\.pause\(\)/)
  assert.match(runtime, /adaptiveLowEndDetected/)
  assert.match(runtime, /synnical-perf-mode/)
})

test('r12 final: Capture posts notifications through the real pushNotice signature', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /pushNotice\("Screenshot copied", "Paste it into a supported Chat attachment field or another app\.", undefined, "normal"\)/)
  assert.doesNotMatch(shell, /pushNotice\(\{[^)]*Screenshot copied/s)
})

test('r12 final: Quick Settings includes a real persisted theme control', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const sanitized = settings.sanitizeOsSettings({ quickSettingsOrder: ['theme','wifi'] })
  assert.equal(sanitized.quickSettingsOrder[0], 'theme')
  assert.match(shell, /useBrowser\(\(state\) => state\.theme\)/)
  assert.match(shell, /id:"theme"/)
  assert.match(shell, /setTheme\(themes\[\(index\+1\)%themes\.length\]\)/)
})

test('r12 final: Quick Settings presence control persists through the real presence API and bridge', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const bridge = read('src/components/presence-bridge.tsx')
  const sanitized = settings.sanitizeOsSettings({ quickSettingsOrder: ['presence','theme'] })
  assert.equal(sanitized.quickSettingsOrder[0], 'presence')
  assert.match(shell, /cycleQuickPresence/)
  assert.match(shell, /fetch\("\/api\/features\/presence"/)
  assert.match(shell, /synnical-presence-config-changed/)
  assert.match(shell, /id:"presence"/)
  assert.match(bridge, /synnical-presence-config-changed/)
  assert.match(bridge, /presence-update/)
})

test('r12 final: Synnical media capture exposes tray privacy indicators and local history', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const calls = read('src/components/calls-panel.tsx')
  const voice = read('src/components/voice-recorder.tsx')
  const usage = read('src/lib/media-usage.ts')
  assert.match(usage, /synnical-media-usage/)
  assert.match(shell, /PRIVACY_HISTORY_KEY/)
  assert.match(shell, /Privacy indicators/)
  assert.match(shell, /Synnical microphone in use/)
  assert.match(shell, /announceMediaUsage\("capture", \{ screen:true \}\)/)
  assert.match(calls, /announceMediaUsage\("calls", \{ microphone:true, camera:kind === "video" \}\)/)
  assert.match(voice, /announceMediaUsage\("voice-message", \{ microphone:true \}\)/)
})

test('r12 final: battery-aware effect reduction is automatic without overwriting saved Battery Saver', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const css = read('src/app/globals.css')
  assert.match(shell, /system\.batterySupported && system\.batteryLevel !== null && system\.charging === false && system\.batteryLevel <= 20/)
  assert.match(shell, /synnical-battery-perf/)
  assert.match(shell, /synnicalBatteryPerf/)
  assert.match(css, /\.synnical-battery-perf \*/)
  assert.doesNotMatch(shell, /persistOsSettings\([^\n]*synnicalBatteryPerf/)
})

test('r12 final: Friends DM socket cleanup removes only its own handlers', () => {
  const friends = read('src/components/friends-panel.tsx')
  assert.match(friends, /socket\.off\("message-history", onHistory\)/)
  assert.match(friends, /socket\.off\("message", onMessage\)/)
  assert.match(friends, /socket\.off\("message-deleted", onDeleted\)/)
  assert.doesNotMatch(friends, /socket\.off\("message"\)\s*;?/)
})


test('r12 hotfix2: desktop widgets are opt-in and old default-on widget state is migrated off once', async () => {
  const settings = await importTs('src/lib/os-settings.ts')
  const defaults = settings.OS_DEFAULTS
  for (const key of ['desktopClockWidget','desktopWeatherWidget','desktopCalendarWidget','desktopRecentGamesWidget','desktopFriendsWidget','desktopCreditsWidget','desktopPinnedChatWidget']) {
    assert.equal(defaults[key], false, `${key} must default off`)
  }
  const migrated = settings.sanitizeOsSettings({ desktopClockWidget: true, desktopCalendarWidget: true, desktopCreditsWidget: true })
  assert.equal(migrated.widgetDefaultsVersion, 1)
  assert.equal(migrated.desktopClockWidget, false)
  assert.equal(migrated.desktopCalendarWidget, false)
  assert.equal(migrated.desktopCreditsWidget, false)
  const explicit = settings.sanitizeOsSettings({ widgetDefaultsVersion: 1, desktopClockWidget: true })
  assert.equal(explicit.desktopClockWidget, true)
})

test('r12 hotfix2: widget dragging/resizing commits only real layout gestures and clamps cards to the viewport', () => {
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /const resize = useRef/)
  assert.match(shell, /Resize .* widget/)
  assert.doesNotMatch(shell, /resize: "both"/)
  assert.doesNotMatch(shell, /onPointerUp=\{commit\}/)
  assert.match(shell, /const columns = viewportWidth >=/)
  assert.match(shell, /x: clamp\(saved\.x/)
  assert.match(shell, /y: clamp\(saved\.y/)
})

test('r12 hotfix2: SynnFlix accepts trusted Vidking PLAYER_EVENT messages from nested player frames and treats progress as percent', () => {
  const panel = read('src/components/synnflix-panel.tsx')
  assert.doesNotMatch(panel, /event\.source !== playerFrameRef\.current\?\.contentWindow/)
  assert.doesNotMatch(panel, /host === "vidking\.net" \|\| host\.endsWith\("\.vidking\.net"\)/)
  assert.match(panel, /if \(event\.source === window\) return/)
  assert.match(panel, /String\(data\.id \?\? ""\) !== String\(player\.media\.id\)/)
  assert.match(panel, /progressPercent/)
  assert.match(panel, /duration \* \(progressPercent \/ 100\)/)
  assert.match(panel, /envelope\.type === "PLAYER_EVENT"/)
})
