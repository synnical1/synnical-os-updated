import test from "node:test"
import assert from "node:assert/strict"
import { mentionNames, messageNotification, parseMentionIds } from "../src/lib/chat-mentions"
import { mayModerate } from "../src/lib/moderation-service"
import { parseModerationCommand } from "../src/lib/bot-moderation"
import { recognitionTags } from "../src/lib/recognition-tags"
import { sanitizeOsSettings, DEFAULT_OS_WALLPAPER } from "../src/lib/os-settings"
import { readFileSync } from "node:fs"
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
test("staff hierarchy excludes cosmetic badges and denies self/equal/higher moderation", () => {
  const roles = ["MEMBER","GOAT","DEV","BETA TESTER","NOTABLE PERSON","MOD","ADMIN","HEAD_ADMIN","OWNER"]
  for (const actor of roles) for (const target of roles) {
    const ranks: Record<string,number> = { OWNER: 5, HEAD_ADMIN: 4, ADMIN: 3, MOD: 2 }
    assert.equal(mayModerate({id:"a",role:actor},{id:"b",role:target}), (ranks[actor]||0) > (ranks[target]||0))
    assert.equal(mayModerate({id:"a",role:actor},{id:"a",role:target}), false)
  }
})
test("Synnbot parses exact targets, bounded durations and rejects malformed commands", () => {
  for (const [token, minutes] of [["15m",15],["2h",120],["1d",1440],["7d",10080]] as const) assert.deepEqual(parseModerationCommand(`@mute @chara ${token}`), { type:"MUTE",username:"chara",durationMin:minutes,reason:"Staff command via Synnbot" })
  assert.equal(parseModerationCommand("hello @mute"), null)
  for (const text of ["@mute", "@mute @chara", "@mute @chara 0m", "@mute @chara 9999d", "@ban @chara 1d"]) assert.throws(() => parseModerationCommand(text))
  for (const action of ["unmute","ban","unban"]) assert.equal(parseModerationCommand(`@${action} @chara reviewed`)?.type, action.toUpperCase())
})
test("mentions match full tokens, never email/substring; notifications require resolved IDs", () => {
  assert.deepEqual(mentionNames("hey @sam, test@sam.com @sammy @sam"), ["sam","sammy"])
  assert.deepEqual(mentionNames("@@sam foo@sam sam@example.com"), [])
  assert.equal(messageNotification({userId:"other"},"sam"),false)
  assert.equal(messageNotification({userId:"other",mentionedUserIds:["sammy"]},"sam"),false)
  assert.equal(messageNotification({userId:"other",mentionedUserIds:["sam"]},"sam"),true)
  assert.equal(messageNotification({userId:"sam",mentionedUserIds:["sam"]},"sam"),false)
  assert.deepEqual(parseMentionIds('{"bad":true}'),[])
})
test("new/default wallpaper migrates retired assets and preserves custom choices", () => {
  assert.equal(DEFAULT_OS_WALLPAPER, "/brand/wallpapers/thorfinn.webp")
  assert.equal(sanitizeOsSettings({}).desktopWallpaper, DEFAULT_OS_WALLPAPER)
  assert.equal(sanitizeOsSettings({desktopWallpaper:"/brand/wallpapers/synnical-static-ink-wallpaper.png"}).desktopWallpaper,DEFAULT_OS_WALLPAPER)
  assert.equal(sanitizeOsSettings({desktopWallpaper:"/api/uploads/custom.webp"}).desktopWallpaper,"/api/uploads/custom.webp")
  assert.equal("enabled" in sanitizeOsSettings({enabled:false}),false)
})
test("recognition badge aliases normalize and never duplicate DEV", () => {
  assert.deepEqual(recognitionTags(["dev","DEV","beta tester","GOAT","Notable Person"]),["DEV","BETA TESTER","GOAT","Notable Person"])
})
test("owner verification is account-rate-limited and secret is not bundled in role settings", () => {
  assert.match(source("src/app/api/owner/verify/route.ts"), /"owner-verify", 5, 15 \* 60_000, user.id/)
  assert.doesNotMatch(source("src/components/account-role-status.tsx"), /OWNER_PASSWORD|process.env/)
  assert.match(source("src/components/account-role-status.tsx"), /autoComplete="new-password"/)
  assert.match(source("src/components/synnical-settings-app.tsx"), /<form id="account-credential-change"/)
  assert.match(source("src/components/synnical-settings-app.tsx"), /name="settings-filter" autoComplete="off"/)
})
test("bot reply detection remains server-backed; SynnVM has no live virtualization endpoint", () => {
  assert.match(source("src/lib/chat-server.ts"), /replyingToSynnBot && text/)
  assert.match(source("src/components/linux-vm-panel.tsx"), /Coming Soon/)
  assert.doesNotMatch(source("src/app/linux-vm/page.tsx"), /NEXT_PUBLIC_SYNN_VM_URL|iframe/)
})
