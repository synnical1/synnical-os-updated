// Optional Playwright checks against smoke-recovery.mjs's disposable server.
// Supply --browser-module=/absolute/path/to/playwright/index.mjs to the runner.
import assert from "node:assert/strict"
import { pathToFileURL } from "node:url"
import path from "node:path"
import sharp from "sharp"

export async function smokeBrowser({ base, accounts, browserModule, pass, incoming, channelName }) {
  const { chromium } = await import(pathToFileURL(path.resolve(browserModule)).href)
  const browser = await chromium.launch({ headless: true, ...(process.env.SYNNICAL_CHROMIUM_PATH ? { executablePath: process.env.SYNNICAL_CHROMIUM_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process"] } : {}) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  const errors = []
  try {
    await context.addCookies(accounts[0].cookie.split("; ").map((entry) => { const index = entry.indexOf("="); return { name: entry.slice(0, index), value: entry.slice(index + 1), url: base, httpOnly: true, sameSite: "Lax" } }))
    await context.route("**/*", (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(base, { waitUntil: "domcontentloaded" })
    await page.locator(".synnical-os-root").waitFor()
    const open = async (name, selector) => {
      const closes = page.locator(".synnical-os-window:visible .synnical-os-titlebar button[aria-label=Close]")
      while (await closes.count()) await closes.first().click()
      await page.getByRole("button", { name, exact: true }).first().dblclick()
      const panel = page.locator(selector).last(); await panel.waitFor(); return panel
    }
    const settings = await open("Settings", ".synnical-settings-app")
    await settings.getByRole("button", { name: "Appearance", exact: true }).click()
    await settings.getByLabel("Cursor theme").selectOption("crosshair")
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("synnical:os:settings:v4") || "{}").cursorTheme === "crosshair")
    await settings.getByRole("button", { name: "Accounts", exact: true }).click()
    const exported = page.waitForEvent("download"); await settings.getByRole("button", { name: "Export JSON", exact: true }).click()
    assert.equal((await exported).suggestedFilename(), "synnical-os-settings.json")
    await settings.getByRole("button", { name: "Create restore point", exact: true }).click()
    assert.ok(await settings.getByRole("button", { name: /^Restore \d/ }).count())
    await settings.getByRole("button", { name: "Bluetooth & devices", exact: true }).click()
    await settings.getByRole("button", { name: /Typing & keyboard/ }).click()
    const shortcut = settings.getByLabel("run shortcut")
    await shortcut.click(); await shortcut.press("Control+Shift+R")
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("synnical:os:settings:v4") || "{}").shortcuts?.run === "Ctrl+Shift+R")
    assert.equal(await page.getByRole("heading", { name: "Run", exact: true }).count(), 0, "Recording a shortcut must not execute it")
    pass("browser UI: desktop launches Settings; cursor, JSON export, restore points and editable shortcuts work")

    // Screenshot fixture uses the same authenticated upload API as Games.
    const png = await sharp({ create: { width: 48, height: 48, channels: 3, background: "#2266aa" } }).png().toBuffer()
    const upload = await context.request.post(base + "/api/features/games/screenshot", { multipart: { gameId: "ui-fixture", file: { name: "capture.png", mimeType: "image/png", buffer: png } } })
    assert.equal(upload.status(), 200, await upload.text())
    const files = await open("Synnical Files", ".synnical-files-app")
    await files.getByRole("button", { name: "Screenshots", exact: true }).click()
    await files.getByRole("button", { name: /Screenshot · ui-fixture/ }).first().click()
    page.once("dialog", (dialog) => dialog.accept("UI capture renamed"))
    await files.getByRole("button", { name: "Rename", exact: true }).click()
    await files.getByRole("button", { name: /UI capture renamed/ }).first().click()
    const zipped = page.waitForEvent("download"); await files.getByRole("button", { name: "ZIP selected", exact: true }).click()
    assert.equal((await zipped).suggestedFilename(), "synnical-screenshots.zip")
    await files.getByRole("button", { name: "Move to Recycle Bin", exact: true }).click()
    await files.getByRole("button", { name: "Recycle Bin", exact: true }).click()
    await files.getByRole("button", { name: /UI capture renamed/ }).first().click()
    await files.getByRole("button", { name: "Restore", exact: true }).click()
    await files.getByRole("button", { name: "Screenshots", exact: true }).click()
    await files.getByRole("button", { name: /UI capture renamed/ }).first().waitFor()
    pass("browser UI: Files rename, ZIP download, recycle and restore use the real APIs")

    const browserPanel = await open("Browser", ".synnical-browser")
    const address = page.getByRole("textbox", { name: "Search or enter address", exact: true })
    await address.fill("https://example.com/local-draft")
    assert.equal(await address.inputValue(), "https://example.com/local-draft")
    assert.equal(await browserPanel.locator("iframe").count(), 0)
    await page.reload({ waitUntil: "domcontentloaded" }); await page.locator(".synnical-os-root").waitFor()
    assert.equal(await page.locator(".synnical-os-window").count(), 0)
    pass("browser UI: address editing does not navigate; reload starts with no restored windows")

    const { smokeBrowserUpgrade } = await import("./smoke-browser-upgrade.mjs")
    await smokeBrowserUpgrade({ page, context, base, open, pass, incoming, channelName })

    await page.goto(base + "/?safe=1", { waitUntil: "domcontentloaded" })
    await page.getByRole("link", { name: /Safe Mode/ }).waitFor()
    assert.equal(await page.getByRole("button", { name: "Games", exact: true }).count(), 0)
    await page.goto(base + "/?recover=1", { waitUntil: "domcontentloaded" })
    await page.getByRole("button", { name: "Reset local OS preferences", exact: true }).waitFor()
    pass("browser UI: Safe Mode limits apps and Recovery exposes the local reset action")
    assert.deepEqual(errors, [], "Browser must have no uncaught application errors")
  } finally { await context.close(); await browser.close() }
}
