import test from "node:test"
import assert from "node:assert/strict"
import { readFile, access } from "node:fs/promises"
import { constants } from "node:fs"
import { SYNN_BOT_COMMANDS, SYNN_BOT_RESPONSE_POOL_SIZES, synnBotReply } from "../src/lib/synn-bot"

const read = (file: string) => readFile(file, "utf8")

test("Synn Bot keeps exactly 1000 unique commands and meaningful local response pools", () => {
  assert.equal(SYNN_BOT_COMMANDS.length, 1000)
  assert.equal(new Set(SYNN_BOT_COMMANDS.map((command) => command.name)).size, 1000)
  assert.ok(SYNN_BOT_RESPONSE_POOL_SIZES.eightBall >= 20)
  assert.ok(SYNN_BOT_RESPONSE_POOL_SIZES.jokes >= 20)
  assert.ok(SYNN_BOT_RESPONSE_POOL_SIZES.facts >= 20)
  assert.ok(SYNN_BOT_RESPONSE_POOL_SIZES.riddles >= 20)
  assert.match(String(synnBotReply("/8ball will this pass?")), /^8-ball: /)
  assert.match(String(synnBotReply("/calc 9 ^ 2")), /= 81$/)
})

test("OpenRouter is first, a 429 fails over to Groq, and OpenAI can never enter completions", async () => {
  const keys = ["OPENROUTER_API_KEY","OPENROUTER_MODEL","GROQ_API_KEY","GROQ_MODEL","GEMINI_API_KEY","AI_PROVIDER_ORDER"] as const
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  const oldFetch = globalThis.fetch
  try {
    process.env.OPENROUTER_API_KEY = "sk-or-consolidated_test"
    process.env.OPENROUTER_MODEL = ""
    process.env.GROQ_API_KEY = "gsk_consolidated_test_key"
    process.env.GROQ_MODEL = "openai/gpt-oss-20b"
    delete process.env.GEMINI_API_KEY
    process.env.AI_PROVIDER_ORDER = "openai,openrouter,groq"
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input); calls.push(url)
      if (url.includes("openrouter.ai")) return new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })
      if (url.includes("groq.com")) return new Response(JSON.stringify({ model: "openai/gpt-oss-20b", choices: [{ message: { content: "groq fallback ok" } }] }), { status: 200 })
      throw new Error(`Unexpected provider URL: ${url}`)
    }) as typeof fetch
    const { completeWithAiPool, aiProviderStatus } = await import("../src/lib/ai-provider-pool")
    const result = await completeWithAiPool({ messages: [{ role: "user", content: "test" }], timeoutMs: 10000 })
    assert.equal(result.provider, "groq")
    assert.equal(result.text, "groq fallback ok")
    assert.equal(calls.length, 2)
    assert.match(calls[0], /openrouter\.ai/)
    assert.match(calls[1], /groq\.com/)
    assert.deepEqual(aiProviderStatus().map((row) => row.name), ["openrouter", "groq", "gemini"])
  } finally {
    globalThis.fetch = oldFetch
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value
  }
})

test("SynnFlix uses Vidking directly without Synnical iframe sandboxing or wrapper headers", async () => {
  const [panel, config] = await Promise.all([read("src/components/synnflix-panel.tsx"), read("next.config.js")])
  assert.match(panel, /iframe\.src = providerUrl\.toString\(\)/)
  assert.match(panel, /VIDKING_ORIGIN/)
  assert.doesNotMatch(panel, /iframe\.sandbox/)
  assert.doesNotMatch(panel, /\/api\/synnflix\/player/)
  assert.doesNotMatch(config, /Cross-Origin-Embedder-Policy/)
  assert.doesNotMatch(config, /Cross-Origin-Opener-Policy/)
  await assert.rejects(access("src/app/api/synnflix/player/route.ts", constants.F_OK))
})

test("Browser waits for an actually controlling Scramjet worker and adds no outer iframe sandbox", async () => {
  const [hook, panel, runtime] = await Promise.all([read("src/hooks/use-scramjet.ts"), read("src/components/browser-panel.tsx"), read("src/lib/proxy-runtime.ts")])
  assert.match(hook, /navigator\.serviceWorker\.controller/)
  assert.doesNotMatch(hook, /!navigator\.serviceWorker\.controller && isCurrentProxyWorker\(reg\.active\)/)
  assert.doesNotMatch(hook, /!controlled && isCurrentProxyWorker\(reg\.active\)/)
  assert.doesNotMatch(panel, /setAttribute\(["']sandbox["']/)
  assert.match(runtime, /sj2-alpha2-controller14-synnical-os-20260821-wiring2/)
})

test("Cloud player audio unlock is idempotent and Escape releases controls after two seconds", async () => {
  const [embed, games] = await Promise.all([read("stratus/public/e.html"), read("src/components/games-panel.tsx")])
  assert.match(embed, /ESC_RELEASE_HOLD_MS = 2_000/)
  assert.match(embed, /let liveStarted = false/)
  assert.match(embed, /let audioUnlocked = playerVolume <= 0/)
  assert.match(embed, /if \(audioUnlocked\) \{[\s\S]*unlockAudio\(\)/)
  assert.match(embed, /if \(!liveStarted\) \{/)
  assert.match(games, /Back to games/)
  assert.match(games, /document\.exitFullscreen\(\)/)
})

test("refund window is enforced by the same shop engine that advertises it", async () => {
  const [shop, economy] = await Promise.all([read("src/lib/shop.ts"), read("src/app/api/features/economy/route.ts")])
  assert.match(shop, /export const REFUND_WINDOW_MS\s*=\s*7\s*\*\s*24/)
  assert.match(shop, /REFUND_WINDOW_MS/)
  assert.match(shop, /refund window|refund eligibility|too old/i)
  assert.match(economy, /refundEligibleUntil/)
})

test("private game screenshots are owner-authorized and removable", async () => {
  const [upload, item, genericUploads] = await Promise.all([read("src/app/api/features/games/screenshot/route.ts"), read("src/app/api/features/games/screenshot/[id]/route.ts"), read("src/app/api/uploads/[...path]/route.ts")])
  assert.match(upload, /game-screenshots-private/)
  assert.match(item, /userId:\s*me\.id/)
  assert.match(item, /export async function DELETE/)
  assert.doesNotMatch(genericUploads, /game-screenshots-private/)
})

test("dead fake feature surfaces and generated settings catalogs are absent", async () => {
  for (const file of ["src/components/vm-panel.tsx","src/components/changelog-panel.tsx","src/lib/settings-data.ts","src/lib/settings-data-2.ts"]) {
    await assert.rejects(access(file, constants.F_OK))
  }
  const applier = await read("src/components/settings-generic.tsx")
  assert.doesNotMatch(applier, /settings-data/)
  assert.match(applier, /applyAllSettings\(\[\]\)/)
})
