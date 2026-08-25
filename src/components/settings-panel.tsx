"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useBrowser } from "@/hooks/use-browser"
import { api, type SafeUser, type Role } from "@/lib/api"
import { ROLES } from "@/lib/constants"
import {
  PLATFORMS, getPlatform,
  loadConnections, saveConnections,
  loadLegacyConnections, clearLegacyConnections, normalizeConnections,
  type Connection,
} from "@/lib/connections"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { DisplayName, RoleBadge, AvatarWithDeco } from "@/components/role-ui"
import {
  Crown, Loader2, LogOut, Shield, ShieldCheck, KeyRound, Users, VolumeX, Volume2,
  User, IdCard, Lock, Monitor, Link2, Palette, Accessibility,
  Mic, Bell, Keyboard, Languages, Radio, Globe, X, Plus, MessageCircle,
  Camera, Tag, ChevronRight, ChevronLeft, Search, Ban, Eye, Trash2,
  Gamepad2, Compass, Music, Bot, Mailbox, Zap, Gavel, Puzzle,
} from "lucide-react"
import {
  ChatSettingsSection, GamesSettingsSection, BrowserSettingsSection,
  MusicSettingsSection,
  ProfileSettingsSection, PresenceSettingsSection, PerformanceSettingsSection,
} from "@/components/settings-extra-sections"
import { readSetting, writeSetting } from "@/lib/settings-runtime"
import { toast } from "sonner"
import { AuthScreen } from "@/components/auth-screen"
import { SYNNICAL_BUILD, SYNNICAL_BUILD_DATE, SYNNICAL_VERSION } from "@/lib/build-info"
import { R7DevicesControls, R7PrivacyControls, R7SecurityControls } from "@/components/r7-settings"
import { BIG_SITE_OWNER_TAG, DEV_TAG, NOTABLE_PERSON_TAG } from "@/lib/recognition-tags"

/* ------------------------------------------------------------------ */
/* localStorage settings helper                                       */
/* ------------------------------------------------------------------ */

/** Reactive local-persisted setting.
 *
 * Uses the shared runtime so controls stay synchronized with the panels that
 * consume them.
 */
function useLocalSetting<T>(key: string, fallback: T) {
  const [val, setVal] = useState<T>(() => readSetting<T>(key, fallback))
  useEffect(() => {
    setVal(readSetting<T>(key, fallback))
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === key) setVal(readSetting<T>(key, fallback))
    }
    window.addEventListener("synnical-setting-changed", handler)
    return () => window.removeEventListener("synnical-setting-changed", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const update = useCallback(
    (next: T) => {
      setVal(next)
      writeSetting(key, next)
    },
    [key],
  )
  return [val, update] as const
}

/* ------------------------------------------------------------------ */
/* Tag color helper                                                   */
/* ------------------------------------------------------------------ */

const TAG_COLORS = [
  "#38bdf8", "#6366f1", "#06b6d4", "#22c55e",
  "#f59e0b", "#ef4444", "#3b82f6", "#a855f7",
  "#14b8a6", "#f97316",
]

function tagColor(tag: string): string {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return TAG_COLORS[h % TAG_COLORS.length]
}

/* ------------------------------------------------------------------ */
/* Section ids                                                         */
/* ------------------------------------------------------------------ */

type SectionId =
  | "account" | "profiles" | "privacy" | "apps" | "devices"
  | "connections" | "appearance" | "accessibility" | "presence" | "voice"
  | "notifications" | "keybinds" | "language" | "streamer"
  | "advanced" | "owner" | "users" | "logout"
  | "security" | "billing" | "activity" | "bookmarks" | "data"
  | "chat" | "games" | "browser" | "music" | "ai"
  | "mail" | "performance" | "moderation" | "profile" | "legal"

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function SettingRow({
  title, desc, children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
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

function FieldGroup({
  label, htmlFor, children, hint,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-[var(--synnical-muted)]">{hint}</p>}
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

function NumberSelect({ value, values, onChange, unit = "%", label }: {
  value: number
  values: number[]
  onChange: (value: number) => void
  unit?: string
  label: string
}) {
  const options = [...new Set([...values, value])].sort((a, b) => a - b)
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger aria-label={label} className="h-9 w-32 bg-[#080808]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option} value={String(option)}>{option}{unit}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/* ================================================================== */
/* Main component                                                     */
/* ================================================================== */

export function SettingsPanel() {
  const { user, setUser, logout } = useAuth()
  const [section, setSection] = useState<SectionId>(() => user ? "account" : "appearance")
  useEffect(() => {
    const handler = (event: Event) => {
      const value = (event as CustomEvent<{ section?: unknown }>).detail?.section
      const allowed: SectionId[] = ["account","profiles","privacy","apps","devices","connections","appearance","accessibility","presence","voice","notifications","keybinds","language","streamer","advanced","owner","users","logout","security","billing","activity","bookmarks","data","chat","games","browser","music","ai","mail","performance","moderation","profile","legal"]
      if (typeof value === "string" && allowed.includes(value as SectionId)) setSection(value as SectionId)
    }
    window.addEventListener("synnical-settings-open", handler)
    return () => window.removeEventListener("synnical-settings-open", handler)
  }, [])
  const isOwner = user?.role === "OWNER" || user?.role === "HEAD_ADMIN"

  const navGroups: { heading?: string; items: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }>; danger?: boolean; modOnly?: boolean }[] }[] = [
    {
      heading: user ? "Account" : "Account (optional)",
      items: user ? [
        { id: "account", label: "My Account", icon: User },
        { id: "profiles", label: "Profile", icon: IdCard },
        { id: "privacy", label: "Privacy & Safety", icon: Lock },
        { id: "presence", label: "Presence & Activity", icon: Radio },
        { id: "security", label: "Security", icon: Shield },
        { id: "connections", label: "Connections", icon: Link2 },
      ] : [
        { id: "account", label: "Log in or sign up", icon: User },
      ],
    },
    {
      heading: "App Settings",
      items: [
        { id: "appearance", label: "Appearance", icon: Palette },
        { id: "chat", label: "Chat", icon: MessageCircle },
        { id: "games", label: "Cloud Gaming", icon: Gamepad2 },
        { id: "browser", label: "Browser", icon: Compass },
        { id: "music", label: "Music", icon: Music },
        { id: "voice", label: "Voice & Audio", icon: Mic },
        { id: "notifications", label: "Notifications", icon: Bell },
        { id: "accessibility", label: "Accessibility", icon: Accessibility },
        { id: "performance", label: "Performance", icon: Zap },
      ],
    },
    {
      heading: "Local data",
      items: [
        { id: "bookmarks", label: "Bookmarks", icon: Tag },
        { id: "activity", label: "History", icon: Eye },
        { id: "data", label: "Data & Storage", icon: Monitor },
        { id: "legal", label: "Legal", icon: Gavel },
      ],
    },
  ]

  // Moderation group: Owner Verification is visible to ALL users (so they can
  // verify themselves), User Management is owner-only.
  if (user) navGroups.push({
    heading: "Moderation",
    items: [
      { id: "owner", label: "Owner Verification", icon: KeyRound },
      ...(isOwner ? [{ id: "users" as const, label: "User Management", icon: Users, modOnly: true }] : []),
    ],
  })

  return (
    <div className="settings-workspace flex h-full">
      <aside className="settings-sidebar w-44 sm:w-56 shrink-0 overflow-y-auto custom-scroll px-2 py-4">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-4" : ""}>
            {group.heading && (
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--synnical-muted)]">
                {group.heading}
              </p>
            )}
            <nav className="px-1.5 space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = section === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    className={[
                      "settings-nav-item group flex w-full items-center gap-2 px-2.5 py-2 text-sm transition-colors",
                      active
                        ? "is-active text-[var(--synnical-text)]"
                        : "text-[var(--synnical-muted)] hover:text-[var(--synnical-text)]",
                    ].join(" ")}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                    {active && <ChevronRight className="ml-auto h-3.5 w-3.5 text-[var(--synnical-accent)]" />}
                  </button>
                )
              })}
            </nav>
          </div>
        ))}
        {/* Logout */}
        <div className="mt-4 border-t border-[var(--synnical-border)] px-4 pt-3 text-[10px] leading-4 text-[var(--synnical-muted)]">
          <p className="font-medium text-[var(--synnical-text)]">Synnical {SYNNICAL_VERSION}</p>
          <p className="break-all">{SYNNICAL_BUILD}</p>
        </div>
        {user && <div className="mt-4 px-1.5">
          <button
            onClick={() => setSection("logout")}
            className={[
              "group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              section === "logout"
                ? "bg-[var(--synnical-surface-2)] text-[#ef4444]"
                : "text-[#ef4444] hover:bg-[var(--synnical-surface-2)]",
            ].join(" ")}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>Log Out</span>
          </button>
        </div>}
      </aside>

      {/* Main content */}
      <div className="settings-content flex-1 min-w-0 overflow-y-auto custom-scroll">
        <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8">
          {section === "account" && (user ? <AccountSection /> : <AuthScreen embedded />)}
          {section === "profiles" && <ProfilesSection />}
          {section === "privacy" && <PrivacySection />}
          {section === "apps" && <AuthorizedAppsSection />}
          {section === "devices" && <DevicesSection />}
          {section === "connections" && <ConnectionsSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "accessibility" && <AccessibilitySection />}
          {section === "presence" && <PresenceSettingsSection />}
          {section === "performance" && <PerformanceSettingsSection />}
          {section === "voice" && <VoiceSection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "keybinds" && <KeybindsSection />}
          {section === "language" && <LanguageSection />}
          {section === "streamer" && <StreamerSection />}
          {section === "advanced" && <AdvancedSection />}
          {section === "security" && <SecuritySection />}
          {section === "billing" && <BillingSection />}
          {section === "bookmarks" && <BookmarksSection />}
          {section === "activity" && <ActivityLogSection />}
          {section === "data" && <DataStorageSection />}
          {section === "legal" && <LegalSection />}
          {section === "owner" && <OwnerVerificationSection />}
          {isOwner && section === "users" && <UserManagementSection />}
          {section === "chat" && <ChatSettingsSection />}
          {section === "games" && <GamesSettingsSection />}
          {section === "browser" && <BrowserSettingsSection />}
          {section === "music" && <MusicSettingsSection />}
          {section === "profile" && <ProfileSettingsSection />}
          {section === "logout" && <LogoutSection />}
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 1. My Account                                                      */
/* ================================================================== */

function AccountSection() {
  const { user, setUser } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName ?? "")
  const [username, setUsername] = useState(user?.username ?? "")
  const [bio, setBio] = useState(user?.bio ?? "")
  const [saving, setSaving] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)

  if (!user) return null

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const { user: updated } = await api.updateProfile({ displayName, username: username.trim(), bio })
      setUser(updated)
      toast.success("Profile updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  const uploadPic = async (type: "pfp" | "banner", file: File | undefined) => {
    if (!file) return
    try {
      const result = await api.uploadImage(type, file)
      if (result.pending) {
        toast.success(`${type === "pfp" ? "Avatar" : "Banner"} sent for staff approval`)
      } else if (result.user) {
        setUser(result.user)
        toast.success(`${type === "pfp" ? "Avatar" : "Banner"} updated`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    }
  }

  return (
    <div>
      <SectionTitle title="My Account" desc="Update your account details and identity." />

      {/* Banner + avatar */}
      <div className="rounded-xl overflow-hidden border border-[var(--synnical-border)] mb-6">
        <div className="relative h-28 bg-[var(--synnical-surface-2)]">
          {user.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.bannerUrl} alt="banner" className="h-full w-full object-cover" />
          )}
          <button
            onClick={() => bannerRef.current?.click()}
            className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black px-2 py-1 text-xs text-[var(--synnical-text)] hover:bg-[var(--synnical-bg)]"
          >
            <Camera className="h-3.5 w-3.5" /> Change Banner
          </button>
          <input ref={bannerRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => uploadPic("banner", e.target.files?.[0])} />
        </div>
        <div className="px-4 pb-4 -mt-8 flex items-end gap-3">
          <div className="relative">
            <AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={user.avatarDeco} size="lg" />
            <button
              onClick={() => avatarRef.current?.click()}
              className="absolute -bottom-1 -right-1 inline-flex items-center justify-center h-7 w-7 rounded-full bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black border-2 border-[#0a0a0a]"
              aria-label="Change avatar"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => uploadPic("pfp", e.target.files?.[0])} />
          </div>
          <div className="flex-1 min-w-0 pb-1">
            <DisplayName name={user.displayName} role={user.role} className="text-base font-semibold" />
            <p className="text-xs text-[var(--synnical-muted)]">@{user.username}</p>
          </div>
          {user.role !== "MEMBER" ? <RoleBadge role={user.role} tags={user.tags} /> : (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--synnical-muted)] bg-[var(--synnical-surface-2)] rounded-full px-2.5 py-1">
              <Shield className="h-3.5 w-3.5" /> Member
            </span>
          )}
        </div>
      </div>

      <form onSubmit={saveProfile} className="space-y-4">
        <FieldGroup label="Display Name" htmlFor="displayName">
          <Input id="displayName" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} maxLength={32} />
        </FieldGroup>
        <FieldGroup label="Username" htmlFor="username" hint={`${user.role === "OWNER" || user.role === "HEAD_ADMIN" || user.role === "ADMIN" ? "1" : "2"}-20 characters, letters, numbers and underscores.`}>
          <Input id="username" value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            maxLength={20} minLength={user.role === "OWNER" || user.role === "HEAD_ADMIN" || user.role === "ADMIN" ? 1 : 2} placeholder="username" />
        </FieldGroup>
        <FieldGroup label="Status" htmlFor="status">
          <StatusInput />
        </FieldGroup>
        <FieldGroup label="About Me" htmlFor="bio">
          <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)}
            maxLength={190} rows={3} placeholder="Tell people about yourself" />
        </FieldGroup>
        <Button type="submit" disabled={saving} className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Changes
        </Button>
      </form>
    </div>
  )
}

function StatusInput() {
  const { user, setUser } = useAuth()
  const [status, setStatus] = useState(user?.status ?? "")
  const [saving, setSaving] = useState(false)

  if (!user) return null

  const save = async () => {
    setSaving(true)
    try {
      const { user: updated } = await api.setStatus(status)
      setUser(updated)
      toast.success("Status updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Input value={status} onChange={(e) => setStatus(e.target.value)} maxLength={64}
        placeholder="What are you up to?" onBlur={save} disabled={saving} />
      <Button type="button" size="sm" variant="secondary" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}
      </Button>
    </div>
  )
}

/* ================================================================== */
/* 2. Profiles                                                        */
/* ================================================================== */

function ProfilesSection() {
  const { user, setUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [bio, setBio] = useState(user?.bio ?? "")

  if (!user) return null

  const saveBio = async () => {
    setSaving(true)
    try {
      const { user: updated } = await api.updateProfile({ bio })
      setUser(updated)
      toast.success("Bio saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <SectionTitle title="Profiles" desc="Customize your profile bio and status." />

      <div className="space-y-4">
        <FieldGroup label="About Me" hint="Shown on your profile card.">
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={190}
            rows={3} placeholder="Tell people about yourself" />
          <Button type="button" size="sm" variant="secondary" onClick={saveBio} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}Save Bio
          </Button>
        </FieldGroup>

        <Separator />
        <FieldGroup label="Status">
          <StatusInput />
        </FieldGroup>

      </div>
    </div>
  )
}

/* ================================================================== */
/* 3. Privacy & Safety                                                */
/* ================================================================== */

function PrivacySection() {
  const [blocks, setBlocks] = useState<SafeUser[]>([])
  const [loadingBlocks, setLoadingBlocks] = useState(false)

  const loadBlocks = useCallback(async () => {
    setLoadingBlocks(true)
    try {
      const { blocks } = (await api.listBlocks()) as { blocks: SafeUser[] }
      setBlocks(blocks || [])
    } catch {
      /* ignore — user may not have any */
    } finally {
      setLoadingBlocks(false)
    }
  }, [])

  useEffect(() => { loadBlocks() }, [loadBlocks])

  const unblock = async (u: SafeUser) => {
    try {
      await api.toggleBlock(u.id)
      setBlocks((b) => b.filter((x) => x.id !== u.id))
      toast.success(`Unblocked ${u.displayName}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed")
    }
  }

  return (
    <div>
      <SectionTitle title="Privacy & Safety" desc="Control who can reach you and manage blocked users." />

      <R7PrivacyControls />
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Ban className="h-4 w-4 text-[var(--synnical-accent)]" />
            <h2 className="text-sm font-semibold text-[var(--synnical-text)]">Blocked Users</h2>
          </div>
          <p className="text-xs text-[var(--synnical-muted)] mb-3">People you&apos;ve blocked can&apos;t message or interact with you.</p>
          {loadingBlocks ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-[var(--synnical-muted)]" /></div>
          ) : blocks.length === 0 ? (
            <div className="rounded-lg border border-[var(--synnical-border)] p-6 text-center text-sm text-[var(--synnical-muted)]">
              You haven&apos;t blocked anyone.
            </div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto custom-scroll">
              {blocks.map((u) => (
                <div key={u.id} className="flex items-center gap-2 py-2 border-b border-[var(--synnical-border)] last:border-0">
                  <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} size="sm" />
                  <div className="flex-1 min-w-0">
                    <DisplayName name={u.displayName} role={u.role} className="text-sm" />
                    <p className="text-xs text-[var(--synnical-muted)]">@{u.username}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => unblock(u)}>Unblock</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 4. Authorized Apps                                                 */
/* ================================================================== */

function AuthorizedAppsSection() {
  return (
    <div>
      <SectionTitle title="Authorized Apps" desc="Apps and services connected to your Synnical account." />
      <div className="rounded-lg border border-[var(--synnical-border)] p-6 text-center">
        <Puzzle className="h-8 w-8 mx-auto text-[var(--synnical-muted)] mb-2" />
        <p className="text-sm text-[var(--synnical-text)] font-medium">No authorized apps</p>
        <p className="text-xs text-[var(--synnical-muted)] mt-1">
          When you connect a third-party app to your account, it will appear here.
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 5. Devices                                                         */
/* ================================================================== */

function DevicesSection() {
  return (
    <div>
      <SectionTitle title="Devices" desc="Name, review and remotely sign out server-side Synnical sessions." />
      <R7DevicesControls />
    </div>
  )
}

/* ================================================================== */
/* 6. Connections                                                     */
/* ================================================================== */

function ConnectionsSection() {
  const { user } = useAuth()
  const [connections, setConnections] = useState<Connection[]>([])
  const [legacyConnections, setLegacyConnections] = useState<Connection[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [platformId, setPlatformId] = useState("")
  const [username, setUsername] = useState("")
  const [url, setUrl] = useState("")

  useEffect(() => {
    let active = true
    setLegacyConnections(loadLegacyConnections())
    loadConnections()
      .then((loaded) => { if (active) setConnections(loaded) })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : "Could not load connections") })
    return () => { active = false }
  }, [user?.id])

  const persist = async (next: Connection[]) => {
    const previous = connections
    setConnections(next)
    try {
      setConnections(await saveConnections(next))
    } catch (error) {
      setConnections(previous)
      toast.error(error instanceof Error ? error.message : "Could not save connections")
    }
  }

  const importLegacy = async () => {
    if (!legacyConnections.length) return
    const existing = new Set(connections.map((item) => `${item.platform.toLowerCase()}\0${item.username.toLowerCase()}`))
    const merged = normalizeConnections([
      ...connections,
      ...legacyConnections.filter((item) => !existing.has(`${item.platform.toLowerCase()}\0${item.username.toLowerCase()}`)),
    ])
    try {
      const saved = await saveConnections(merged)
      setConnections(saved)
      clearLegacyConnections()
      setLegacyConnections([])
      toast.success(`Imported old connection data into @${user?.username || "this account"}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import old connections")
    }
  }

  const discardLegacy = () => {
    clearLegacyConnections()
    setLegacyConnections([])
    toast.success("Old browser-only connection data discarded")
  }

  const resetForm = () => {
    setPlatformId(""); setUsername(""); setUrl(""); setShowForm(false); setEditId(null)
  }

  const handleSave = () => {
    if (!platformId || !username.trim()) return
    if (editId) {
      void persist(connections.map((c) => c.id === editId ? { ...c, platform: platformId, username: username.trim(), url: url.trim() || undefined } : c))
    } else {
      void persist([...connections, { id: crypto.randomUUID?.() || String(Date.now()), platform: platformId, username: username.trim(), url: url.trim() || undefined }])
    }
    resetForm()
  }

  const handleEdit = (c: Connection) => {
    setEditId(c.id); setPlatformId(c.platform); setUsername(c.username); setUrl(c.url || ""); setShowForm(true)
  }

  const handleRemove = (id: string) => {
    void persist(connections.filter((c) => c.id !== id))
  }

  return (
    <div>
      <SectionTitle title="Connections" desc="Link external profiles to your Synnical account." />

      <div className="space-y-3">
        {legacyConnections.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-100">Old connection data found on this device</p>
            <p className="mt-1 text-xs text-amber-100/70">These links came from Synnical's old browser-only storage. They are not shown on any profile until you choose which account owns them.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void importLegacy()}>Import to @{user?.username || "my account"}</Button>
              <Button size="sm" variant="outline" onClick={discardLegacy}>Discard old data</Button>
            </div>
          </div>
        )}
        {connections.length > 0 && (
          <div className="space-y-2">
            {connections.map((c) => {
              const platform = getPlatform(c.platform)
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-lg border border-[var(--synnical-border)] p-3">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-md overflow-hidden"
                    style={platform ? { backgroundColor: `#${platform.color}1a` } : undefined}
                  >
                    {platform ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={platform.iconUrl} alt={platform.name} className="h-5 w-5" />
                    ) : (
                      <Link2 className="h-4 w-4 text-[var(--synnical-muted)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--synnical-text)]">{platform?.name || c.platform}</p>
                    <p className="text-xs text-[var(--synnical-muted)] truncate">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--synnical-accent)]">{c.username}</a>
                      ) : c.username}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-green-400 mr-2">✓ Connected</span>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleEdit(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs hover:text-red-400" onClick={() => handleRemove(c.id)}>Disconnect</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {showForm ? (
          <div className="rounded-lg border border-[#2a2a2a] bg-[#070707] p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--synnical-text)]">{editId ? "Edit connection" : "Add a connection"}</h3>
            <div className="space-y-2">
              <Label htmlFor="conn-platform">Platform</Label>
              <Select value={platformId} onValueChange={setPlatformId}>
                <SelectTrigger id="conn-platform">
                  <SelectValue placeholder="Select a platform…" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="inline-flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.iconUrl} alt="" className="h-4 w-4" />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="conn-username">Username / Handle</Label>
              <Input id="conn-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your username on that platform" maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conn-url">Profile URL (optional)</Label>
              <Input id="conn-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" maxLength={200} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={!platformId || !username.trim()}>
                {editId ? "Save" : "Connect"}
              </Button>
              <Button size="sm" variant="outline" onClick={resetForm}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditId(null); setPlatformId(""); setUsername(""); setUrl(""); setShowForm(true) }}>
            <Plus className="h-3.5 w-3.5" /> Add connection
          </Button>
        )}

        {connections.length === 0 && !showForm && (
          <p className="text-xs text-[var(--synnical-muted)]">
            No connections yet. Add links to your Steam, Discord, GitHub, Twitch, or any other profile — they&apos;ll show up on your profile card.
          </p>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 7. Appearance                                                      */
/* ================================================================== */

function AppearanceSection() {
  const [osMode, setOsMode] = useLocalSetting<boolean>("layout.osMode", false)

  return (
    <div>
      <SectionTitle title="Appearance" desc="A fixed OLED interface with high-contrast controls." />

      <div className="settings-section-list">
        <SettingRow title="Interface" desc="True OLED black, white controls, static stars and moving meteors.">
          <span className="border border-[#303030] bg-black px-3 py-1.5 text-xs font-semibold text-white">OLED Black</span>
        </SettingRow>

        <SettingRow title="Synnical Desktop" desc="Use the windowed OS-style desktop with a Start menu, taskbar, snapping, workspaces and persistent app windows.">
          <Switch checked={osMode} onCheckedChange={setOsMode} />
        </SettingRow>

        <SettingRow title="Browser tab" desc="The tab title and favicon stay on Google Classroom.">
          <div className="flex items-center gap-2 text-xs text-[#bdbdbd]">
            <img src="/brand/google-classroom.png" alt="" className="h-5 w-5" />
            <span>Google Classroom</span>
          </div>
        </SettingRow>

      </div>
    </div>
  )
}

/* ================================================================== */
/* 8. Accessibility                                                   */
/* ================================================================== */

function AccessibilitySection() {
  const [reduceMotion, setReduceMotion] = useLocalSetting<boolean>("a11y.reduceMotion", false)
  const [highContrast, setHighContrast] = useLocalSetting<boolean>("a11y.highContrast", false)
  const [highLegibility, setHighLegibility] = useLocalSetting<boolean>("a11y.highLegibility", false)
  const [dyslexiaFriendly, setDyslexiaFriendly] = useLocalSetting<boolean>("a11y.dyslexiaFriendly", false)
  const [largePointer, setLargePointer] = useLocalSetting<boolean>("a11y.largePointer", false)
  const [simplifiedUi, setSimplifiedUi] = useLocalSetting<boolean>("a11y.simplifiedUi", false)
  const [interfaceDensity, setInterfaceDensity] = useLocalSetting<"comfortable" | "compact" | "minimal">("a11y.interfaceDensity", "comfortable")
  const [lineSpacing, setLineSpacing] = useLocalSetting<number>("a11y.lineSpacing", 150)
  const [messageSpacing, setMessageSpacing] = useLocalSetting<number>("a11y.messageSpacing", 4)
  const [focusThickness, setFocusThickness] = useLocalSetting<number>("a11y.focusThickness", 2)
  const [interfaceZoom, setInterfaceZoom] = useLocalSetting<number>("a11y.interfaceZoom", 100)

  return (
    <div>
      <SectionTitle title="Accessibility" desc="Reading, focus, motion, pointer and interface controls with real global consumers." />
      <SettingRow title="Reduced Animation" desc="Minimize ordinary interface motion while keeping explicit cosmetic preview areas animated.">
        <Switch checked={reduceMotion} onCheckedChange={setReduceMotion} />
      </SettingRow>
      <SettingRow title="High Contrast" desc="Increase borders and foreground separation throughout the interface.">
        <Switch checked={highContrast} onCheckedChange={setHighContrast} />
      </SettingRow>
      <SettingRow title="High-Legibility Reading" desc="Use clearer letter spacing, stronger text weight and less decorative text treatment.">
        <Switch checked={highLegibility} onCheckedChange={setHighLegibility} />
      </SettingRow>
      <SettingRow title="Dyslexia-Friendly Reading" desc="Increase letter, word and line spacing and reduce italic styling for longer reading without requiring a special font download.">
        <Switch checked={dyslexiaFriendly} onCheckedChange={setDyslexiaFriendly} />
      </SettingRow>
      <SettingRow title="Interface Density" desc="Change spacing across navigation and controls without changing browser zoom.">
        <Select value={interfaceDensity} onValueChange={(value) => setInterfaceDensity(value as typeof interfaceDensity)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="comfortable">Comfortable</SelectItem><SelectItem value="compact">Compact</SelectItem><SelectItem value="minimal">Minimal</SelectItem></SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="Interface Zoom" desc="Scale Synnical independently from the browser's own zoom level.">
        <NumberSelect label="Interface zoom" value={interfaceZoom} values={[80, 90, 100, 110, 125]} onChange={setInterfaceZoom} />
      </SettingRow>
      <SettingRow title="Line Spacing" desc="Adjust reading line height across text-heavy panels.">
        <NumberSelect label="Line spacing" value={lineSpacing} values={[120, 135, 150, 170, 190, 220]} onChange={setLineSpacing} />
      </SettingRow>
      <SettingRow title="Message Spacing" desc="Add extra vertical room between chat message groups.">
        <NumberSelect label="Message spacing" value={messageSpacing} values={[0, 2, 4, 6, 8, 12, 16]} onChange={setMessageSpacing} unit="px" />
      </SettingRow>
      <SettingRow title="Focus Outline Thickness" desc="Make keyboard focus easier to track across buttons, links and inputs.">
        <NumberSelect label="Focus outline thickness" value={focusThickness} values={[1, 2, 3, 4, 5, 6]} onChange={setFocusThickness} unit="px" />
      </SettingRow>
      <SettingRow title="Large Pointer" desc="Use a larger in-app pointer while Synnical is active.">
        <Switch checked={largePointer} onCheckedChange={setLargePointer} />
      </SettingRow>
      <SettingRow title="Simplified Interface" desc="Hide decorative background effects and non-essential visual flourishes while keeping every core control available.">
        <Switch checked={simplifiedUi} onCheckedChange={setSimplifiedUi} />
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 9. Voice & Video                                                   */
/* ================================================================== */

function VoiceSection() {
  const [inputVol, setInputVol] = useLocalSetting<number>("voice.inputVolume", 100)
  const [outputVol, setOutputVol] = useLocalSetting<number>("voice.outputVolume", 100)
  const [echoCancel, setEchoCancel] = useLocalSetting<boolean>("voice.echoCancellation", true)
  const [noiseSupp, setNoiseSupp] = useLocalSetting<boolean>("voice.noiseSuppression", true)
  const [inputDeviceId, setInputDeviceId] = useLocalSetting<string>("voice.inputDevice", "default")
  const [outputDeviceId, setOutputDeviceId] = useLocalSetting<string>("voice.outputDevice", "default")
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    let active = true
    const enumerate = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (!active) return
        setAudioDevices(devices.filter((d) => d.kind === "audioinput" || d.kind === "audiooutput"))
      } catch {
        /* permission denied — leave lists empty */
      }
    }
    enumerate()
    const onDeviceChange = () => { void enumerate() }
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange)
    return () => {
      active = false
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange)
    }
  }, [])

  const inputOptions = audioDevices.filter((d) => d.kind === "audioinput")
  const outputOptions = audioDevices.filter((d) => d.kind === "audiooutput")

  return (
    <div>
      <SectionTitle title="Voice & Audio" desc="Configure the microphone and audio devices Synnical actually uses." />

      <div className="space-y-6">
        <FieldGroup label="Input Device" hint="The microphone Synnical will use.">
          <Select value={inputDeviceId} onValueChange={setInputDeviceId}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System Default</SelectItem>
              {inputOptions.map((d, i) => (
                <SelectItem key={d.deviceId || i} value={d.deviceId || `in-${i}`} className="text-xs">
                  {d.label || `Microphone ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>

        <SettingRow title="Input Volume" desc="Microphone sensitivity / gain.">
          <NumberSelect label="Input volume" value={inputVol} values={[0, 20, 40, 60, 80, 100]} onChange={setInputVol} />
        </SettingRow>

        <FieldGroup label="Output Device" hint="Where audio will be played.">
          <Select value={outputDeviceId} onValueChange={setOutputDeviceId}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System Default</SelectItem>
              {outputOptions.map((d, i) => (
                <SelectItem key={d.deviceId || i} value={d.deviceId || `out-${i}`} className="text-xs">
                  {d.label || `Speaker ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldGroup>

        <SettingRow title="Output Volume" desc="Speaker / headphone volume.">
          <NumberSelect label="Output volume" value={outputVol} values={[0, 20, 40, 60, 80, 100]} onChange={setOutputVol} />
        </SettingRow>

        <Separator />

        <SettingRow title="Echo Cancellation" desc="Remove echo from your microphone input.">
          <Switch checked={echoCancel} onCheckedChange={setEchoCancel} />
        </SettingRow>
        <SettingRow title="Noise Suppression" desc="Filter out background noise.">
          <Switch checked={noiseSupp} onCheckedChange={setNoiseSupp} />
        </SettingRow>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 10. Notifications                                                  */
/* ================================================================== */

function NotificationsSection() {
  const [desktop, setDesktop] = useLocalSetting<boolean>("notifications.desktop", false)
  const [sound, setSound] = useLocalSetting<boolean>("chat.notificationSound", true)

  const toggleDesktop = async (v: boolean) => {
    if (v && typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        try {
          const perm = await Notification.requestPermission()
          if (perm !== "granted") {
            toast.error("Notification permission denied")
            return
          }
        } catch {
          toast.error("Could not request notification permission")
          return
        }
      } else if (Notification.permission !== "granted") {
        toast.error("Notifications are blocked in your browser settings")
        return
      }
    }
    setDesktop(v)
  }

  return (
    <div>
      <SectionTitle title="Notifications" desc="Controls used by Synnical's live chat notification path." />
      <SettingRow title="Enable Desktop Notifications" desc="Notify you about new chat messages when the chat is not the active visible panel.">
        <Switch checked={desktop} onCheckedChange={toggleDesktop} />
      </SettingRow>
      <SettingRow title="Notification Sound" desc="Play the chat notification sound for incoming messages.">
        <Switch checked={sound} onCheckedChange={setSound} />
      </SettingRow>
    </div>
  )
}

/* ================================================================== */
/* 11. Keybinds                                                      */
/* ================================================================== */

function KeybindsSection() {
  const keybinds = [
    { action: "Toggle Settings", keys: ["Ctrl", ","] },
    { action: "Open Search", keys: ["Ctrl", "K"] },
    { action: "Send Message", keys: ["Enter"] },
    { action: "New Line in Message", keys: ["Shift", "Enter"] },
    { action: "Toggle Chat Panel", keys: ["Alt", "1"] },
    { action: "Toggle Friends Panel", keys: ["Alt", "2"] },
    { action: "Toggle Browser Panel", keys: ["Alt", "3"] },
    { action: "Toggle Gaming Panel", keys: ["Alt", "4"] },
    { action: "Mute / Unmute (voice)", keys: ["Ctrl", "Shift", "M"] },
    { action: "Log Out", keys: ["Ctrl", "Shift", "L"] },
  ]

  return (
    <div>
      <SectionTitle title="Keybinds" desc="Keyboard shortcuts available throughout Synnical." />
      <p className="text-xs text-[var(--synnical-muted)] mb-4">Default keybinds are shown below. They are not currently customizable.</p>
      <div className="space-y-1">
        {keybinds.map((kb) => (
          <div key={kb.action} className="flex items-center justify-between py-2.5 border-b border-[var(--synnical-border)] last:border-0">
            <span className="text-sm text-[var(--synnical-text)]">{kb.action}</span>
            <div className="flex items-center gap-1">
              {kb.keys.map((k, i) => (
                <kbd key={i} className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] px-1.5 text-xs font-medium text-[var(--synnical-text)]">
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 12. Language                                                       */
/* ================================================================== */

function LanguageSection() {
  const [language, setLanguage] = useLocalSetting<string>("language.current", "en")
  const languages = [
    { code: "en", name: "English" },
    { code: "es", name: "Español (Spanish)" },
    { code: "fr", name: "Français (French)" },
    { code: "de", name: "Deutsch (German)" },
    { code: "ja", name: "日本語 (Japanese)" },
    { code: "zh", name: "中文 (Chinese)" },
    { code: "ko", name: "한국어 (Korean)" },
    { code: "pt", name: "Português (Portuguese)" },
    { code: "it", name: "Italiano (Italian)" },
    { code: "ru", name: "Русский (Russian)" },
    { code: "ar", name: "العربية (Arabic)" },
    { code: "hi", name: "हिन्दी (Hindi)" },
  ]
  return (
    <div>
      <SectionTitle title="Language" desc="Choose your preferred display language." />
      <FieldGroup label="App Language" hint="Affects menus and default text. Full translations are rolling out gradually.">
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {languages.map((l) => (
              <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldGroup>
    </div>
  )
}

/* ================================================================== */
/* 13. Streamer Mode                                                  */
/* ================================================================== */

function StreamerSection() {
  const [enabled, setEnabled] = useLocalSetting<boolean>("streamer.enabled", false)
  const [hidePersonal, setHidePersonal] = useLocalSetting<boolean>("streamer.hidePersonal", true)

  return (
    <div>
      <SectionTitle title="Streamer Mode" desc="Protect your personal information while streaming or sharing your screen." />
      <SettingRow title="Enable Streamer Mode" desc="Hides sensitive info while you're sharing your screen.">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </SettingRow>
      <SettingRow title="Hide Personal Information" desc="Mask emails, tokens, and account details on screen.">
        <Switch checked={hidePersonal} onCheckedChange={setHidePersonal} />
      </SettingRow>
      <div className="mt-4 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Radio className="h-4 w-4 text-[var(--synnical-accent)]" />
          <p className="text-sm font-medium text-[var(--synnical-text)]">Status</p>
        </div>
        <p className="text-xs text-[var(--synnical-muted)]">
          {enabled
            ? "Streamer mode is ON. Personal info will be hidden while sharing."
            : "Streamer mode is OFF. Your information is shown normally."}
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 14. Advanced                                                       */
/* ================================================================== */

function AdvancedSection() {
  const [devMode, setDevMode] = useLocalSetting<boolean>("advanced.developerMode", false)
  const [dataStats, setDataStats] = useState<{ sent: number; received: number } | null>(null)
  const [runningDiag, setRunningDiag] = useState(false)
  const [diag, setDiag] = useState<{ latency: number; status: string } | null>(null)

  const loadDataStats = () => {
    try {
      const perf = (performance as Performance & { getEntriesByType?: (t: string) => PerformanceEntry[] })
      const nav = perf.getEntriesByType?.("navigation")
      if (nav && nav.length > 0) {
        const n = nav[0] as PerformanceEntry & { transferSize?: number; encodedBodySize?: number }
        setDataStats({ sent: Math.round((n.transferSize || 0) / 1024), received: Math.round((n.encodedBodySize || 0) / 1024) })
      } else {
        setDataStats({ sent: 0, received: 0 })
      }
    } catch {
      setDataStats({ sent: 0, received: 0 })
    }
  }

  useEffect(() => { loadDataStats() }, [])

  const runDiagnostics = async () => {
    setRunningDiag(true)
    setDiag(null)
    try {
      const start = performance.now()
      const res = await fetch("/api/auth/me", { credentials: "include" })
      const latency = Math.round(performance.now() - start)
      setDiag({ latency, status: res.ok ? "OK" : `Error ${res.status}` })
    } catch {
      setDiag({ latency: -1, status: "Network error" })
    } finally {
      setRunningDiag(false)
    }
  }

  return (
    <div>
      <SectionTitle title="Advanced" desc="Developer tools and diagnostics." />
      <SettingRow title="Developer Mode" desc="Enable advanced debugging features and context info.">
        <Switch checked={devMode} onCheckedChange={setDevMode} />
      </SettingRow>

      <Separator />

      <div className="py-4">
        <h2 className="text-sm font-semibold text-[var(--synnical-text)] mb-1">Data Usage</h2>
        <p className="text-xs text-[var(--synnical-muted)] mb-3">Approximate data transferred this session.</p>
        {dataStats ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--synnical-border)] p-3">
              <p className="text-xs text-[var(--synnical-muted)]">Sent</p>
              <p className="text-lg font-semibold text-[var(--synnical-text)]">{dataStats.sent} KB</p>
            </div>
            <div className="rounded-lg border border-[var(--synnical-border)] p-3">
              <p className="text-xs text-[var(--synnical-muted)]">Received</p>
              <p className="text-lg font-semibold text-[var(--synnical-text)]">{dataStats.received} KB</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--synnical-muted)]">Loading…</p>
        )}
        <Button size="sm" variant="secondary" className="mt-3" onClick={loadDataStats}>Refresh</Button>
      </div>

      <Separator />

      <div className="py-4">
        <h2 className="text-sm font-semibold text-[var(--synnical-text)] mb-1">Network Diagnostics</h2>
        <p className="text-xs text-[var(--synnical-muted)] mb-3">Check your connection to the Synnical servers.</p>
        <Button size="sm" variant="secondary" onClick={runDiagnostics} disabled={runningDiag}>
          {runningDiag && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {runningDiag ? "Running…" : "Run Diagnostics"}
        </Button>
        {diag && (
          <div className="mt-3 rounded-lg border border-[var(--synnical-border)] p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--synnical-muted)]">Server response</span>
              <span className={diag.status === "OK" ? "text-emerald-400" : "text-red-400"}>{diag.status}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[var(--synnical-muted)]">Latency</span>
              <span className="text-[var(--synnical-text)]">{diag.latency >= 0 ? `${diag.latency} ms` : "unavailable"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Legal                                                              */
/* ================================================================== */

function LegalSection() {
  return (
    <div>
      <SectionTitle title="Legal" desc="Privacy information, platform rules, and the exact build these terms are shown in." />

      <section className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--synnical-muted)]">Build information</p>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--synnical-border)] bg-[#070707] p-3"><p className="text-xs text-[var(--synnical-muted)]">Version</p><p className="mt-1 font-medium">{SYNNICAL_VERSION}</p></div>
          <div className="rounded-lg border border-[var(--synnical-border)] bg-[#070707] p-3"><p className="text-xs text-[var(--synnical-muted)]">Build</p><p className="mt-1 break-all font-medium">{SYNNICAL_BUILD}</p></div>
          <div className="rounded-lg border border-[var(--synnical-border)] bg-[#070707] p-3"><p className="text-xs text-[var(--synnical-muted)]">Build date</p><p className="mt-1 font-medium">{SYNNICAL_BUILD_DATE}</p></div>
        </div>
      </section>

      <section className="mt-5 space-y-3 rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-5">
        <h2 className="text-lg font-semibold">Privacy Policy</h2>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">Synnical stores the information needed to operate accounts and community features, including account identifiers, profile information, messages, friendships, moderation records, shop balances and purchases, and settings that are stored on the server. Some interface preferences stay in your browser.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">For abuse prevention, Synnical may store one-way hashes derived from connection and device signals. These hashes are used to reduce ban evasion and are not intended to reconstruct the original signal. Reports preserve a snapshot of the reported message and nearby conversation so later message deletion does not erase moderation evidence.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">Synnical may send limited content to configured service providers when a feature requires it, such as moderation, AI, GIF search, or other integrations. Those providers process data under their own terms and privacy practices. Do not put secrets or information you do not want processed into features that use third-party services.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">Staff can access moderation information when needed to investigate safety, abuse, account, and service issues. Data may also be retained when reasonably necessary for security, dispute handling, or legal obligations.</p>
        <p className="text-xs leading-5 text-[var(--synnical-muted)]">This in-app policy describes the product behaviour in this build. It is not a substitute for jurisdiction-specific legal advice.</p>
      </section>

      <section className="mt-5 space-y-3 rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-5">
        <h2 className="text-lg font-semibold">Terms of Service</h2>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">By using Synnical, you agree not to use the service to threaten, exploit, groom, harass, scam, impersonate, spam, evade bans, distribute unlawful material, compromise other accounts, or interfere with the service. Child-safety concerns receive priority moderation review.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">You are responsible for activity performed through your account and for content you submit. You must not attempt to manipulate credits, purchases, staff tools, authentication, or moderation systems.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">Credits and avatar decorations are in-service features. They have no cash value unless Synnical explicitly states otherwise. Purchases and gifts are governed by the prices and rules shown in the product at the time of the transaction.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">Staff may remove content, restrict features, mute, suspend, or ban accounts when reasonably necessary to enforce these rules or protect users and the service. Attempts to create replacement accounts after a ban may also be blocked.</p>
        <p className="text-sm leading-6 text-[var(--synnical-muted)]">The service may change, experience downtime, or discontinue features. Keep copies of anything you cannot afford to lose. Continued use after material terms changes means you accept the updated terms presented in the product.</p>
      </section>
    </div>
  )
}

/* ================================================================== */
/* Moderation: Owner Verification                                     */
/* ================================================================== */

function OwnerVerificationSection() {
  const { user, setUser } = useAuth()
  const [password, setPassword] = useState("")
  const [verifying, setVerifying] = useState(false)

  if (!user) return null

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setVerifying(true)
    try {
      const { user: updated } = await api.verifyOwner(password)
      setUser(updated)
      setPassword("")
      toast.success("Ownership verified — you are now the Owner")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed")
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div>
      <SectionTitle title="Verify owner password" />
      {user.role === "OWNER" ? (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-sm text-amber-400">
          <Crown className="h-4 w-4" /> You are verified as Owner.
        </div>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <FieldGroup label="Owner password" htmlFor="ownerPass">
            <Input id="ownerPass" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter owner password" autoComplete="off" />
          </FieldGroup>
          <Button type="submit" disabled={!password || verifying} className="bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black">
            {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Verify ownership
          </Button>
        </form>
      )}
    </div>
  )
}

/* ================================================================== */
/* Moderation: User Management (with tags)                            */
/* ================================================================== */

function UserManagementSection() {
  const { user, setUser } = useAuth()
  const [users, setUsers] = useState<SafeUser[]>([])
  const [loading, setLoading] = useState(false)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({})
  const [workingTag, setWorkingTag] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("ALL")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(query.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const loadUsers = useCallback(async () => {
    if (!user || (user.role !== "OWNER" && user.role !== "HEAD_ADMIN")) return
    setLoading(true)
    try {
      const result = await api.listUsers({ q: search, role: roleFilter, status: statusFilter, page, pageSize: 25, excludeSelf: true })
      const { users } = result
      setUsers(users)
      setTotal(result.total)
      setHasMore(result.hasMore)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    } finally {
      setLoading(false)
    }
  }, [user, search, roleFilter, statusFilter, page])

  useEffect(() => { loadUsers() }, [loadUsers])

  if (!user) return null

  const assignRole = async (u: SafeUser, role: Role) => {
    try {
      await api.assignRole(u.id, role)
      toast.success(`${u.displayName} is now ${role}`)
      loadUsers()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    }
  }

  const toggleMute = async (u: SafeUser) => {
    try {
      if (u.muted) { await api.unmuteUser(u.id); toast.success(`${u.displayName} unmuted`) }
      else { await api.muteUser(u.id); toast.success(`${u.displayName} muted`) }
      loadUsers()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed")
    }
  }

  const addTag = async (u: SafeUser, tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed) return
    if (u.tags?.includes(trimmed)) {
      toast.error("User already has that tag")
      return
    }
    setWorkingTag(u.id)
    try {
      const { user: updated } = await api.assignTag(u.id, trimmed)
      // optimistic update + merge into the list
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      if (user.id === updated.id) setUser(updated)
      setTagInputs((prev) => ({ ...prev, [u.id]: "" }))
      toast.success(`Tag "${trimmed}" added to ${u.displayName}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add tag")
    } finally {
      setWorkingTag(null)
    }
  }

  const removeTag = async (u: SafeUser, tag: string) => {
    setWorkingTag(u.id + ":" + tag)
    try {
      const { user: updated } = await api.removeTag(u.id, tag)
      setUsers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      if (user.id === updated.id) setUser(updated)
      toast.success(`Tag "${tag}" removed`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove tag")
    } finally {
      setWorkingTag(null)
    }
  }

  return (
    <div>
      <SectionTitle
        title="User Management"
        desc="Search and manage accounts without loading the entire member list into your browser."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_140px_140px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--synnical-muted)]" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search username, display name, ID or role…" className="pl-8" />
        </div>
        <Select value={roleFilter} onValueChange={(value) => { setRoleFilter(value); setPage(1) }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            <SelectItem value="MEMBER">Member</SelectItem><SelectItem value="MOD">Mod</SelectItem><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="HEAD_ADMIN">Head Admin</SelectItem><SelectItem value="OWNER">Owner</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1) }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All accounts</SelectItem><SelectItem value="ACTIVE">Not muted</SelectItem><SelectItem value="MUTED">Muted</SelectItem><SelectItem value="STAFF">Staff only</SelectItem><SelectItem value="MEMBERS">Members only</SelectItem></SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[var(--synnical-muted)]" /></div>
      ) : users.filter((entry) => entry.id !== user.id).length === 0 ? (
        <div className="rounded-lg border border-[var(--synnical-border)] p-6 text-center text-sm text-[var(--synnical-muted)]">
          No matching users to manage.
        </div>
      ) : (
        <div className="space-y-2">
          {users.filter((u) => u.id !== user.id).map((u) => {
            const tagInput = tagInputs[u.id] ?? ""
            return (
              <div key={u.id} className="rounded-lg border border-[var(--synnical-border)] p-3">
                <div className="flex items-center gap-2">
                  <AvatarWithDeco src={u.pfpUrl} name={u.displayName} role={u.role} avatarDeco={u.avatarDeco} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <DisplayName name={u.displayName} role={u.role} className="text-sm" />
                      <RoleBadge role={u.role} tags={u.tags} />
                    </div>
                    <p className="text-xs text-[var(--synnical-muted)]">@{u.username}{u.muted && " · muted"}</p>
                  </div>
                  <Select value={u.role} onValueChange={(v) => assignRole(u, v as Role)}>
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ROLES.filter((r) => r !== "OWNER" && (user.role === "OWNER" || r !== "HEAD_ADMIN")).map((r) => (
                        <SelectItem key={r} value={r} className="text-xs">
                          {r === "HEAD_ADMIN" ? "Head Admin" : r.charAt(0) + r.slice(1).toLowerCase()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-7 w-7"
                    onClick={() => toggleMute(u)} aria-label={u.muted ? "Unmute" : "Mute"}>
                    {u.muted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5 text-[#ef4444]" />}
                  </Button>
                </div>

                {/* Tags */}
                <div className="mt-2.5 pl-10">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag className="h-3 w-3 text-[var(--synnical-muted)] shrink-0" />
                    {(u.tags || []).length === 0 && (
                      <span className="text-xs text-[var(--synnical-muted)]">No tags</span>
                    )}
                    {(u.tags || []).map((t) => {
                      const removing = workingTag === u.id + ":" + t
                      return (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{
                            background: tagColor(t) + "22",
                            color: tagColor(t),
                            border: `1px solid ${tagColor(t)}55`,
                          }}
                        >
                          {t}
                          <button
                            onClick={() => removeTag(u, t)}
                            disabled={!!removing}
                            className="inline-flex items-center justify-center hover:opacity-100 opacity-70 disabled:opacity-30"
                            aria-label={`Remove tag ${t}`}
                          >
                            {removing
                              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              : <X className="h-2.5 w-2.5" />}
                          </button>
                        </span>
                      )
                    })}
                  </div>
                  {(user.role === "OWNER" || user.role === "HEAD_ADMIN") ? <div className="mt-2 flex flex-wrap gap-1.5">
                    {[NOTABLE_PERSON_TAG, BIG_SITE_OWNER_TAG, DEV_TAG].map((specialTag) => {
                      const active = (u.tags || []).includes(specialTag)
                      const busy = workingTag === u.id || workingTag === `${u.id}:${specialTag}`
                      return <Button key={specialTag} size="sm" variant={active ? "default" : "outline"} className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => void (active ? removeTag(u, specialTag) : addTag(u, specialTag))}>{active ? `Remove ${specialTag}` : `Add ${specialTag}`}</Button>
                    })}
                  </div> : null}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Input
                      value={tagInput}
                      onChange={(e) => setTagInputs((p) => ({ ...p, [u.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          addTag(u, tagInput)
                        }
                      }}
                      placeholder="Add a tag…"
                      className="h-7 flex-1 text-xs"
                      maxLength={24}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={!tagInput.trim() || workingTag === u.id}
                      onClick={() => addTag(u, tagInput)}
                      aria-label="Add tag"
                    >
                      {workingTag === u.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Plus className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
          <div className="flex items-center justify-between pt-2 text-xs text-[var(--synnical-muted)]">
            <span>{total.toLocaleString()} matching account{total === 1 ? "" : "s"} · page {page}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />Previous</Button>
              <Button size="sm" variant="outline" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/* 15a. Security                                                       */
/* ================================================================== */

function SecuritySection() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div>
      <SectionTitle title="Security" desc="Control signed-in devices, recovery access, emergency lockdown and your private security history." />
      <div className="mb-4 rounded-lg border border-[var(--synnical-border)] px-3">
        <SettingRow title="Account Role" desc={`Your current role: ${user.role}`}>
          <Shield className="h-4 w-4 text-[var(--synnical-muted)]" />
        </SettingRow>
      </div>
      <R7SecurityControls />
    </div>
  )
}

/* ================================================================== */
/* 15c. Billing                                                        */
/* ================================================================== */

function BillingSection() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div>
      <SectionTitle title="Billing" desc="Your subscription and plan details." />
      <div className="space-y-4">
        <div className="rounded-xl border border-[#2a2a2a] bg-[#070707] p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-[var(--synnical-text)]">Free Plan</p>
              <p className="text-xs text-[var(--synnical-muted)] mt-0.5">Access to chat and the proxy browser.</p>
            </div>
            <span className="text-xs text-black bg-white border border-white rounded px-2 py-1">Current</span>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--synnical-border)] p-4">
          <p className="text-xs text-[var(--synnical-muted)]">
            Paid plans, payment methods, and billing history are not available
            in this build. All features are currently free.
          </p>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 15d. Bookmarks                                                     */
/* ================================================================== */

function BookmarksSection() {
  const { bookmarks, removeBookmark } = useBrowser()
  const [search, setSearch] = useState("")

  const filtered = bookmarks.filter(b =>
    b.title.toLowerCase().includes(search.toLowerCase()) ||
    b.url.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <SectionTitle title="Bookmarks" desc="Manage your saved browser bookmarks." />
      <div className="space-y-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bookmarks…" />
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-xs text-[var(--synnical-muted)]">
            {bookmarks.length === 0 ? "No bookmarks yet. Save pages from the browser to see them here." : "No bookmarks match your search."}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-lg border border-[var(--synnical-border)] p-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--synnical-surface-2)] shrink-0 overflow-hidden">
                  <Globe className="h-4 w-4 text-[var(--synnical-accent)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--synnical-text)] truncate">{b.title}</p>
                  <p className="text-xs text-[var(--synnical-muted)] truncate">{b.url}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2 hover:text-red-400" onClick={() => removeBookmark(b.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 15e. Activity Log                                                  */
/* ================================================================== */

function ActivityLogSection() {
  const { history, clearHistory } = useBrowser()
  const [search, setSearch] = useState("")

  const filtered = history.filter(h =>
    h.title.toLowerCase().includes(search.toLowerCase()) ||
    h.url.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 100)

  return (
    <div>
      <SectionTitle title="Activity Log" desc="Your recent browsing history." />
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search history…" className="flex-1" />
          <Button size="sm" variant="outline" className="hover:text-red-400" onClick={() => { clearHistory(); toast.success("History cleared") }}>
            Clear All
          </Button>
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-xs text-[var(--synnical-muted)]">
            {history.length === 0 ? "No browsing history yet." : "No history matches your search."}
          </div>
        ) : (
          <ul className="space-y-1">
            {filtered.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--synnical-surface-2)]">
                <span className="text-[10px] text-[var(--synnical-muted)] shrink-0 w-20">
                  {new Date(h.visitedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--synnical-text)] truncate">{h.title}</p>
                  <p className="text-xs text-[var(--synnical-muted)] truncate">{h.url}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 15f. Data & Storage                                                 */
/* ================================================================== */

function DataStorageSection() {
  const [cacheSize, setCacheSize] = useState<string>("Calculating…")

  useEffect(() => {
    try {
      let total = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) total += (localStorage.getItem(key) || "").length
      }
      const kb = total / 1024
      setCacheSize(kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`)
    } catch { setCacheSize("Unknown") }
  }, [])

  const clearCache = () => {
    try {
      // Keep auth and session data, clear everything else
      const keep = ["synnical:auth", "synnical:session"]
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && !keep.includes(key)) keys.push(key)
      }
      keys.forEach(k => localStorage.removeItem(k))
      toast.success("Local cache cleared")
      setCacheSize("0 KB")
    } catch { toast.error("Failed to clear cache") }
  }

  return (
    <div>
      <SectionTitle title="Data & Storage" desc="Manage what Synnical stores on your device." />
      <div className="space-y-1">
        <SettingRow title="Local Storage Used" desc={cacheSize}>
          <Button size="sm" variant="outline" onClick={clearCache}>Clear Cache</Button>
        </SettingRow>
      </div>
    </div>
  )
}

/* ================================================================== */
/* 16. Logout                                                         */
/* ================================================================== */

function LogoutSection() {
  const { user } = useAuth()
  const { logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)

  const onLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
    } catch {
      toast.error("Logout failed")
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div>
      <SectionTitle title="Log Out" desc="Sign out of your Synnical account on this device." />
      <div className="rounded-xl border border-[var(--synnical-border)] p-4">
        {user && (
          <div className="flex items-center gap-3 mb-4">
            <AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={user.avatarDeco} size="sm" />
            <div>
              <DisplayName name={user.displayName} role={user.role} className="text-sm font-medium" />
              <p className="text-xs text-[var(--synnical-muted)]">@{user.username}</p>
            </div>
          </div>
        )}
        <Button variant="outline" onClick={onLogout} disabled={loggingOut}
          className="gap-2 text-[#ef4444] hover:text-[#ef4444]">
          {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Log out
        </Button>
        <p className="text-xs text-[var(--synnical-muted)] mt-2">
          You stay logged in across visits until you log out manually.
        </p>
      </div>
    </div>
  )
}
