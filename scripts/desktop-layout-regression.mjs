import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export async function verifyAuthenticatedLock({ authenticated, evaluate, wait, checkSurface, capture }) {
  if (!authenticated) return "UNVERIFIED: authenticated account required"
  await evaluate("window.dispatchEvent(new CustomEvent('synnical-os-lock')); true")
  await wait("Boolean(document.querySelector('.synnical-os-lock'))")
  await checkSurface(".synnical-os-lock")
  await capture("lock-1366x768")
  return "passed"
}

/** Public production checks use a fresh guest profile; authenticated checks
 * use only the existing disposable, loopback CI fixture. */
export async function verifyDesktopLayout({ command, evaluate, sessionId, authenticated = false }) {
  const wait = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    assert.fail(`Layout did not become ready: ${expression}`)
  }
  const click = async (selector, text) => {
    const expression = `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`
    assert.ok(await evaluate(expression), `Missing UI control: ${text}`)
    await delay(250)
  }
  const evidenceDir = process.env.SYNNICAL_LAYOUT_EVIDENCE_DIR
  const capture = async name => {
    const { data } = await command("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId)
    const bytes = Buffer.from(data, "base64")
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true })
      await writeFile(path.join(evidenceDir, `${name}.png`), bytes)
    }
    return bytes
  }
  const surface = selector => `(() => { const root = document.querySelector(${JSON.stringify(selector)}); if (!root) return null; const rect = root.getBoundingClientRect(); const style=getComputedStyle(root); return { rect:rect.toJSON(), background:style.backgroundColor, backgroundImage:style.backgroundImage, width:innerWidth, height:innerHeight, wallpaper:Boolean(document.querySelector(".synnical-live-wallpaper, .synnical-boot-wallpaper, .synnical-os-lock video")) } })()`
  const checkSurface = async selector => {
    const s = await evaluate(surface(selector))
    assert.ok(s, selector)
    assert.equal(s.wallpaper, false, "No retired wallpaper may remain visible")
    if (selector === ".synnical-os-lock") assert.equal(s.background, "rgb(0, 0, 0)", "The lock screen uses a clean black surface")
    else assert.notEqual(s.background, "rgba(0, 0, 0, 0)", "Desktop keeps its theme's solid page surface")
    assert.equal(s.backgroundImage, "none", "The desktop/lock surface has no background image")
    assert.ok(Math.abs(s.rect.left) <= 0.5 && Math.abs(s.rect.top) <= 0.5, "Surface starts at viewport origin")
    assert.ok(s.rect.right >= s.width - 0.5 && s.rect.bottom >= s.height - 0.5, "Surface covers the viewport")
    return s
  }
  const measurements = []
  for (const [width, height] of [[1366,768], [1920,1080], [1440,900], [1280,720]]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId)
    await delay(150)
    const s = await checkSurface(".synnical-os-root")
    assert.equal(s.width, width); assert.equal(s.height, height)
    await capture(`desktop-${width}x${height}`)
    measurements.push({ surface: "desktop", width, height, right: s.rect.right })
  }
  await command("Emulation.setDeviceMetricsOverride", { width:1366, height:768, deviceScaleFactor:1, mobile:false }, sessionId)
  if (authenticated) {
  // The app's public launch event opens Settings without relying on desktop icon availability.
  await evaluate(`window.dispatchEvent(new CustomEvent('synnical-open-panel', {detail:{panel:'settings'}})); true`)
  await wait(`Boolean(document.querySelector('.synnical-settings-app [aria-label="Auto fullscreen"]'))`)
  // Disable automatic fullscreen only within this disposable guest profile.
  await evaluate(`(() => { const b=document.querySelector('[aria-label="Auto fullscreen"]'); if(b.getAttribute('aria-checked')==='true') b.click(); return true })()`)
  await delay(250)
  const checkSwitch = async selector => {
    const s = await evaluate(`(() => { const b=document.querySelector(${JSON.stringify(selector)}); if(!b)return null; const t=b.querySelector('[data-slot="switch-thumb"]'); const r=b.getBoundingClientRect(), q=t.getBoundingClientRect(); const c=getComputedStyle(b); const probe=document.createElement('span'); probe.style.color='var(--synnical-accent)'; b.append(probe); const accent=getComputedStyle(probe).color; probe.remove(); return {checked:b.getAttribute('aria-checked'),role:b.getAttribute('role'),width:r.width,height:r.height,left:q.left-r.left,right:r.right-q.right,top:q.top-r.top,bottom:r.bottom-q.bottom,thumb:q.width,color:c.backgroundColor,accent} })()`)
    assert.ok(s, selector); assert.equal(s.role, "switch")
    assert.equal(s.width, 40); assert.equal(s.height, 20); assert.equal(s.thumb, 14)
    for (const edge of ["left", "right", "top", "bottom"]) assert.ok(s[edge] >= 2.5, `${selector} ${edge} contains thumb`)
    assert.ok(Math.abs(s.top - 3) < .5 && Math.abs(s.bottom - 3) < .5)
    assert.ok(Math.abs(s[s.checked === "true" ? "right" : "left"] - 3) < .5, "Symmetric 3px endpoint inset")
    if (s.checked === "true") assert.equal(s.color, s.accent, "Checked track follows active theme accent")
    return s
  }
  const exerciseSwitch = async selector => {
    for (let i=0; i<2; i++) {
      await checkSwitch(selector)
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`)
      await delay(250)
    }
  }
  for (const theme of ["Blood", "Synnical", "Forest"]) {
    await click(".synnical-settings-app nav button", "Appearance")
    await click(".synnical-settings-app main button", theme)
    // Auto-hide belongs to Appearance and must not change the clean desktop surface.
    await exerciseSwitch('[aria-label="Auto-hide taskbar"]')
    await checkSurface(".synnical-os-root")
    await click(".synnical-settings-app nav button", "System")
    for (const label of ["Auto fullscreen", "chat notifications", "Battery Saver"]) await exerciseSwitch(`[aria-label="${label}"]`)
    await capture(`switches-${theme.toLowerCase()}-1366x768`)
    // Open the legacy/shared notification sound control; do not request browser permissions.
    assert.ok(await evaluate(`(() => { const b=[...document.querySelectorAll('button.synn-settings-card')].find(b => b.querySelector('span.block')?.textContent==='Notifications'); b?.click(); return Boolean(b) })()`))
    await wait(`Boolean([...document.querySelectorAll('.synnical-settings-legacy [role="switch"]')].length)`)
    // Each row contains a switch: select the final sound row rather than desktop permission.
    const switches = await evaluate(`document.querySelectorAll('.synnical-settings-legacy [role="switch"]').length`)
    assert.ok(switches >= 2)
    await evaluate(`document.querySelectorAll('.synnical-settings-legacy [role="switch"]')[${switches - 1}].setAttribute('data-layout-sound','true'); true`)
    await exerciseSwitch('[data-layout-sound="true"]')
    await capture(`legacy-${theme.toLowerCase()}-1366x768`)
    await click(".synnical-settings-app nav button", "System")
  }
  } else console.log("UNVERIFIED live Settings switches/auto-hide: authenticated account required; no production account is created")
  // Explicit fullscreen and windowed use the same clean surface bounds.
  const fullscreen = await command("Runtime.evaluate", { expression:"document.documentElement.requestFullscreen().then(()=>true)", awaitPromise:true, returnByValue:true, userGesture:true }, sessionId)
  assert.ok(!fullscreen.exceptionDetails, "Browser fullscreen must be available")
  assert.ok(await evaluate("Boolean(document.fullscreenElement)"))
  await checkSurface(".synnical-os-root")
  await command("Runtime.evaluate", { expression:"document.exitFullscreen().then(()=>true)", awaitPromise:true, returnByValue:true }, sessionId)
  await checkSurface(".synnical-os-root")
  const lock = await verifyAuthenticatedLock({ authenticated, evaluate, wait, checkSurface, capture })
  if (!authenticated) console.log(`UNVERIFIED live lock screen: authenticated account required`)
  if (evidenceDir) await writeFile(path.join(evidenceDir, "layout-results.json"), JSON.stringify({ measurements, switches:authenticated ? "contained in both states" : "UNVERIFIED: authenticated account required", themes:authenticated ? ["Blood","Synnical","Forest"] : [], fullscreen:"passed", lock }, null, 2))
  console.log(`PASS empty wallpaper surfaces at 1366x768, 1920x1080, 1440x900, 1280x720; fullscreen${authenticated ? "; lock; theme switches; auto-hide" : ""}`)
}
