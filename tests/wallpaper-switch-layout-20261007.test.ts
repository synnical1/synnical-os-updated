import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import sharp from "sharp"
import { OS_DEFAULTS, wallpaperCss } from "../src/lib/os-settings"

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")

test("default fill keeps cover semantics; video, poster and lock surfaces cannot reserve a right gap", () => {
  assert.equal(OS_DEFAULTS.desktopWallpaperFit, "fill")
  assert.equal(wallpaperCss("/brand/example.webp", "fill").backgroundSize, "cover")
  const video = read("src/components/wallpaper-video.tsx")
  assert.match(video, /fit === "fit" \? "contain"/)
  assert.match(video, /fit === "stretch" \? "fill"/)
  assert.match(video, /: "cover"/)
  const shell = read("src/components/desktop-shell.tsx")
  assert.doesNotMatch(shell, /inset-\[-2%\]|h-\[104%\]|w-\[104%\]/)
  assert.match(shell, /synnical-live-wallpaper[^"\n]*inset-0 h-full w-full max-w-none/)
  assert.match(shell, /WallpaperVideo className="[^"\n]*inset-0 h-full w-full max-w-none/)
  assert.match(shell, /wallpaperBleed = os.wallpaperBlur \* 3/, "Only an explicit blur filter needs finite kernel bleed")
  const boot = read("src/app/boot.css")
  assert.match(boot, /synnical-boot-wallpaper[^}]*inset:0; width:100%; height:100%; object-fit:cover/)
})

test("inspected default poster is 16:9 and has no padded black edge", async () => {
  const image = sharp(new URL("../public/brand/wallpapers/synnical-default-wallpaper-poster.webp", import.meta.url).pathname)
  const metadata = await image.metadata()
  assert.equal(metadata.width, 1920); assert.equal(metadata.height, 1080)
  const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  for (const x of [0, info.width - 1]) {
    let nonBlack = 0
    for (let y=0; y<info.height; y++) {
      const offset=(y*info.width+x)*info.channels
      if (Math.max(...data.subarray(offset,offset+3)) > 8) nonBlack++
    }
    assert.ok(nonBlack > info.height * .9, `Poster column ${x} is image content, not padding`)
  }
})

test("Radix and local Settings toggle share the same accessible geometry and theme chrome", () => {
  const settings = read("src/components/synnical-settings-app.tsx")
  assert.match(settings, /return <Switch checked=\{value\} onCheckedChange=\{onChange\} aria-label=\{label\} disabled=\{disabled\}/)
  assert.doesNotMatch(settings, /(?:bg|text|border)-(?:sky|cyan)-/)
  const shared = read("src/components/ui/switch.tsx")
  assert.match(shared, /left-\[2px\] top-\[2px\]/)
  assert.match(shared, /data-\[state=checked\]:translate-x-\[20px\]/)
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
  assert.match(read("scripts/wallpaper-browser-regression.mjs"), /await verifyDesktopLayout/)
  const suite = read("scripts/desktop-layout-regression.mjs")
  for (const size of ["1366,768", "1920,1080", "1440,900", "1280,720"]) assert.ok(suite.includes(size))
  assert.match(suite, /checkRightPixels/)
  assert.match(suite, /Symmetric 3px endpoint inset/)
  assert.match(read(".github/workflows/deploy.yml"), /Verify live desktop rendering/)
})
