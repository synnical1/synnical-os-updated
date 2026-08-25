"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Bot, Send, Loader2, Trash2, User, Hash, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useSetting } from "@/lib/settings-runtime"

type Message = { role: "user" | "assistant"; content: string; tokens?: { promptTokens: number; completionTokens: number; totalTokens: number } }

// Suggestion chips shown when autoSuggest is enabled
const SUGGESTION_CHIPS = [
  "How do I verify ownership?",
  "Best strategy for 2048?",
  "Write a Python function",
  "What can I do here?",
]

// Dynamic suggestions based on the last message
function getDynamicSuggestions(lastMessage: string): string[] {
  const lower = lastMessage.toLowerCase()
  if (lower.includes("code") || lower.includes("python") || lower.includes("function")) {
    return ["Explain how that works", "Add error handling", "Write a test for it"]
  }
  if (lower.includes("game") || lower.includes("play")) {
    return ["What games are available?", "How does cloud gaming work?", "Tips for beginners"]
  }
  if (lower.includes("verify") || lower.includes("ownership")) {
    return ["What are the benefits of verifying?", "How long does it take?", "Can I lose verification?"]
  }
  return ["Tell me more", "Give me an example", "Can you simplify that?"]
}

export function AIPanel() {
  // ── AI settings (wired to settings runtime) ──
  const [aiModel] = useSetting<string>("ai.model", "default")
  const [temperature] = useSetting<number>("ai.temperature", 70)
  const [maxTokens] = useSetting<number>("ai.maxTokens", 2048)
  const [systemPrompt] = useSetting<string>("ai.systemPrompt", "")
  const [streamResponses] = useSetting<boolean>("ai.stream", true)
  const [showTokenCount] = useSetting<boolean>("ai.showTokens", false)
  const [autoSuggest] = useSetting<boolean>("ai.autoSuggest", true)
  const [responseStyle] = useSetting<string>("ai.responseStyle", "balanced")

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const [suggestions, setSuggestions] = useState<string[]>(SUGGESTION_CHIPS)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading, streamingText])

  // Update suggestions when autoSuggest is on and messages change
  useEffect(() => {
    if (!autoSuggest) {
      setSuggestions([])
      return
    }
    if (messages.length === 0) {
      setSuggestions(SUGGESTION_CHIPS)
    } else {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === "assistant") {
        setSuggestions(getDynamicSuggestions(lastMsg.content))
      }
    }
  }, [messages, autoSuggest])

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    const userMsg: Message = { role: "user", content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput("")
    setLoading(true)
    setStreamingText("")

    // Hard timeout — if the AI hasn't started streaming in 60s, abort and
    // show an error. The previous implementation could hang indefinitely on
    // a slow upstream response, leaving the user staring at a spinner.
    const controller = new AbortController()
    const TIMEOUT_MS = 120_000 // 2 minutes for the whole streaming response
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      // Pass all AI settings to the API
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: systemPrompt || undefined,
          model: aiModel,
          temperature,
          maxTokens,
          responseStyle,
          stream: streamResponses,
        }),
        signal: controller.signal,
      })

      // If the response is SSE, Content-Type will be "text/event-stream".
      const ct = res.headers.get("content-type") || ""
      const isSSE = ct.includes("text/event-stream") && res.body

      if (streamResponses && isSSE) {
        // ── Real SSE streaming path ────────────────────────────────────
        // The server sends `data: {response: "tok"}\n\n` chunks. We
        // concatenate them onto streamingText so the user sees the message
        // grow in real-time. The final `data: {done: true, tokenInfo}``
        // chunk carries the token usage.
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        let accumulated = ""
        let tokenInfo: Message["tokens"] | undefined

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // SSE events are separated by `\n\n`
          let idx: number
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const rawEvent = buf.slice(0, idx)
            buf = buf.slice(idx + 2)

            for (const line of rawEvent.split("\n")) {
              if (!line.startsWith("data:")) continue
              const payload = line.slice(5).trim()
              if (!payload) continue
              try {
                const obj = JSON.parse(payload)
                if (obj.error) {
                  toast.error(obj.error)
                  return
                }
                if (typeof obj.response === "string") {
                  accumulated += obj.response
                  setStreamingText(accumulated)
                }
                if (obj.done) {
                  if (obj.tokenInfo) tokenInfo = obj.tokenInfo
                }
              } catch {
                // Ignore malformed lines
              }
            }
          }
        }

        if (!accumulated.trim()) {
          toast.error("AI returned an empty response. Try rephrasing.")
          return
        }

        setMessages([
          ...newMessages,
          { role: "assistant", content: accumulated, tokens: tokenInfo },
        ])
      } else if (res.body && streamResponses) {
        // ── Legacy chunked path (server returned JSON, not SSE) ────────
        // The server may have fallen back to a single JSON response. Read
        // it whole and try to parse.
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          accumulated += decoder.decode(value, { stream: true })
          setStreamingText(accumulated)
        }

        let finalContent = accumulated
        let tokenInfo: Message["tokens"] | undefined
        try {
          const parsed = JSON.parse(accumulated)
          if (parsed.response) {
            finalContent = parsed.response
            if (parsed.tokenInfo) tokenInfo = parsed.tokenInfo
          } else if (parsed.error) {
            toast.error(parsed.error)
            return
          }
        } catch {
          // Not JSON — use as-is
        }

        if (!finalContent.trim()) {
          toast.error("AI returned an empty response. Try rephrasing.")
          return
        }

        setMessages([
          ...newMessages,
          { role: "assistant", content: finalContent, tokens: tokenInfo },
        ])
      } else {
        // ── Non-streaming JSON path ────────────────────────────────────
        const data = await res.json().catch(() => ({}))
        if (data.response) {
          setMessages([
            ...newMessages,
            { role: "assistant", content: data.response, tokens: data.tokenInfo },
          ])
        } else {
          toast.error(data.error || "AI failed to respond")
        }
      }
    } catch (e: any) {
      if (e?.name === "AbortError") {
        toast.error("AI took too long to respond. Please try again.")
      } else {
        toast.error(`Connection error: ${e?.message || e}`)
      }
    } finally {
      clearTimeout(timer)
      setLoading(false)
      setStreamingText("")
    }
  }

  const clear = () => {
    setMessages([])
    setSuggestions(SUGGESTION_CHIPS)
    toast.info("Conversation cleared")
  }

  // Model display name
  const modelDisplay: Record<string, string> = {
    default: "Default",
    fast: "Fast",
    creative: "Creative",
    precise: "Precise",
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 shrink-0 px-4 flex items-center justify-between border-b border-[var(--synnical-border)]">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-[#101010] border border-[#2a2a2a] flex items-center justify-center">
            <Bot className="h-4 w-4 text-[var(--synnical-accent)]" />
          </div>
          <span className="font-semibold text-[var(--synnical-text)]">Synnical AI</span>
          {/* Model badge */}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)] border border-[var(--synnical-border)]">
            {modelDisplay[aiModel] || aiModel}
          </span>
          {/* Response style badge */}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)] border border-[var(--synnical-border)] capitalize hidden sm:inline">
            {responseStyle}
          </span>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-[var(--synnical-muted)]" onClick={clear}>
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scroll px-4 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="h-14 w-14 rounded-2xl bg-[#101010] border border-[#2a2a2a] flex items-center justify-center mb-3">
              <Bot className="h-7 w-7 text-[var(--synnical-accent)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--synnical-text)]">Synnical AI Assistant</h2>
            <p className="text-sm text-[var(--synnical-muted)] mt-1 max-w-xs">
              Ask me anything — gaming tips, coding help, general questions, or how to use Synnical.
            </p>
            {/* Suggestion chips (controlled by autoSuggest setting) */}
            {autoSuggest && (
              <div className="grid grid-cols-2 gap-2 mt-4 max-w-sm">
                {SUGGESTION_CHIPS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); send(s) }}
                    className="text-xs px-3 py-2 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)] hover:border-[var(--synnical-accent)]/40 hover:bg-[var(--synnical-surface-2)] transition-colors text-[var(--synnical-muted)] hover:text-[var(--synnical-text)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
            <div className={cn(
              "h-8 w-8 shrink-0 rounded-lg flex items-center justify-center mt-0.5",
              m.role === "user" ? "bg-[var(--synnical-surface-2)]" : "bg-[#101010] border border-[#2a2a2a]"
            )}>
              {m.role === "user" ? <User className="h-4 w-4 text-[var(--synnical-muted)]" /> : <Bot className="h-4 w-4 text-[var(--synnical-accent)]" />}
            </div>
            <div className="max-w-[75%]">
              <div className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "bg-[var(--synnical-accent)] text-black" : "bg-[var(--synnical-surface)] border border-[var(--synnical-border)] text-[var(--synnical-text)]"
              )}>
                {m.role === "assistant" ? (
                  <div className="prose-sm max-w-none [&_a]:text-[var(--synnical-accent)] [&_a]:underline [&_code]:bg-[var(--synnical-bg)] [&_code]:px-1 [&_code]:rounded [&_pre]:bg-[var(--synnical-bg)] [&_pre]:p-2 [&_pre]:rounded">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
                    }}>
                      {m.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{m.content}</p>
                )}
              </div>
              {/* Token count display (controlled by showTokens setting) */}
              {showTokenCount && m.tokens && (
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--synnical-muted)]">
                  <Hash className="h-3 w-3" />
                  <span>{m.tokens.promptTokens} in</span>
                  <span>{m.tokens.completionTokens} out</span>
                  <span className="text-[var(--synnical-accent)]">{m.tokens.totalTokens} total</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {loading && streamingText && (
          <div className="flex gap-2.5">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-[#101010] border border-[#2a2a2a] flex items-center justify-center mt-0.5">
              <Bot className="h-4 w-4 text-[var(--synnical-accent)]" />
            </div>
            <div className="max-w-[75%] rounded-lg px-3 py-2 text-sm bg-[var(--synnical-surface)] border border-[var(--synnical-border)] text-[var(--synnical-text)]">
              <div className="prose-sm max-w-none [&_a]:text-[var(--synnical-accent)] [&_a]:underline [&_code]:bg-[var(--synnical-bg)] [&_code]:px-1 [&_code]:rounded [&_pre]:bg-[var(--synnical-bg)] [&_pre]:p-2 [&_pre]:rounded">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {streamingText}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator (before streaming starts) */}
        {loading && !streamingText && (
          <div className="flex gap-2.5">
            <div className="h-8 w-8 shrink-0 rounded-lg bg-[#101010] border border-[#2a2a2a] flex items-center justify-center mt-0.5">
              <Bot className="h-4 w-4 text-[var(--synnical-accent)]" />
            </div>
            <div className="bg-[var(--synnical-surface)] border border-[var(--synnical-border)] rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--synnical-accent)]" />
            </div>
          </div>
        )}

        {/* Dynamic suggestion chips (controlled by autoSuggest setting) */}
        {autoSuggest && !loading && messages.length > 0 && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-10">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)] hover:border-[var(--synnical-accent)]/40 hover:bg-[var(--synnical-surface-2)] transition-colors text-[var(--synnical-muted)] hover:text-[var(--synnical-text)] flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 p-3 border-t border-[var(--synnical-border)]">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask Synnical AI anything…"
            disabled={loading}
            className="flex-1 bg-[var(--synnical-surface-2)] border-[var(--synnical-border)] text-[var(--synnical-text)]"
          />
          <Button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black"
            size="icon"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
