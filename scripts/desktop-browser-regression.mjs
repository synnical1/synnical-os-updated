import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import WebSocket from "ws"
import { verifyDesktopLayout } from "./desktop-layout-regression.mjs"

/** Verify the public and signed-in Synnical desktop after the global wallpaper clear-out. */
export async function verifyDesktopRenders(base, { cookie } = {}) {
  const executable = [
    process.env.SYNNICAL_BROWSER_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean).find(existsSync)
  assert.ok(executable, "Chrome/Chromium is required for desktop rendering regression")
  const profile = await mkdtemp(path.join(tmpdir(), "synnical-desktop-browser-"))
  const child = spawn(executable, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] })
  let ws
  let id = 0
  const pending = new Map()
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Desktop browser startup timed out")), 15000)
      let output = ""
      child.once("error", () => { clearTimeout(timer); reject(new Error("Desktop browser could not start")) })
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Desktop browser exited before startup")) })
      child.stderr.on("data", chunk => {
        output = (output + chunk).slice(-8192)
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    ws = new WebSocket(endpoint)
    await new Promise((resolve, reject) => {
      ws.once("open", resolve)
      ws.once("error", () => reject(new Error("Desktop browser connection failed")))
    })
    ws.on("message", data => {
      const message = JSON.parse(String(data))
      const task = pending.get(message.id)
      if (!task) return
      pending.delete(message.id)
      clearTimeout(task.timer)
      if (message.error) task.reject(new Error("Desktop browser command failed"))
      else task.resolve(message.result)
    })
    const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const key = ++id
      const timer = setTimeout(() => {
        pending.delete(key)
        reject(new Error("Desktop browser command timed out"))
      }, 15000)
      pending.set(key, { resolve, reject, timer })
      ws.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
    const { targetId } = await command("Target.createTarget", { url: "about:blank" })
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true })
    if (cookie) {
      assert.equal(new URL(base).hostname, "127.0.0.1", "Disposable smoke cookies must never be sent to production")
      const cookies = cookie.split("; ").map(part => {
        const at = part.indexOf("=")
        return { name: part.slice(0, at), value: part.slice(at + 1), url: base, httpOnly: true, sameSite: "Lax" }
      })
      await command("Network.setCookies", { cookies }, sessionId)
    }
    await command("Page.navigate", { url: base }, sessionId)
    await command("Page.bringToFront", {}, sessionId)
    const evaluate = async expression => {
      const result = await command("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
      assert.ok(!result.exceptionDetails, "Desktop browser evaluation failed")
      return result.result.value
    }
    const snapshot = "() => { const root=document.querySelector('.synnical-os-root'); if(!root)return null; const settings=JSON.parse(localStorage.getItem('synnical:os:settings:v4')||'{}'); return {background:getComputedStyle(root).backgroundColor, wallpaperVersion:settings.wallpaperDefaultVersion||0, desktopWallpaper:settings.desktopWallpaper||'', liveWallpaper:Boolean(document.querySelector('.synnical-live-wallpaper')), bootWallpaper:Boolean(document.querySelector('.synnical-boot-wallpaper')), width:innerWidth,height:innerHeight}; }"
    let state = null
    for (let attempt = 0; attempt < 150; attempt++) {
      state = await evaluate("(" + snapshot + ")()")
      if (state && state.wallpaperVersion >= 3 && !state.desktopWallpaper && !state.liveWallpaper && !state.bootWallpaper) break
      await delay(100)
    }
    assert.ok(state, "Synnical desktop became available")
    assert.equal(state.wallpaperVersion, 3, "Local settings completed the wallpaper v3 migration")
    assert.equal(state.desktopWallpaper, "", "Desktop wallpaper preference is empty")
    assert.equal(state.liveWallpaper, false, "No old video wallpaper is rendered")
    assert.equal(state.bootWallpaper, false, "No boot wallpaper is rendered")
    assert.equal(state.background, "rgb(17, 18, 20)", "Desktop shows the clean Synnical base surface")
    const evidenceDir = process.env.SYNNICAL_LAYOUT_EVIDENCE_DIR
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true })
      const { data } = await command("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId)
      await writeFile(path.join(evidenceDir, cookie ? "authenticated-empty-desktop.png" : "guest-empty-desktop.png"), Buffer.from(data, "base64"))
    }
    await verifyDesktopLayout({ command, evaluate, sessionId, authenticated: Boolean(cookie) })
  } finally {
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.reject(new Error("Desktop browser closed"))
    }
    const exited = () => child.exitCode !== null || child.signalCode !== null
    const waitForExit = () => Promise.race([
      new Promise(resolve => exited() ? resolve() : child.once("exit", resolve)),
      delay(3000),
    ])
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: ++id, method: "Browser.close" }))
    await waitForExit()
    if (!exited()) { child.kill("SIGTERM"); await waitForExit() }
    if (!exited()) { child.kill("SIGKILL"); await waitForExit() }
    ws?.terminate()
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyDesktopRenders(process.argv[2] || "http://127.0.0.1:3000")
}
