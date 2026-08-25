"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { SEARCH_ENGINES } from "@/lib/client-constants"
import { useBrowser } from "@/hooks/use-browser"
import { DEFAULT_PRESENCE_CONFIG, PRESENCE_LABELS, normalizePresenceConfig, publicPresenceLabel, type PresenceConfig, type PresenceMode } from "@/lib/presence"
import {
  readSetting as readRuntimeSetting,
  writeSetting as writeRuntimeSetting,
} from "@/lib/settings-runtime"

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function readSetting<T>(key: string, fallback: T): T {
  return readRuntimeSetting(key, fallback)
}

function writeSetting<T>(key: string, value: T) {
  writeRuntimeSetting(key, value)
}

function useLocalSetting<T>(key: string, fallback: T) {
  const [val, setVal] = useState<T>(fallback)
  useEffect(() => { setVal(readSetting<T>(key, fallback)) }, [key])
  const update = useCallback((next: T) => { setVal(next); writeSetting(key, next) }, [key])
  return [val, update] as const
}

function SettingRow({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="synnical-setting-row flex items-center justify-between gap-4 py-3 border-b border-[var(--synnical-border)] last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--synnical-text)]">{title}</p>
        {desc && <p className="text-xs text-[var(--synnical-muted)] mt-0.5">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight text-[var(--synnical-text)]">{title}</h1>
      {desc && <p className="text-sm text-[var(--synnical-muted)] mt-1">{desc}</p>}
    </div>
  )
}

function NumberSelectRow({ title, desc, value, min, max, step, onChange, unit }: {
  title: string; desc?: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string
}) {
  const options: number[] = []
  const count = Math.floor((max - min) / step) + 1
  const displayStep = count > 24 ? step * Math.ceil(count / 18) : step
  for (let option = min; option <= max; option += displayStep) options.push(option)
  if (!options.includes(max)) options.push(max)
  if (!options.includes(value)) options.push(value)
  options.sort((a, b) => a - b)

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-[var(--synnical-border)] last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--synnical-text)]">{title}</p>
        {desc && <p className="text-xs text-[var(--synnical-muted)] mt-0.5">{desc}</p>}
      </div>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger className="h-9 w-32 bg-[#080808]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={String(option)}>{option}{unit ?? "%"}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/* ================================================================== */
/* 1. Chat Settings (15 settings)                                     */
/* ================================================================== */

export function ChatSettingsSection() {
  const [showTimestamps, setShowTimestamps] = useLocalSetting<boolean>("chat.showTimestamps", true)
  const [timeFormat24h, setTimeFormat24h] = useLocalSetting<boolean>("chat.24hTime", false)
  const [enterToSend, setEnterToSend] = useLocalSetting<boolean>("chat.enterToSend", true)
  const [showEditHistory, setShowEditHistory] = useLocalSetting<boolean>("chat.editHistory", true)
  const [autoScroll, setAutoScroll] = useLocalSetting<boolean>("chat.autoScroll", true)
  const [showTyping, setShowTyping] = useLocalSetting<boolean>("chat.typingIndicators", true)
  const [mentionColor, setMentionColor] = useLocalSetting<string>("chat.mentionColor", "#5865f2")
  const [maxMsgWarn, setMaxMsgWarn] = useLocalSetting<number>("chat.maxMsgWarn", 1500)
  const [showDeleted, setShowDeleted] = useLocalSetting<boolean>("chat.showDeleted", false)
  const [compactEmoji, setCompactEmoji] = useLocalSetting<boolean>("chat.compactEmoji", false)
  const [autoEmbed, setAutoEmbed] = useLocalSetting<boolean>("chat.autoEmbed", true)
  const [showOnlineStatus, setShowOnlineStatus] = useLocalSetting<boolean>("chat.showOnlineStatus", true)
  const [chatVolume, setChatVolume] = useLocalSetting<number>("chat.notificationVolume", 80)
  const [msgDensity, setMsgDensity] = useLocalSetting<"cozy" | "compact" | "ultra-compact">("chat.msgDensity", "cozy")

  return (
    <div>
      <SectionTitle title="Chat" desc="Customize your chat experience." />
      <SettingRow title="Show Timestamps" desc="Display timestamps on each message."><Switch checked={showTimestamps} onCheckedChange={setShowTimestamps} /></SettingRow>
      <SettingRow title="24-Hour Time" desc="Use 24-hour format instead of AM/PM."><Switch checked={timeFormat24h} onCheckedChange={setTimeFormat24h} /></SettingRow>
      <SettingRow title="Enter to Send" desc="Press Enter to send messages. Disable to use Ctrl+Enter."><Switch checked={enterToSend} onCheckedChange={setEnterToSend} /></SettingRow>
      <SettingRow title="Edit History" desc="Show when messages have been edited."><Switch checked={showEditHistory} onCheckedChange={setShowEditHistory} /></SettingRow>
      <SettingRow title="Auto-Scroll" desc="Automatically scroll to new messages."><Switch checked={autoScroll} onCheckedChange={setAutoScroll} /></SettingRow>
      <SettingRow title="Typing Indicators" desc="Show when others are typing."><Switch checked={showTyping} onCheckedChange={setShowTyping} /></SettingRow>
      <SettingRow title="Mention Color" desc="Highlight color for @mentions.">
        <input type="color" value={mentionColor} onChange={(e) => setMentionColor(e.target.value)} className="h-8 w-12 rounded border border-[var(--synnical-border)] bg-transparent cursor-pointer" />
      </SettingRow>
      <NumberSelectRow title="Message Length Warning" desc="Warn when approaching character limit." value={maxMsgWarn} min={100} max={2000} step={100} onChange={setMaxMsgWarn} />
      <SettingRow title="Show Deleted Messages" desc="Display placeholder text for deleted messages."><Switch checked={showDeleted} onCheckedChange={setShowDeleted} /></SettingRow>
      <SettingRow title="Compact Emoji" desc="Display emojis at a smaller size."><Switch checked={compactEmoji} onCheckedChange={setCompactEmoji} /></SettingRow>
      <SettingRow title="Auto-Embed Links" desc="Automatically preview links in messages."><Switch checked={autoEmbed} onCheckedChange={setAutoEmbed} /></SettingRow>
      <SettingRow title="Show People Rail" desc="Show the online/offline people list in Chat on this device."><Switch checked={showOnlineStatus} onCheckedChange={setShowOnlineStatus} /></SettingRow>
      <NumberSelectRow title="Chat Notification Volume" desc="Volume for chat notification sounds." value={chatVolume} min={0} max={100} step={5} onChange={setChatVolume} />
      <SettingRow title="Message Density" desc="Spacing between chat messages.">
        <Select value={msgDensity} onValueChange={(v) => setMsgDensity(v as typeof msgDensity)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="cozy">Cozy</SelectItem><SelectItem value="compact">Compact</SelectItem><SelectItem value="ultra-compact">Ultra Compact</SelectItem></SelectContent>
        </Select>
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* Presence & activity                                                 */
/* ================================================================== */

export function PresenceSettingsSection() {
  const [config, setConfig] = useState<PresenceConfig>(DEFAULT_PRESENCE_CONFIG)
  const configRef = useRef<PresenceConfig>(DEFAULT_PRESENCE_CONFIG)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pendingSavesRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [duration, setDuration] = useState("until-changed")

  const replaceConfig = useCallback((next: PresenceConfig) => {
    configRef.current = next
    setConfig(next)
    if (!next.modeExpiresAt) {
      setDuration("until-changed")
      return
    }
    const remaining = Math.max(0, new Date(next.modeExpiresAt).getTime() - Date.now()) / 60000
    setDuration(remaining <= 18 ? "15m" : remaining <= 40 ? "30m" : "1h")
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/features/presence", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error || "Could not load presence")
        if (!cancelled) replaceConfig(normalizePresenceConfig(body.config))
      })
      .catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load presence") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [replaceConfig])

  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent<{ config?: unknown }>).detail?.config
      if (next) replaceConfig(normalizePresenceConfig(next))
    }
    window.addEventListener("synnical-presence-config-changed", receive)
    return () => window.removeEventListener("synnical-presence-config-changed", receive)
  }, [replaceConfig])

  const save = useCallback((patch: Partial<PresenceConfig>) => {
    const optimistic = normalizePresenceConfig({ ...configRef.current, ...patch })
    replaceConfig(optimistic)
    pendingSavesRef.current += 1
    setSaving(true)

    const run = async () => {
      try {
        const response = await fetch("/api/features/presence", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error || "Could not update presence")
        const next = normalizePresenceConfig(body.config)
        replaceConfig(next)
        window.dispatchEvent(new CustomEvent("synnical-presence-config-changed", { detail: { config: next } }))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update presence")
        const response = await fetch("/api/features/presence", { credentials: "include", cache: "no-store" }).catch(() => null)
        if (response?.ok) {
          const body = await response.json().catch(() => ({}))
          replaceConfig(normalizePresenceConfig(body.config))
        }
      } finally {
        pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1)
        setSaving(pendingSavesRef.current > 0)
      }
    }

    const queued = saveQueueRef.current.catch(() => {}).then(run)
    saveQueueRef.current = queued
    return queued
  }, [replaceConfig])

  const setMode = (mode: PresenceMode) => {
    const minutes = mode === "free_15" ? 15 : duration === "15m" ? 15 : duration === "30m" ? 30 : duration === "1h" ? 60 : 0
    const modeExpiresAt = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null
    void save({ mode, modeExpiresAt })
  }

  const setDurationForCurrentMode = (nextDuration: string) => {
    setDuration(nextDuration)
    if (config.mode === "online" || config.mode === "free_15") return
    const minutes = nextDuration === "15m" ? 15 : nextDuration === "30m" ? 30 : nextDuration === "1h" ? 60 : 0
    void save({ mode: config.mode, modeExpiresAt: minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null })
  }

  return (
    <div>
      <SectionTitle title="Presence & Activity" desc="Control how your availability appears across Synnical. Game activity remains separate from your social availability." />
      {loading ? <p className="text-sm text-[var(--synnical-muted)]">Loading presence…</p> : <>
        <SettingRow title="Availability" desc="Choose what people should know at a glance.">
          <Select value={config.mode} onValueChange={(value) => setMode(value as PresenceMode)} disabled={saving}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PRESENCE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title="Temporary Status" desc="Automatically return to Online after a short period.">
          <Select value={duration} onValueChange={setDurationForCurrentMode} disabled={saving || config.mode === "free_15"}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="until-changed">Until changed</SelectItem>
              <SelectItem value="15m">15 minutes</SelectItem>
              <SelectItem value="30m">30 minutes</SelectItem>
              <SelectItem value="1h">1 hour</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow title="AFK Message" desc="Shown after five minutes without activity.">
          <Input disabled={saving} value={config.afkMessage} onChange={(event) => setConfig({ ...config, afkMessage: event.target.value.slice(0, 80) })} onBlur={() => void save({ afkMessage: config.afkMessage })} className="w-52" maxLength={80} placeholder="Away" />
        </SettingRow>
        <SettingRow title="Share Current Section" desc="When enabled, people can see whether you're in Chat, Games, Movies, Music, Browser, and other Synnical sections. Off by default.">
          <Switch disabled={saving} checked={config.shareSection} onCheckedChange={(value) => void save({ shareSection: value })} />
        </SettingRow>
        <SettingRow title="Show Device Type" desc="Optionally show desktop, mobile, or tablet next to your presence. Off by default.">
          <Switch disabled={saving} checked={config.shareDevice} onCheckedChange={(value) => void save({ shareDevice: value })} />
        </SettingRow>
        <SettingRow title="Show Online Duration" desc="Let people see how long your current online session has lasted. Off by default.">
          <Switch disabled={saving} checked={config.showOnlineDuration} onCheckedChange={(value) => void save({ showOnlineDuration: value })} />
        </SettingRow>
        <SettingRow title="Share Connection Quality" desc="Share a simple Good / Fair / Poor connection indicator when the browser exposes network information. Off by default.">
          <Switch disabled={saving} checked={config.shareNetworkQuality} onCheckedChange={(value) => void save({ shareNetworkQuality: value })} />
        </SettingRow>
        <p className="mt-3 text-xs text-[var(--synnical-muted)]">Current: {publicPresenceLabel(config.mode, false, config.modeExpiresAt)}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={saving} variant="outline" onClick={() => { setDuration("15m"); void save({ mode: "free_15", modeExpiresAt: new Date(Date.now() + 15 * 60000).toISOString() }) }}>Free for 15 minutes</Button>
          <Button disabled={saving} variant="outline" onClick={() => { setDuration("30m"); void save({ mode: "busy", modeExpiresAt: new Date(Date.now() + 30 * 60000).toISOString() }) }}>Busy for 30 minutes</Button>
          <Button disabled={saving} variant="outline" onClick={() => { setDuration("until-changed"); void save({ mode: "online", modeExpiresAt: null }) }}>Back to Online</Button>
        </div>
      </>}
    </div>
  )
}

/* ================================================================== */
/* 2. Games Settings                                                   */
/* ================================================================== */

export function GamesSettingsSection() {
  const [gameNotifs, setGameNotifs] = useLocalSetting<boolean>("games.notifications", true)
  const [gameVolume, setGameVolume] = useLocalSetting<number>("games.volume", 100)
  const [deadzone, setDeadzone] = useLocalSetting<number>("games.deadzone", 15)
  const [gamepad, setGamepad] = useLocalSetting<boolean>("games.gamepad", true)

  return (
    <div>
      <SectionTitle title="Cloud Gaming" desc="Configure controls, audio, and session notifications." />
      <SettingRow title="Game Notifications" desc="Show a notification when a queued game becomes ready."><Switch checked={gameNotifs} onCheckedChange={setGameNotifs} /></SettingRow>
      <NumberSelectRow title="Game Volume" desc="Audio volume applied by the in-page WebRTC player." value={gameVolume} min={0} max={100} step={5} onChange={setGameVolume} />
      <NumberSelectRow title="Controller Deadzone" desc="Ignore small analog-stick movement below this percentage." value={deadzone} min={0} max={50} step={1} onChange={setDeadzone} />
      <SettingRow title="Gamepad Support" desc="Send connected controller input to the active game session."><Switch checked={gamepad} onCheckedChange={setGamepad} /></SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 3. Browser Settings                                                 */
/* ================================================================== */

export function BrowserSettingsSection() {
  const { clearHistory } = useBrowser()
  const [searchEngine, setSearchEngine] = useLocalSetting<string>("browser.searchEngine", "duckduckgo")
  const [homepage, setHomepage] = useLocalSetting<string>("browser.homepage", "")
  const [blockPopups, setBlockPopups] = useLocalSetting<boolean>("browser.blockPopups", true)
  const [blockAds, setBlockAds] = useLocalSetting<boolean>("ads.enabled", true)
  const [enableJs, setEnableJs] = useLocalSetting<boolean>("browser.enableJs", true)
  const [vpnCountry, setVpnCountry] = useLocalSetting<string>("browser.vpnCountry", "direct")
  const [netherlandsAvailable, setNetherlandsAvailable] = useState<boolean | null>(null)
  const [clearOnExit, setClearOnExit] = useLocalSetting<boolean>("browser.clearOnExit", false)
  const [zoomLevel, setZoomLevel] = useLocalSetting<number>("browser.zoom", 100)
  const [newTabBehavior, setNewTabBehavior] = useLocalSetting<string>("browser.newTab", "blank")

  const clearHistoryNow = useCallback(() => {
    clearHistory()
    toast.success("Browser history cleared")
  }, [clearHistory])

  useEffect(() => {
    let cancelled = false
    fetch("/api/browser/vpn/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("status unavailable")))
      .then((body) => {
        if (!cancelled) setNetherlandsAvailable(body?.countries?.netherlands?.available === true)
      })
      .catch(() => { if (!cancelled) setNetherlandsAvailable(false) })
    return () => { cancelled = true }
  }, [])

  const changeVpnCountry = useCallback((country: string) => {
    if (country === "netherlands" && netherlandsAvailable !== true) {
      toast.error("Netherlands route is not configured on this server yet.")
      return
    }
    const normalized = country === "netherlands" ? "netherlands" : "direct"
    setVpnCountry(normalized)
    toast.success(normalized === "netherlands" ? "Netherlands browser route enabled" : "Direct browser route enabled")
    // The Scramjet controller owns a long-lived Wisp transport. Reload once so
    // every open tab moves to the newly selected egress instead of mixing routes.
    window.setTimeout(() => window.location.reload(), 250)
  }, [netherlandsAvailable, setVpnCountry])

  return (
    <div>
      <SectionTitle title="Browser" desc="Configure the built-in proxy browser." />
      <SettingRow title="Default Search Engine" desc="Search engine used in the address bar.">
        <Select value={searchEngine} onValueChange={setSearchEngine}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>{SEARCH_ENGINES.map((engine) => <SelectItem key={engine.id} value={engine.id}>{engine.name}</SelectItem>)}</SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="Homepage" desc="Page opened by Home and the Homepage new-tab option.">
        <Input value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://…" className="w-48" />
      </SettingRow>
      <SettingRow title="VPN Country" desc={netherlandsAvailable === true ? "Route Browser traffic through the configured Netherlands SOCKS5 exit." : "Netherlands requires a real server-side SOCKS5 exit; Synnical will never fake the location."}>
        <Select value={vpnCountry} onValueChange={changeVpnCountry}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="direct">Direct</SelectItem>
            <SelectItem value="netherlands" disabled={netherlandsAvailable !== true}>🇳🇱 Netherlands{netherlandsAvailable === false ? " (unavailable)" : ""}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="Block Popups" desc="Prevent proxied pages from opening popup windows. Active pages reload when this changes."><Switch checked={blockPopups} onCheckedChange={setBlockPopups} /></SettingRow>
      <SettingRow title="Ad Blocking" desc="Block known ad hosts in Synnical pages and proxied browser requests."><Switch checked={blockAds} onCheckedChange={setBlockAds} /></SettingRow>
      <SettingRow title="Enable JavaScript" desc="Allow scripts inside proxied pages. Active pages reload when this changes."><Switch checked={enableJs} onCheckedChange={setEnableJs} /></SettingRow>
      <SettingRow title="Clear History on Exit" desc="Clear the browser history when the app is closed or reloaded."><Switch checked={clearOnExit} onCheckedChange={setClearOnExit} /></SettingRow>
      <SettingRow title="Clear History Now" desc="Immediately delete saved browser history."><Button variant="outline" size="sm" onClick={clearHistoryNow}>Clear</Button></SettingRow>
      <NumberSelectRow title="Default Zoom" desc="Scale proxied pages and update open tabs immediately." value={zoomLevel} min={50} max={200} step={10} onChange={setZoomLevel} />
      <SettingRow title="New Tab Page" desc="What to show on new tabs.">
        <Select value={newTabBehavior} onValueChange={setNewTabBehavior}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="blank">Synnical start page</SelectItem><SelectItem value="homepage">Homepage</SelectItem><SelectItem value="search">Search engine homepage</SelectItem></SelectContent></Select>
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 4. Music Settings                                                   */
/* ================================================================== */

export function MusicSettingsSection() {
  const [musicVolume, setMusicVolume] = useLocalSetting<number>("music.volume", 100)

  return (
    <div>
      <SectionTitle title="Music" desc="Configure the music player." />
      <NumberSelectRow title="Music Volume" desc="Default playback volume." value={musicVolume} min={0} max={100} step={5} onChange={setMusicVolume} />
    </div>
  )
}

/* ================================================================== */
/* 5. AI Assistant Settings (8 settings)                               */
/* ================================================================== */

export function AISettingsSection() {
  const [aiModel, setAiModel] = useLocalSetting<string>("ai.model", "default")
  const [temperature, setTemperature] = useLocalSetting<number>("ai.temperature", 70)
  const [maxTokens, setMaxTokens] = useLocalSetting<number>("ai.maxTokens", 2048)
  const [systemPrompt, setSystemPrompt] = useLocalSetting<string>("ai.systemPrompt", "")
  const [streamResponses, setStreamResponses] = useLocalSetting<boolean>("ai.stream", true)
  const [showTokenCount, setShowTokenCount] = useLocalSetting<boolean>("ai.showTokens", false)
  const [autoSuggest, setAutoSuggest] = useLocalSetting<boolean>("ai.autoSuggest", true)
  const [responseStyle, setResponseStyle] = useLocalSetting<string>("ai.responseStyle", "balanced")

  return (
    <div>
      <SectionTitle title="AI Assistant" desc="Configure the AI chat assistant." />
      <SettingRow title="AI Model" desc="Which model to use for responses.">
        <Select value={aiModel} onValueChange={setAiModel}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Default</SelectItem><SelectItem value="fast">Fast</SelectItem><SelectItem value="creative">Creative</SelectItem><SelectItem value="precise">Precise</SelectItem></SelectContent></Select>
      </SettingRow>
      <NumberSelectRow title="Temperature" desc="Creativity of responses (higher = more creative)." value={temperature} min={0} max={100} step={5} onChange={setTemperature} />
      <NumberSelectRow title="Max Tokens" desc="Maximum response length." value={maxTokens} min={256} max={8192} step={256} onChange={setMaxTokens} unit="" />
      <SettingRow title="System Prompt" desc="Custom instructions for the AI.">
        <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="e.g. You are a helpful assistant…" rows={2} className="w-48" />
      </SettingRow>
      <SettingRow title="Stream Responses" desc="Show responses as they generate."><Switch checked={streamResponses} onCheckedChange={setStreamResponses} /></SettingRow>
      <SettingRow title="Show Token Count" desc="Display token usage per message."><Switch checked={showTokenCount} onCheckedChange={setShowTokenCount} /></SettingRow>
      <SettingRow title="Auto-Suggest" desc="Suggest responses in chat."><Switch checked={autoSuggest} onCheckedChange={setAutoSuggest} /></SettingRow>
      <SettingRow title="Response Style" desc="Tone of AI responses.">
        <Select value={responseStyle} onValueChange={setResponseStyle}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="concise">Concise</SelectItem><SelectItem value="balanced">Balanced</SelectItem><SelectItem value="detailed">Detailed</SelectItem><SelectItem value="friendly">Friendly</SelectItem></SelectContent></Select>
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 7. Mail Settings (6 settings)                                      */
/* ================================================================== */

export function MailSettingsSection() {
  const [defaultDomain, setDefaultDomain] = useLocalSetting<string>("mail.domain", "auto")
  const [autoDelete, setAutoDelete] = useLocalSetting<number>("mail.autoDelete", 7)
  const [desktopNotifs, setDesktopNotifs] = useLocalSetting<boolean>("mail.desktopNotifs", true)
  const [refreshInterval, setRefreshInterval] = useLocalSetting<number>("mail.refresh", 30)
  const [mailFormat, setMailFormat] = useLocalSetting<string>("mail.format", "html")
  const [autoForward, setAutoForward] = useLocalSetting<string>("mail.forward", "")

  return (
    <div>
      <SectionTitle title="Temp Mail" desc="Configure the temporary mail service." />
      <SettingRow title="Default Domain" desc="Mail domain to use for new addresses.">
        <Select value={defaultDomain} onValueChange={setDefaultDomain}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Auto</SelectItem><SelectItem value="mail.tm">Mail.tm</SelectItem></SelectContent></Select>
      </SettingRow>
      <NumberSelectRow title="Auto-Delete After" desc="Delete mail after this many days." value={autoDelete} min={1} max={30} step={1} onChange={setAutoDelete} unit=" days" />
      <SettingRow title="Desktop Notifications" desc="Notify when new mail arrives."><Switch checked={desktopNotifs} onCheckedChange={setDesktopNotifs} /></SettingRow>
      <NumberSelectRow title="Refresh Interval" desc="How often to check for new mail." value={refreshInterval} min={10} max={120} step={10} onChange={setRefreshInterval} unit="s" />
      <SettingRow title="Default Mail Format" desc="Preferred format for reading mail.">
        <Select value={mailFormat} onValueChange={setMailFormat}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="html">HTML</SelectItem><SelectItem value="text">Plain Text</SelectItem></SelectContent></Select>
      </SettingRow>
      <SettingRow title="Auto-Forward To" desc="Forward incoming mail to this address.">
        <Input value={autoForward} onChange={(e) => setAutoForward(e.target.value)} placeholder="you@example.com" className="w-48" />
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 8. Performance Settings (2 enforceable controls)                  */
/* ================================================================== */

export function PerformanceSettingsSection() {
  const [performanceMode, setPerformanceMode] = useLocalSetting<boolean>("perf.mode", false)
  const [autoScale, setAutoScale] = useLocalSetting<boolean>("perf.autoScale", false)

  return (
    <div>
      <SectionTitle title="Performance" desc="Reduce interface cost using controls Synnical can actually enforce in the browser." />
      <SettingRow title="Low-End Device Mode" desc="Reduce expensive animation, blur, shadows and decoration motion while preserving core functionality."><Switch checked={performanceMode} onCheckedChange={setPerformanceMode} /></SettingRow>
      <SettingRow title="Automatic Performance Scaling" desc="Automatically enable the low-cost interface on constrained CPUs, low-memory devices or slow network conditions."><Switch checked={autoScale} onCheckedChange={setAutoScale} /></SettingRow>
      <p className="mt-3 text-xs text-[var(--synnical-muted)]">Browser-level controls that Synnical cannot honestly enforce are intentionally not exposed here.</p>
    </div>
  )
}

/* ================================================================== */
/* 9. Moderation Settings (8 settings)                                */
/* ================================================================== */

export function ModerationSettingsSection() {
  const [warnThreshold, setWarnThreshold] = useLocalSetting<number>("mod.warnThreshold", 3)
  const [muteThreshold, setMuteThreshold] = useLocalSetting<number>("mod.muteThreshold", 5)
  const [banThreshold, setBanThreshold] = useLocalSetting<number>("mod.banThreshold", 7)
  const [muteDuration, setMuteDuration] = useLocalSetting<number>("mod.muteDuration", 60)
  const [appealCooldown, setAppealCooldown] = useLocalSetting<number>("mod.appealCooldown", 7)
  const [showModActions, setShowModActions] = useLocalSetting<boolean>("mod.showActions", false)
  const [requireReason, setRequireReason] = useLocalSetting<boolean>("mod.requireReason", true)
  const [maxWarnings, setMaxWarnings] = useLocalSetting<number>("mod.maxWarnings", 10)

  return (
    <div>
      <SectionTitle title="Moderation" desc="Automated moderation and punishment settings." />
      <NumberSelectRow title="Warn Threshold" desc="Warnings before auto-mute." value={warnThreshold} min={1} max={10} step={1} onChange={setWarnThreshold} unit="" />
      <NumberSelectRow title="Mute Threshold" desc="Warnings before extended mute." value={muteThreshold} min={2} max={15} step={1} onChange={setMuteThreshold} unit="" />
      <NumberSelectRow title="Ban Threshold" desc="Warnings before auto-ban." value={banThreshold} min={3} max={20} step={1} onChange={setBanThreshold} unit="" />
      <NumberSelectRow title="Default Mute Duration" desc="Auto-mute duration in minutes." value={muteDuration} min={5} max={1440} step={5} onChange={setMuteDuration} unit=" min" />
      <NumberSelectRow title="Appeal Cooldown" desc="Days between ban appeals." value={appealCooldown} min={1} max={30} step={1} onChange={setAppealCooldown} unit=" days" />
      <SettingRow title="Show Mod Actions in Chat" desc="Display moderation actions publicly."><Switch checked={showModActions} onCheckedChange={setShowModActions} /></SettingRow>
      <SettingRow title="Require Reason" desc="Moderators must provide a reason for actions."><Switch checked={requireReason} onCheckedChange={setRequireReason} /></SettingRow>
      <NumberSelectRow title="Max Warnings" desc="Maximum warnings before permanent action." value={maxWarnings} min={5} max={20} step={1} onChange={setMaxWarnings} unit="" />
    </div>
  )
}

/* ================================================================== */
/* 10. Profile Settings (8 settings)                                  */
/* ================================================================== */

export function ProfileSettingsSection() {
  const [showOnline, setShowOnline] = useLocalSetting<boolean>("profile.showOnline", true)
  const [showActivity, setShowActivity] = useLocalSetting<boolean>("profile.showActivity", true)
  const [showLastSeen, setShowLastSeen] = useLocalSetting<boolean>("profile.showLastSeen", false)
  const [showStats, setShowStats] = useLocalSetting<boolean>("profile.showStats", true)
  const [showConnections, setShowConnections] = useLocalSetting<boolean>("profile.showConnections", true)
  const [profileBg, setProfileBg] = useLocalSetting<string>("profile.background", "")

  return (
    <div>
      <SectionTitle title="Profile Card Display" desc="Choose what profile cards show on this device. Who other people can actually see is controlled server-side in Privacy & Safety." />
      <SettingRow title="Show Presence on Cards" desc="Display online or availability information when the other account allows it."><Switch checked={showOnline} onCheckedChange={setShowOnline} /></SettingRow>
      <SettingRow title="Show Activity on Cards" desc="Display shared status and activity details when available."><Switch checked={showActivity} onCheckedChange={setShowActivity} /></SettingRow>
      <SettingRow title="Show Online/Offline State" desc="Display the current online/offline summary on profile cards."><Switch checked={showLastSeen} onCheckedChange={setShowLastSeen} /></SettingRow>
      <SettingRow title="Show Profile Statistics" desc="Display shared account statistics such as message count."><Switch checked={showStats} onCheckedChange={setShowStats} /></SettingRow>
      <SettingRow title="Show Connections on Cards" desc="Display connections that the profile owner has allowed you to see."><Switch checked={showConnections} onCheckedChange={setShowConnections} /></SettingRow>
      <SettingRow title="Profile Background" desc="Local background color used when viewing your profile editor.">
        <input type="color" value={profileBg || "#1a1a2e"} onChange={(e) => setProfileBg(e.target.value)} className="h-8 w-12 rounded border border-[var(--synnical-border)] bg-transparent cursor-pointer" />
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 11. Theme Settings (8 settings)                                   */
/* ================================================================== */

export function ThemeSettingsSection() {
  const [customCss, setCustomCss] = useLocalSetting<string>("theme.customCss", "")
  const [animSpeed, setAnimSpeed] = useLocalSetting<number>("theme.animSpeed", 100)
  const [blurIntensity, setBlurIntensity] = useLocalSetting<number>("theme.blur", 100)
  const [shadowIntensity, setShadowIntensity] = useLocalSetting<number>("theme.shadow", 100)
  const [borderRadius, setBorderRadius] = useLocalSetting<number>("theme.radius", 100)
  const [darkModeAuto, setDarkModeAuto] = useLocalSetting<boolean>("theme.darkModeAuto", false)
  const [wallpaper, setWallpaper] = useLocalSetting<string>("theme.wallpaper", "")
  const [accentGradient, setAccentGradient] = useLocalSetting<boolean>("theme.accentGradient", false)

  return (
    <div>
      <SectionTitle title="Theme" desc="Fine-tune visual appearance." />
      <SettingRow title="Custom CSS" desc="Add custom CSS to customize the look.">
        <Textarea value={customCss} onChange={(e) => setCustomCss(e.target.value)} placeholder="/* Custom CSS here */" rows={3} className="w-48 font-mono text-xs" />
      </SettingRow>
      <NumberSelectRow title="Animation Speed" desc="Speed of UI animations." value={animSpeed} min={0} max={200} step={10} onChange={setAnimSpeed} />
      <NumberSelectRow title="Blur Intensity" desc="Backdrop blur strength." value={blurIntensity} min={0} max={200} step={10} onChange={setBlurIntensity} />
      <NumberSelectRow title="Shadow Intensity" desc="Drop shadow strength." value={shadowIntensity} min={0} max={200} step={10} onChange={setShadowIntensity} />
      <NumberSelectRow title="Border Radius" desc="Roundness of UI elements." value={borderRadius} min={0} max={200} step={10} onChange={setBorderRadius} />
      <SettingRow title="Auto Dark Mode" desc="Switch theme based on system preference."><Switch checked={darkModeAuto} onCheckedChange={setDarkModeAuto} /></SettingRow>
      <SettingRow title="Custom Wallpaper" desc="Background image URL for the app.">
        <Input value={wallpaper} onChange={(e) => setWallpaper(e.target.value)} placeholder="https://…" className="w-48" />
      </SettingRow>
      <SettingRow title="Accent Gradient" desc="Use gradient for accent elements."><Switch checked={accentGradient} onCheckedChange={setAccentGradient} /></SettingRow>
    </div>
  )
}
