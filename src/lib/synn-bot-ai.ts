// This module is imported by the custom Socket.IO server through server.ts.
// Do not import Next's `server-only` sentinel here: PM2 starts Synnical through
// raw Node/tsx and the same module must work in that runtime.
if (typeof window !== "undefined") {
  throw new Error("synn-bot-ai is server-only")
}

import { aiProviderStatus, completeWithAiPool, type AiChatMessage } from "./ai-provider-pool"
import type { SynnBotAiRequest } from "./synn-bot"

type ContextMessage = { username: string; content: string }

export async function runSynnBotAi(request: SynnBotAiRequest, context: ContextMessage[]): Promise<string> {
  if (!request.request) return `Add a request after /${request.command}.`
  if (!aiProviderStatus().some((provider) => provider.configured)) {
    return "Synn Bot's assistant commands are not configured yet. Ask the owner to add at least one supported AI provider key."
  }

  const messages: AiChatMessage[] = [
    {
      role: "system",
      content: [
        "You are synn Bot, the built-in assistant in Synnical chat.",
        "Be helpful, accurate, concise, and safe. You are part of Synnical OS, so do not say you are just a generic virtual assistant.",
        "Your product identity is Synn Bot. Never claim that you are LFM, GPT, Gemini, Claude, Liquid AI, OpenAI, or any underlying model/provider. If asked what model or provider powers you, say that Synn Bot uses Synnical's configured provider pool and that /provider shows the current configured providers.",
        "Never claim to have performed an external action you did not perform. If a Synnical action is not wired as a real tool, say that it is not wired yet and name the closest supported command.",
        "Keep boundaries normal: do not produce sexual, fetish, degrading, or creepy roleplay. Briefly redirect to useful Synnical help.",
        request.instruction,
        request.mode,
      ].join(" "),
    },
    ...(context.length ? [{
      role: "system" as const,
      content: `Recent channel context:\n${context.slice(-8).map((item) => `${item.username}: ${item.content.slice(0, 400)}`).join("\n")}`,
    }] : []),
    { role: "user", content: request.request.slice(0, 8_000) },
  ]

  try {
    const completion = await completeWithAiPool({
      messages,
      temperature: 0.45,
      maxTokens: 900,
      timeoutMs: 55_000,
    })
    return completion.text.trim().slice(0, 4_000)
  } catch (error) {
    console.error("[synn-bot] all completion providers unavailable", error instanceof Error ? error.message : "unknown")
    return "Synn Bot's assistant providers are temporarily unavailable. Synnical will try every configured provider again automatically on your next assistant command."
  }
}
