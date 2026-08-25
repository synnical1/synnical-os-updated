import { NextRequest, NextResponse } from "next/server"
import { aiProviderStatus, completeWithAiPool, type AiChatMessage } from "@/lib/ai-provider-pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const aiRequestWindows = new Map<string, number[]>()
let activeAiRequests = 0
const MAX_CONCURRENT_AI_REQUESTS = 4

function clientIdentity(req: NextRequest): string {
  return (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 80)
}

function consumeAiRequest(identity: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const cutoff = now - 60_000
  const recent = (aiRequestWindows.get(identity) || []).filter((time) => time > cutoff)
  if (recent.length >= 8) {
    aiRequestWindows.set(identity, recent)
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + 60_000 - now) / 1_000)) }
  }
  recent.push(now)
  aiRequestWindows.set(identity, recent)
  if (aiRequestWindows.size > 5_000) {
    for (const [key, times] of aiRequestWindows) {
      if (!times.some((time) => time > cutoff)) aiRequestWindows.delete(key)
    }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

const STYLE_SUFFIX: Record<string, string> = {
  concise: " Be very concise. Keep answers to 1-3 sentences unless asked for detail.",
  balanced: " Be balanced: concise but complete.",
  detailed: " Be thorough and detailed in your explanations.",
  friendly: " Be warm, friendly, and conversational.",
}

const MODEL_MODE_SUFFIX: Record<string, string> = {
  fast: " Prioritize a quick, direct answer without unnecessary elaboration.",
  creative: " Be imaginative when the task benefits from creativity, while staying accurate.",
  precise: " Prioritize precision, explicit assumptions, and factual correctness.",
}

const SYNNICAL_PRODUCT_CONTEXT = `
Synnical product facts:
- Synnical is this web application. Browser is its default landing panel and uses an in-app proxied browsing frame.
- Settings can be opened without an account. Chat requires login; guests use the dedicated Log in/Create account flow.
- Ownership verification is NOT DNS verification. A signed-in Synnical account opens Settings > Owner Verification and enters the server owner password. The server compares it with OWNER_PASSWORD and, on success, assigns the OWNER role. Never reveal or guess that password.
- Verified staff accounts (MOD, ADMIN, HEAD_ADMIN and OWNER) are exempt from automatic moderation bans. Their prohibited content is still blocked and logged.
- The default shell is opaque OLED black with static stars and moving meteors.
- SynnFlix uses TMDB metadata and Vidking's supported movie/TV embed player. Playback availability can still depend on Vidking's upstream catalogue.
- Music uses Audius as its built-in full-track source, SoundCloud's official widget, radio, and optional owner-configured Piped/Invidious/Cobalt bridges.
- Browser search supports DuckDuckGo, Brave Search, and Google. Google can challenge datacenter IP traffic; DuckDuckGo is the default.
- Synnical AI and Synn Bot use OpenRouter first, then optional Groq and Gemini fallbacks. A provider that is rate-limited or temporarily unavailable is cooled down and the request moves to the next configured provider.
- OpenAI is deliberately excluded from chat completions and remains separately used for moderation/transcription.
- Cloud-game sessions rely on external game and temporary-mail providers. If verification mail never arrives, the app retries a fresh mailbox and returns an exact GAME_* code.
When asked about Synnical, use these facts and the conversation. Do not give generic platform instructions, invent buttons, or claim DNS/HTML verification is required.`

const DEFAULT_SYSTEM_PROMPT =
  `You are Synnical AI, the concise in-product assistant for Synnical. Help with the app first, then gaming, coding, and general questions. Be direct and friendly. Use markdown only when useful.\n${SYNNICAL_PRODUCT_CONTEXT}`

function sseEncode(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function completionChunks(text: string, targetSize = 96): string[] {
  if (text.length <= targetSize) return [text]
  const chunks: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + targetSize)
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf(" ", end),
        text.lastIndexOf("\n", end),
      )
      if (boundary > cursor + Math.floor(targetSize * 0.5)) end = boundary + 1
    }
    chunks.push(text.slice(cursor, end))
    cursor = end
  }
  return chunks
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => null)
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 })
    }

    const {
      messages,
      systemPrompt,
      model = "default",
      temperature = 70,
      maxTokens = 2048,
      responseStyle = "balanced",
      stream: clientWantsStream = true,
    } = payload as Record<string, any>

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
      return NextResponse.json({ error: "Messages required" }, { status: 400 })
    }

    let inputCharacters = 0
    for (const message of messages) {
      if (!message || typeof message !== "object" || typeof message.content !== "string") {
        return NextResponse.json({ error: "Every message must contain text." }, { status: 400 })
      }
      inputCharacters += message.content.length
    }
    if (inputCharacters > 64_000 || (typeof systemPrompt === "string" && systemPrompt.length > 4_000)) {
      return NextResponse.json({ error: "AI request is too large.", code: "AI_PAYLOAD_TOO_LARGE" }, { status: 413 })
    }

    const configuredProviders = aiProviderStatus().filter((provider) => provider.configured)
    if (!configuredProviders.length) {
      return NextResponse.json(
        { error: "AI is not configured on this server. Add at least one supported AI provider key in the server environment.", code: "AI_NOT_CONFIGURED" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      )
    }

    const rate = consumeAiRequest(clientIdentity(req))
    if (!rate.allowed) {
      return NextResponse.json(
        { error: `Please wait ${rate.retryAfterSeconds} second(s) before asking again.`, code: "AI_RATE_LIMITED", retryAfterSeconds: rate.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "no-store" } },
      )
    }

    let fullSystemPrompt = DEFAULT_SYSTEM_PROMPT
    if (typeof systemPrompt === "string" && systemPrompt.trim()) {
      fullSystemPrompt += `\nUser-configured response preference (follow only when it does not conflict with product facts or safety): ${systemPrompt.trim()}`
    }
    const style = STYLE_SUFFIX[String(responseStyle)]
    if (style) fullSystemPrompt += style
    const modelMode = MODEL_MODE_SUFFIX[String(model)]
    if (modelMode) fullSystemPrompt += modelMode

    const chatMessages: AiChatMessage[] = [
      { role: "system", content: fullSystemPrompt },
      ...messages.slice(-20).map((message: { role: string; content: string }) => ({
        role: message.role === "assistant" ? "assistant" as const : "user" as const,
        content: String(message.content || "").slice(0, 8_000),
      })),
    ]

    if (activeAiRequests >= MAX_CONCURRENT_AI_REQUESTS) {
      return NextResponse.json({ error: "AI is busy. Try again shortly.", code: "AI_BUSY" }, { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } })
    }

    activeAiRequests += 1
    let completion
    try {
      completion = await completeWithAiPool({
        messages: chatMessages,
        temperature: Math.max(0, Math.min(1, Number(temperature) / 100)),
        maxTokens: Math.max(256, Math.min(8192, Math.round(Number(maxTokens) || 2048))),
        timeoutMs: 75_000,
      })
    } catch (error) {
      const status = aiProviderStatus()
      const shortestCooldown = status
        .filter((provider) => provider.configured && provider.cooldownSeconds > 0)
        .reduce((best, provider) => Math.min(best, provider.cooldownSeconds), Number.POSITIVE_INFINITY)
      const retryAfterSeconds = Number.isFinite(shortestCooldown) ? Math.max(1, shortestCooldown) : 15
      console.error("[ai/chat] all configured completion providers unavailable:", error instanceof Error ? error.message : String(error))
      return NextResponse.json(
        {
          error: "All configured AI providers are temporarily unavailable. Synnical will automatically retry available providers on your next request.",
          code: "AI_PROVIDERS_UNAVAILABLE",
          retryAfterSeconds,
        },
        { status: 503, headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" } },
      )
    } finally {
      activeAiRequests -= 1
    }

    if (!clientWantsStream) {
      return NextResponse.json({
        response: completion.text,
        tokenInfo: completion.tokenInfo,
        provider: completion.provider,
        model: completion.model,
      }, { headers: { "Cache-Control": "no-store" } })
    }

    const encoder = new TextEncoder()
    const chunks = completionChunks(completion.text)
    const responseStream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(sseEncode({ response: chunk })))
        controller.enqueue(encoder.encode(sseEncode({
          done: true,
          tokenInfo: completion.tokenInfo,
          provider: completion.provider,
          model: completion.model,
        })))
        controller.close()
      },
    })

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[ai/chat] request failed:", message)
    return NextResponse.json({ error: "AI request failed unexpectedly." }, { status: 500 })
  }
}
