export type ProviderFailure = {
  publicCode: string
  message: string
  status: number
  retryAfterSeconds?: number
  providerCode?: string
}

function parseProviderCode(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody)
    const value = parsed?.error?.code ?? parsed?.code
    if (typeof value === "number" || typeof value === "string") return String(value)
  } catch {}
  return undefined
}

function retryDelay(value: string | null, fallback: number): number {
  if (!value) return fallback
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(3600, Math.ceil(seconds))
  const at = Date.parse(value)
  if (Number.isFinite(at)) return Math.min(3600, Math.max(1, Math.ceil((at - Date.now()) / 1000)))
  return fallback
}

/**
 * Convert OpenAI's HTTP status and structured error code into a stable,
 * non-secret response for the browser.
 */
export function describeProviderFailure(
  status: number,
  rawBody: string,
  retryAfterHeader: string | null,
): ProviderFailure {
  const providerCode = parseProviderCode(rawBody)
  const retryAfterSeconds = retryDelay(retryAfterHeader, status === 429 ? 60 : 5)

  if (status === 429) {
    if (providerCode === "insufficient_quota") {
      return {
        publicCode: "AI_CREDITS_EXHAUSTED",
        message: "The OpenAI project has no available API quota. Add billing credit or increase the project limit.",
        status: 429,
        retryAfterSeconds,
        providerCode,
      }
    }
    return {
      publicCode: "AI_PROVIDER_RATE_LIMITED",
      message: `OpenAI is temporarily busy for this API key. Synnical already retried once; try again in about ${retryAfterSeconds} second(s).`,
      status: 429,
      retryAfterSeconds,
      providerCode,
    }
  }

  if (status === 401 || status === 403) {
    return {
      publicCode: "AI_PROVIDER_AUTH_FAILED",
      message: "OpenAI rejected the configured API key or its project permissions.",
      status: 502,
      providerCode,
    }
  }

  return {
    publicCode: `AI_PROVIDER_HTTP_${status}`,
    message: "The AI provider could not complete this request.",
    status: status >= 500 ? 503 : 502,
    retryAfterSeconds: status >= 500 ? retryAfterSeconds : undefined,
    providerCode,
  }
}
