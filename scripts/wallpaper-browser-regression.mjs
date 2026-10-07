import { verifyDesktopLayout } from "./desktop-layout-regression.mjs"
import { pathToFileURL } from "node:url"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import WebSocket from "ws"

/** Exercise the actual production React component/video decoder, not a simulated clock. */
export async function verifyWallpaperAdvances(base, { cookie } = {}) {
  const executable = [process.env.SYNNICAL_BROWSER_EXECUTABLE, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean).find(existsSync)
  assert.ok(executable, "Chrome/Chromium is required for the wallpaper browser regression")
  const profile = await mkdtemp(path.join(tmpdir(), "synnical-wallpaper-browser-"))
  const child = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  let ws
  let id = 0
  const pending = new Map()
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Wallpaper browser startup timed out")), 15000)
      let output = ""
      child.once("error", () => { clearTimeout(timer); reject(new Error("Wallpaper browser could not start")) })
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Wallpaper browser exited before startup")) })
      child.stderr.on("data", chunk => {
        output = (output + chunk).slice(-8192)
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    ws = new WebSocket(endpoint)
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", () => reject(new Error("Wallpaper browser connection failed"))) })
    ws.on("message", data => {
      const message = JSON.parse(String(data))
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      clearTimeout(task.timer)
      if (message.error) task.reject(new Error("Wallpaper browser command failed"))
      else task.resolve(message.result)
    })
    const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const key = ++id
      const timer = setTimeout(() => { pending.delete(key); reject(new Error("Wallpaper browser command timed out")) }, 15000)
      pending.set(key, { resolve, reject, timer })
      ws.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
    const { targetId } = await command("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true })
    if (cookie) {
      assert.equal(new URL(base).hostname, "127.0.0.1", "Disposable smoke cookies must never be sent to production")
      await command("Network.setCookies", {cookies:cookie.split('; ').map(part => { const at=part.indexOf('='); return {name:part.slice(0,at),value:part.slice(at+1),url:base,httpOnly:true,sameSite:"Lax"} })}, sessionId)
    }
    await command("Page.navigate", {url:base}, sessionId)
    await command("Page.bringToFront", {}, sessionId)
    const evaluate = async expression => {
      const result = await command("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
      assert.ok(!result.exceptionDetails, "Wallpaper browser evaluation failed")
      return result.result.value
    }
    const snapshot = `(() => { const v = document.querySelector('video.synnical-live-wallpaper[src="/brand/wallpapers/synnical-default-wallpaper.webm"]'); return v ? { time: v.currentTime, duration: v.duration, frames: v.getVideoPlaybackQuality().totalVideoFrames, paused: v.paused, ready: v.readyState, error: v.error?.code || null } : null })()`
    let initial
    let bootChecked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!bootChecked) {
        const boot = await evaluate(`(() => { const b=document.querySelector('.synnical-boot-wallpaper'); return b ? {r:b.getBoundingClientRect().toJSON(),w:innerWidth,h:innerHeight} : null })()`)
        if (boot) {
          assert.ok(boot.r.left <= 0 && boot.r.top <= 0 && boot.r.right >= boot.w && boot.r.bottom >= boot.h, "Boot wallpaper covers viewport")
          bootChecked = true
          if (process.env.SYNNICAL_LAYOUT_EVIDENCE_DIR) {
            await mkdir(process.env.SYNNICAL_LAYOUT_EVIDENCE_DIR, {recursive:true})
            const {data} = await command("Page.captureScreenshot", {format:"png",fromSurface:true}, sessionId)
            await writeFile(path.join(process.env.SYNNICAL_LAYOUT_EVIDENCE_DIR,"boot.png"), Buffer.from(data,"base64"))
          }
        }
      }
      initial = await evaluate(snapshot)
      if (initial?.ready >= 2 && !initial.paused) break
      await delay(200)
    }
    assert.ok(bootChecked, "Fresh browser navigation exercises boot wallpaper bounds")
    const dimensions = await evaluate(`(() => { const v=document.querySelector("video.synnical-live-wallpaper"); return [v.videoWidth,v.videoHeight] })()`)
    assert.deepEqual(dimensions, [1920,1080], "Default WebM display dimensions match clean poster")
    assert.ok(initial?.ready >= 2 && !initial.paused, "Default wallpaper must load and play with normal settings")
    for (const mode of ["normal", "automatic-performance", "automatic-low-battery"]) {
      if (mode !== "normal") await evaluate(`document.documentElement.classList.add('${mode === "automatic-performance" ? "synnical-perf-mode" : "synnical-battery-perf"}'); true`)
      const before = await evaluate(snapshot)
      await delay(900)
      const after = await evaluate(snapshot)
      const elapsed = (after.time - before.time + after.duration) % after.duration
      assert.equal(after.error, null, `${mode}: video decode succeeds`)
      assert.equal(after.paused, false, `${mode}: automatic hints cannot pause the default wallpaper`)
      assert.ok(elapsed > 0.15, `${mode}: actual WebM currentTime must advance`)
      assert.ok(after.frames > before.frames, `${mode}: decoded video frames must advance`)
    }
    await verifyDesktopLayout({ command, evaluate, sessionId, authenticated: Boolean(cookie) })
  } finally {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("Wallpaper browser closed")) }
    // Ask Chrome to flush/close its helpers before deleting their profile.
    const exited = () => child.exitCode !== null || child.signalCode !== null
    const waitForExit = () => Promise.race([new Promise(resolve => exited() ? resolve() : child.once("exit", resolve)), delay(3000)])
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: ++id, method: "Browser.close" }))
    await waitForExit()
    if (!exited()) { child.kill("SIGTERM"); await waitForExit() }
    if (!exited()) { child.kill("SIGKILL"); await waitForExit() }
    ws?.terminate()
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyWallpaperAdvances(process.argv[2] || "http://127.0.0.1:3000")
