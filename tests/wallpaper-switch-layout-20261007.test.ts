import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { OS_DEFAULTS, wallpaperCss } from "../src/lib/os-settings"

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")

test("static shared default is installed while user-selected videos always play", () => {
  assert.equal(OS_DEFAULTS.desktopWallpaper, "/brand/wallpapers/samurai-blossom.png")
  assert.equal(OS_DEFAULTS.lockWallpaper, "/brand/wallpapers/samurai-blossom.png")
  assert.equal(wallpaperCss("", "fill").backgroundImage, undefined)
  assert.equal(wallpaperCss("/api/uploads/new-wallpaper.webp", "fill").backgroundSize, "cover")
  const video = read("src/components/wallpaper-video.tsx")
  assert.ok(video.includes('fit === "fit" ? "contain"'))
  assert.ok(video.includes('fit === "stretch" ? "fill"'))
  assert.ok(video.includes(': "cover"'))
  assert.ok(video.includes('autoPlay muted loop playsInline preload="auto"'))
  assert.ok(!/prefers-reduced-motion|batterySaver|reduceMotion/.test(video))
  const playback = read("src/lib/wallpaper-playback.ts")
  assert.ok(playback.includes("if (state.hidden) video.pause()"))
  assert.ok(!/battery|performance|reduceMotion/.test(playback))
  const shell = read("src/components/desktop-shell.tsx")
  assert.ok(!shell.includes("paused={os.batterySaver}"))
  assert.ok(shell.includes("synnical-live-wallpaper"))
  assert.ok(shell.includes("WallpaperVideo className="))
  const page = read("src/app/page.tsx")
  assert.ok(page.includes('DEFAULT_OS_WALLPAPER ? <div className="synnical-boot-wallpaper"'))
  const boot = read("src/app/boot.css")
  assert.ok(boot.includes("background-size:cover"))
})
test("Radix and local Settings toggle share the same accessible geometry and theme chrome", () => {
  const settings = read("src/components/synnical-settings-app.tsx")
  assert.match(settings, /return <Switch checked=\{value\} onCheckedChange=\{onChange\} aria-label=\{label\} disabled=\{disabled\}/)
  assert.doesNotMatch(settings, /(?:bg|text|border)-(?:sky|cyan)-/)
  assert.ok(read("src/app/globals.css").includes('[class*="bg-[var(--synnical-surface-2)]"]:not([role="switch"])'), "Legacy surface normalization must not override checked switch accent")
  const shared = read("src/components/ui/switch.tsx")
  assert.match(shared, /left-\[2px\] top-\[2px\]/)
  assert.match(shared, /data-\[state=checked\]:left-\[22px\]/)
  assert.match(shared, /focus-visible:ring-2/)
  assert.match(shared, /disabled:cursor-not-allowed/)
  assert.match(shared, /data-\[state=checked\]:bg-\[var\(--synnical-accent\)\]/)
  // Render the actual Radix component in a normal React environment (the main test
  // command uses react-server conditions for server-only security tests).
  const html = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {Switch} from './src/components/ui/switch.tsx';
    console.log(JSON.stringify([false,true].map(checked => renderToStaticMarkup(React.createElement(Switch,{checked,disabled:true,'aria-label':'Geometry test'})))))
  `], { encoding:"utf8" })
  const states = JSON.parse(html.trim()) as string[]
  for (const [i, markup] of states.entries()) {
    assert.match(markup, /role="switch"/); assert.match(markup, /aria-label="Geometry test"/)
    assert.ok(markup.includes(`aria-checked="${Boolean(i)}"`)); assert.match(markup, / disabled=""/)
    assert.match(markup, /data-slot="switch-thumb"/)
  }
})

test("real browser regression is wired into smoke and post-deployment visual checks", () => {
  assert.match(read("scripts/desktop-browser-regression.mjs"), /await verifyDesktopLayout/)
  const suite = read("scripts/desktop-layout-regression.mjs")
  for (const size of ["1366,768", "1920,1080", "1440,900", "1280,720"]) assert.ok(suite.includes(size))
  assert.match(suite, /Symmetric 3px endpoint inset/)
  assert.match(read(".github/workflows/deploy.yml"), /Verify live desktop rendering/)
})
