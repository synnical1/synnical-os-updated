import { observeProvider } from "./runtime-health"
export type AiChatMessage = { role: "system" | "user" | "assistant"; content: string }

export type AiPoolRequest = {
  messages: AiChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export type AiPoolCompletion = {
  text: string
  provider: ProviderName
  model: string
  tokenInfo?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

type ProviderName = "openrouter" | "groq" | "gemini"

type ProviderFailure = {
  provider: ProviderName
  status: number
  retryAfterSeconds: number
  message: string
}

type ProviderSpec = {
  name: ProviderName
  configured: () => boolean
  request: (input: AiPoolRequest, signal: AbortSignal) => Promise<AiPoolCompletion>
}

// Owner-requested completion order. OpenRouter owns Synnical AI + Synn Bot.
// OpenAI is deliberately NOT a chat-completion provider here; its key remains
// isolated to moderation/transcription in content-moderation.ts.
const PROVIDER_ORDER: readonly ProviderName[] = ["openrouter", "groq", "gemini"]

const cooldownUntil = new Map<ProviderName, number>()
const lastFailures = new Map<ProviderName, ProviderFailure>()

function env(name: string): string {
  return process.env[name]?.trim() || ""
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : 0
}

function publicErrorMessage(status: number, body: string): string {
  let detail = ""
  try {
    const parsed = JSON.parse(body) as any
    detail = String(parsed?.error?.message || parsed?.message || parsed?.detail || parsed?.errors?.[0]?.message || "")
  } catch {}
  const safe = detail
    .replace(/[\r\n\t]+/g, " ")
    .replace(/(?:sk|gsk|AIza)[A-Za-z0-9_-]{8,}/gi, "[redacted]")
    .slice(0, 220)
  return safe || `HTTP ${status}`
}

class UpstreamFailure extends Error {
  provider: ProviderName
  status: number
  retryAfterSeconds: number

  constructor(provider: ProviderName, status: number, message: string, retryAfterSeconds = 0) {
    super(message)
    this.provider = provider
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function tokenInfoFromOpenAI(body: any): AiPoolCompletion["tokenInfo"] {
  const usage = body?.usage
  if (!usage) return undefined
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || promptTokens + completionTokens
  return { promptTokens, completionTokens, totalTokens }
}

async function fetchJson(provider: ProviderName, url: string, init: RequestInit, signal: AbortSignal): Promise<any> {
  const response = await fetch(url, { ...init, signal, cache: "no-store" })
  const text = await response.text()
  if (!response.ok) {
    throw new UpstreamFailure(
      provider,
      response.status,
      publicErrorMessage(response.status, text),
      parseRetryAfter(response.headers.get("retry-after")),
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new UpstreamFailure(provider, 502, "Provider returned invalid JSON")
  }
}

function openAiCompatible(spec: {
  name: ProviderName
  keyEnv: string
  urlEnv?: string
  defaultUrl: string
  modelEnv: string
  defaultModel?: string
  headers?: () => Record<string, string>
}): ProviderSpec {
  return {
    name: spec.name,
    configured: () => Boolean(env(spec.keyEnv)),
    request: async (input, signal) => {
      const requestedModel = env(spec.modelEnv) || spec.defaultModel || ""
      const requestBody: Record<string, unknown> = {
        messages: input.messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens ?? 2048,
        stream: false,
      }
      // OpenRouter can use the account/payer default when model is omitted.
      if (requestedModel) requestBody.model = requestedModel

      const endpoint = (spec.urlEnv ? env(spec.urlEnv) : "") || spec.defaultUrl
      const body = await fetchJson(spec.name, endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env(spec.keyEnv)}`,
          "Content-Type": "application/json",
          ...(spec.headers?.() || {}),
        },
        body: JSON.stringify(requestBody),
      }, signal)
      const text = body?.choices?.[0]?.message?.content
      if (typeof text !== "string" || !text.trim()) {
        throw new UpstreamFailure(spec.name, 502, "Provider returned an empty completion")
      }
      return {
        text: text.trim(),
        provider: spec.name,
        model: String(body?.model || requestedModel || "account-default"),
        tokenInfo: tokenInfoFromOpenAI(body),
      }
    },
  }
}

const providers: Record<ProviderName, ProviderSpec> = {
  openrouter: openAiCompatible({
    name: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    urlEnv: "OPENROUTER_CHAT_URL",
    defaultUrl: "https://openrouter.ai/api/v1/chat/completions",
    modelEnv: "OPENROUTER_MODEL",
    // Blank model means OpenRouter uses the account/payer default.
    headers: () => ({
      "HTTP-Referer": env("OPENROUTER_HTTP_REFERER") || "https://www.synnical.co.uk",
      "X-OpenRouter-Title": env("OPENROUTER_APP_TITLE") || "Synnical",
    }),
  }),
  groq: openAiCompatible({
    name: "groq",
    keyEnv: "GROQ_API_KEY",
    defaultUrl: "https://api.groq.com/openai/v1/chat/completions",
    modelEnv: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-20b",
  }),
  gemini: {
    name: "gemini",
    configured: () => Boolean(env("GEMINI_API_KEY")),
    request: async (input, signal) => {
      const model = env("GEMINI_MODEL") || "gemini-3.7-flash"
      const system = input.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n")
      const contents = input.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        }))
      const body = await fetchJson(
        "gemini",
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "x-goog-api-key": env("GEMINI_API_KEY"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: {
              temperature: input.temperature ?? 0.7,
              maxOutputTokens: input.maxTokens ?? 2048,
            },
          }),
        },
        signal,
      )
      const text = body?.candidates?.[0]?.content?.parts
        ?.map((part: any) => typeof part?.text === "string" ? part.text : "")
        .join("")
      if (typeof text !== "string" || !text.trim()) {
        throw new UpstreamFailure("gemini", 502, "Gemini returned an empty completion")
      }
      const usage = body?.usageMetadata
      const tokenInfo = usage ? {
        promptTokens: Number(usage.promptTokenCount || 0),
        completionTokens: Number(usage.candidatesTokenCount || 0),
        totalTokens: Number(usage.totalTokenCount || 0),
      } : undefined
      return { text: text.trim(), provider: "gemini", model, tokenInfo }
    },
  },
}

function requestedOrder(): ProviderName[] {
  const configured = env("AI_PROVIDER_ORDER")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name): name is ProviderName => PROVIDER_ORDER.includes(name as ProviderName))
  const unique = [...new Set(configured)]
  // Always append any supported providers omitted from the env value. This
  // keeps failover available without ever allowing OpenAI into completions.
  return [...unique, ...PROVIDER_ORDER.filter((name) => !unique.includes(name))]
}

function configuredOrder(): ProviderName[] {
  return requestedOrder().filter((name) => providers[name].configured())
}

function cooldownForFailure(error: UpstreamFailure): number {
  if (error.status === 429) return Math.max(10, Math.min(600, error.retryAfterSeconds || 60))
  if (error.status === 401 || error.status === 403) return 300
  if (error.status >= 500 || error.status === 408 || error.status === 409 || error.status === 498) return 30
  if (error.status === 400 || error.status === 404 || error.status === 422) return 120
  return 20
}

export function aiProviderStatus() {
  const now = Date.now()
  return requestedOrder().map((name) => ({
    name,
    configured: providers[name].configured(),
    cooldownSeconds: Math.max(0, Math.ceil(((cooldownUntil.get(name) || 0) - now) / 1000)),
    lastStatus: lastFailures.get(name)?.status || null,
  }))
}

export async function completeWithAiPool(input: AiPoolRequest): Promise<AiPoolCompletion> {
  const order = configuredOrder()
  if (order.length === 0) {
    throw new Error("No AI completion provider is configured. Add an OpenRouter API key (preferred), or an optional Groq/Gemini fallback key, to the server environment.")
  }

  const deadline = Date.now() + Math.max(15_000, Math.min(90_000, input.timeoutMs || 60_000))
  const failures: ProviderFailure[] = []

  for (let index = 0; index < order.length; index += 1) {
    const name = order[index]
    const now = Date.now()
    if ((cooldownUntil.get(name) || 0) > now) continue
    const remaining = deadline - now
    if (remaining < 1_000) break

    const controller = new AbortController()
    const providersLeft = Math.max(1, order.length - index)
    const fairShare = Math.floor(remaining / providersLeft)
    const providerTimeout = Math.max(3_000, Math.min(15_000, fairShare - 200))
    const timer = setTimeout(() => controller.abort(), providerTimeout)
    try {
      const completion = await providers[name].request(input, controller.signal)
      cooldownUntil.delete(name)
      lastFailures.delete(name)
      observeProvider(name, { ok: true, status: 200, model: completion.model })
      return completion
    } catch (error) {
      const failure = error instanceof UpstreamFailure
        ? error
        : new UpstreamFailure(
            name,
            (error as any)?.name === "AbortError" ? 408 : 502,
            (error as any)?.name === "AbortError"
              ? `Timed out after ${providerTimeout}ms`
              : String((error as any)?.message || error),
          )
      const cooldownSeconds = cooldownForFailure(failure)
      cooldownUntil.set(name, Date.now() + cooldownSeconds * 1000)
      const record = {
        provider: name,
        status: failure.status,
        retryAfterSeconds: cooldownSeconds,
        message: failure.message,
      }
      lastFailures.set(name, record)
      observeProvider(name, { ok: false, status: failure.status, message: failure.message })
      failures.push(record)
      console.warn(`[ai/pool] ${name} unavailable status=${failure.status}; cooling down ${cooldownSeconds}s and trying next provider`)
    } finally {
      clearTimeout(timer)
    }
  }

  const configured = order.join(", ")
  const detail = failures.slice(-3).map((failure) => `${failure.provider}:${failure.status}`).join(", ")
  throw new Error(`All configured AI providers are temporarily unavailable (${configured})${detail ? `; last failures: ${detail}` : ""}.`)
}
