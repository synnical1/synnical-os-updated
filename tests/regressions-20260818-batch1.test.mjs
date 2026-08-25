import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

async function importTs(file) {
  const source = read(file)
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: file,
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
}

test('batch1: adjacent snapped windows can form real snap groups', async () => {
  const mod = await importTs('src/lib/os-batch1.ts')
  const left = { x: 0, y: 0, width: 500, height: 700 }
  const right = { x: 500, y: 0, width: 500, height: 700 }
  assert.equal(mod.rectanglesTouch(left, right), true)
  const peers = mod.findSnapPeers([
    { id: 'left', workspace: 0, minimized: false, ...left },
    { id: 'other-workspace', workspace: 1, minimized: false, ...right },
    { id: 'right', workspace: 0, minimized: false, ...right },
  ], 'left', 0, left)
  assert.deepEqual(peers.map((row) => row.id), ['right'])
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /snap-group/)
  assert.match(shell, /activateSnapGroup/)
  assert.match(shell, /snapTaskbarGroups/)
})

test('batch1: taskbar sizes are real metrics and persisted settings', async () => {
  const mod = await importTs('src/lib/os-batch1.ts')
  assert.ok(mod.TASKBAR_METRICS.small.height < mod.TASKBAR_METRICS.medium.height)
  assert.ok(mod.TASKBAR_METRICS.medium.height < mod.TASKBAR_METRICS.large.height)
  const settings = read('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(settings, /taskbarSize:/)
  assert.match(shell, /TASKBAR_METRICS\[os\.taskbarSize\]/)
  assert.match(shell, /--synnical-taskbar-height/)
})

test('r12: taskbar hover previews are removed while media commands and transfer progress remain', () => {
  const shell = read('src/components/desktop-shell.tsx')
  const music = read('src/components/music-panel.tsx')
  const browser = read('src/components/browser-panel.tsx')
  const api = read('src/lib/api.ts')
  assert.match(shell, /synnical-media-command/)
  assert.match(shell, /synnical-taskbar-progress/)
  assert.doesNotMatch(shell, /TaskbarPreview|previewLater|taskbar-preview/i)
  assert.match(music, /synnical-media-state/)
  assert.match(music, /synnical-media-command/)
  assert.match(browser, /synnical-taskbar-progress/)
  assert.match(browser, /content-length/i)
  assert.match(api, /emitTaskbarProgress\("profile"/)
  assert.match(api, /emitTaskbarProgress\("chat"/)
})

test('batch1: Focus rules, per-app notification priority and history are functional state', async () => {
  const mod = await importTs('src/lib/os-batch1.ts')
  assert.equal(mod.notificationAllowed('off', true, 'normal'), true)
  assert.equal(mod.notificationAllowed('priority', true, 'normal'), false)
  assert.equal(mod.notificationAllowed('priority', true, 'priority'), true)
  assert.equal(mod.notificationAllowed('alarms', true, 'priority'), false)
  assert.equal(mod.notificationAllowed('alarms', true, 'urgent'), true)
  assert.equal(mod.notificationAllowed('off', false, 'urgent'), false)
  const settings = read('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(settings, /notificationRules/)
  assert.match(settings, /notificationHistory/)
  assert.match(settings, /focusSessionMinutes/)
  assert.match(shell, /NOTICE_HISTORY_KEY/)
  assert.match(shell, /startFocusSession/)
  assert.match(shell, /notificationAllowed/)
})

test('batch1: Chat feeds the Synnical notification center instead of only browser notifications', () => {
  const chat = read('src/components/chat-panel.tsx')
  assert.match(chat, /new CustomEvent\("synnical-os-notify"/)
  assert.match(chat, /panel: "chat"/)
  assert.match(chat, /priority: pref\?\.priority \? "priority" : "normal"/)
  assert.match(chat, /hiddenFromView/)
  const browser = read('src/components/browser-panel.tsx')
  const games = read('src/components/games-panel.tsx')
  assert.match(browser, /title: "Download complete"[\s\S]*panel: "browser"/)
  assert.match(games, /panel: "games"/)
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(shell, /panel && panel !== "chat"[\s\S]*setTaskbarBadges/)
})

test('batch1: extra clocks, agenda and desktop clock/calendar widgets are real', () => {
  const settings = read('src/lib/os-settings.ts')
  const shell = read('src/components/desktop-shell.tsx')
  assert.match(settings, /additionalTimeZones/)
  assert.match(settings, /desktopClockWidget/)
  assert.match(settings, /desktopCalendarWidget/)
  assert.match(shell, /loadAgenda/)
  assert.match(shell, /action=scheduled/)
  assert.match(shell, /additionalTimeZones\.map/)
  assert.match(shell, /desktopClockWidget/)
  assert.match(shell, /desktopCalendarWidget/)
})

test('batch1 emergency fix: every staff role is protected from automatic bans', async () => {
  const mod = await importTs('src/lib/moderation-policy.ts')
  for (const role of ['MOD', 'ADMIN', 'HEAD_ADMIN', 'OWNER']) assert.equal(mod.isAutomaticBanExemptRole(role), true, role)
  assert.equal(mod.isAutomaticBanExemptRole('MEMBER'), false)
  const server = read('src/lib/chat-server.ts')
  assert.match(server, /Staff accounts are exempt from automatic bans/)
})

test('batch1 emergency fix: staff moderation has a durable audited unban path', () => {
  const route = read('src/app/api/moderation/unban/route.ts')
  const panel = read('src/components/staff-accounts-panel.tsx')
  const users = read('src/app/api/roles/users/route.ts')
  assert.match(route, /type: \{ in: \["BAN", "AUTO_BAN"\] \}, duration: null/)
  assert.match(route, /bannedIdentity\.deleteMany/)
  assert.match(route, /type: "UNBAN"/)
  assert.match(route, /action: "USER_UNBANNED"/)
  assert.match(panel, /\/api\/moderation\/unban/)
  assert.match(panel, /target\.banned \? <Button[\s\S]*?>Unban<\/Button> : <Button[\s\S]*?>Ban<\/Button>/)
  assert.match(users, /banned:/)
})


test('r12 final release identity is exact', () => {
  const pkg = JSON.parse(read('package.json'))
  const info = read('src/lib/build-info.ts')
  assert.equal(pkg.version, '0.8.0')
  assert.match(info, /synnical-r23-synnical-os-r12-final-20260818/)
})
