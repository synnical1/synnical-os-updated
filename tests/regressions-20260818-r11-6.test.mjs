import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

test('r11.6: moderation audit values do not recurse primitives into displayValue', () => {
  const source = read('src/components/audit-log-panel.tsx')
  assert.match(source, /const displayValue =/)
  assert.match(source, /typeof value === ["']string["']/)
  assert.doesNotMatch(source, /return displayValue\(String\(value\)\)/)
})

test('r11.6: Settings navigation clears stale search state', () => {
  const source = read('src/components/synnical-settings-app.tsx')
  assert.match(source, /const openLegacy = .*setQuery\(["']["']\)/s)
  assert.match(source, /setQuery\(["']["']\)/)
})

test('r11.6: SynnFlix progress is monotonic and completed replay can reset exact progress', () => {
  const api = read('src/app/api/features/media/route.ts')
  const ui = read('src/components/synnflix-panel.tsx')
  assert.match(api, /action === ["']reset-progress["']/)
  assert.match(api, /Math\.max\(existing\?\.currentTime \|\| 0, currentTime\)/)
  assert.match(api, /Math\.max\(existing\?\.duration \|\| 0, duration\)/)
  assert.match(ui, /Restart from beginning/)
  assert.match(ui, /reset-progress/)
})

test('r11.6: cloud-game verification uses cooldown and no resend loop', () => {
  const source = read('stratus/api.js')
  assert.match(source, /providerVerificationCooldownUntil/)
  assert.match(source, /65_000|65000/)
  assert.doesNotMatch(source, /Resending verification code/)
})

test('r11.6: extension subsystem is absent from runtime, UI and API', () => {
  assert.equal(exists('src/lib/sapphire'), false)
  assert.equal(exists('src/app/api/extensions'), false)
  assert.equal(exists('src/components/extensions-panel.tsx'), false)
  assert.equal(exists('public/controller/sapphire-router.sw.js'), false)
  const browser = read('src/components/browser-panel.tsx')
  const sw = read('public/sw.js')
  const pkg = read('package.json')
  assert.doesNotMatch(browser, /sapphire|chrome-extension|Extensions Panel/i)
  assert.doesNotMatch(sw, /sapphire/i)
  assert.doesNotMatch(pkg, /@x8r\/sapphire/)
})

test('r12: registration keeps the password the user chose and legacy forced migration is disabled', () => {
  const register = read('src/app/api/auth/register/route.ts')
  const auth = read('src/lib/auth.ts')
  const security = read('src/app/api/features/security/route.ts')
  const shell = read('src/components/app-shell.tsx')
  assert.match(register, /securityQuestion/)
  assert.match(register, /securityAnswer/)
  assert.match(register, /securitySetupCompletedAt:\s*new Date\(\)/)
  assert.match(auth, /securitySetupRequired: false/)
  assert.match(security, /mandatory one-time password migration has been removed/i)
  assert.doesNotMatch(shell, /SecuritySetupScreen/)
})

test('r11.6: profile and account stats derive message count from Message rows', () => {
  const profile = read('src/app/api/profile/[id]/route.ts')
  const stats = read('src/app/api/account/stats/route.ts')
  assert.match(profile, /db\.message\.count/)
  assert.match(stats, /db\.message\.count/)
})

test('r11.6: chat message rows are memoized away from composer keypresses', () => {
  const source = read('src/components/chat-panel.tsx')
  assert.match(source, /const renderedMessageRows = useMemo/)
  assert.match(source, /2_800|2800/)
  assert.match(source, /2_000|2000/)
})

test('r11.6: taskbar uses liquid glass and desktop icons use light readable treatment', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const css = read('src/app/globals.css')
  assert.match(shell, /synnical-taskbar/)
  assert.match(shell, /synnical-desktop-app-icon/)
  assert.match(css, /r11\.6 liquid-glass taskbar/)
  assert.match(css, /backdrop-filter:\s*blur\(30px\)/)
})

test('r11.6: wallpaper readability, liquid-glass strength and lock notification privacy are real OS settings', () => {
  const os = read('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  const settings = read('src/components/synnical-settings-app.tsx')
  assert.match(os, /glassStrength: 82/)
  assert.match(os, /wallpaperDim: 0/)
  assert.match(os, /wallpaperBlur: 0/)
  assert.match(os, /wallpaperSaturation: 100/)
  assert.match(os, /lockHideSensitiveNotificationText: true/)
  assert.match(shell, /Content hidden until you sign in/)
  assert.match(shell, /wallpaperBlur/)
  assert.match(settings, /Glass strength/)
  assert.match(settings, /Wallpaper saturation/)
  assert.match(settings, /Hide sensitive text/)
})

test('r11.6: build metadata is bumped', () => {
  const info = read('src/lib/build-info.ts')
  const pkg = JSON.parse(read('package.json'))
  const [major, minor, patch] = pkg.version.split('.').map(Number)
  assert.ok(major > 0 || minor > 7 || (minor === 7 && patch >= 6))
  assert.match(info, /synnical-r23-synnical-os-r12-final-20260818/)
  assert.match(info, /SYNNICAL_VERSION = "0\.8\.0"/)
})
