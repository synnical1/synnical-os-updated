import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("taskbar keeps its liquid-glass material even in opaque OS mode", () => {
  const css = source("src/app/globals.css")
  const desktop = source("src/components/desktop-shell.tsx")
  assert.match(css, /r13\.1: persistent liquid-glass taskbar/)
  assert.match(css, /backdrop-filter: blur\(42px\) saturate\(225%\) contrast\(112%\) brightness\(1\.10\) !important/)
  assert.match(css, /\.synnical-os-root \.synnical-taskbar-app\.is-active/)
  assert.match(desktop, /className="synnical-taskbar absolute inset-x-0 bottom-0 z-\[50000\]"/)
  assert.doesNotMatch(desktop, /synnical-taskbar-opaque/)
})

test("desktop interactions and system notices stay silent", () => {
  const desktop = source("src/components/desktop-shell.tsx")
  assert.doesNotMatch(desktop, /playTone|uiSoundVolume|Volume2|VolumeX/)
  assert.ok(desktop.includes("setToastNotice(next)"))
})

test("chat sound plays for incoming non-mention messages only", () => {
  const chat = source("src/components/chat-panel.tsx")
  assert.match(chat, /const shouldPlayMessageSound = !fromSelf && !mentionedMe/)
  assert.match(chat, /pref\?\.notificationLevel !== "mute"/)
  assert.match(chat, /pref\?\.notificationLevel !== "mentions"/)
  assert.match(chat, /if \(shouldPlayMessageSound && soundRef\.current\) playMessageSound/)
  assert.match(chat, /<option value="all">All messages<\/option>/)
  const toggleStart = chat.indexOf("const toggleSound = useCallback(() => {")
  const toggleEnd = chat.indexOf("  }, [setSoundEnabled])", toggleStart)
  const toggleChunk = chat.slice(toggleStart, toggleEnd)
  assert.ok(toggleStart >= 0 && toggleEnd > toggleStart)
  assert.ok(toggleChunk.includes("setSoundEnabled(!soundRef.current)"))
  assert.ok(!toggleChunk.includes("playMessageSound"))
  assert.ok(!chat.includes("if (next) playMessageSound()"))
})
