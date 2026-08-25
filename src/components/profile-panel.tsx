"use client"

import { useRef, useState, useEffect } from "react"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ImageCropperV2 } from "@/components/image-cropper-v2"
import { AccountStats } from "@/components/account-stats"
import { Camera, Loader2, Check, ShieldCheck, Sparkles, Palette, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { loadConnections, getPlatform, type Connection } from "@/lib/connections"
import { DisplayName, RoleBadge, AvatarWithDeco, TagsDisplay } from "@/components/role-ui"
import { readSetting } from "@/lib/settings-runtime"
import { AVATAR_DECORATIONS } from "@/lib/avatar-decoration-catalog"
import { PROFILE_EFFECTS } from "@/lib/profile-effect-catalog"
import { ProfileCosmeticsDialog, type CosmeticPickerTab } from "@/components/profile-cosmetics-dialog"
import type { ProfileThemeStyle } from "@/lib/profile-theme"
import { ProfileAdvancedEditor } from "@/components/profile-advanced-editor"
import { IdentityStudio } from "@/components/identity-studio"

export function ProfilePanel() {
  const { user, setUser } = useAuth()
  const [displayName, setDisplayName] = useState(user?.displayName || "")
  const [bio, setBio] = useState(user?.bio || "")
  const [status, setStatus] = useState(user?.status || "")
  const [username, setUsername] = useState(user?.username || "")
  const [saving, setSaving] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [uploading, setUploading] = useState<"pfp" | "banner" | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const [ownedDecos, setOwnedDecos] = useState<Set<string>>(new Set())
  const [ownedEffects, setOwnedEffects] = useState<Set<string>>(new Set())
  const [staffDecorationAccess, setStaffDecorationAccess] = useState(false)
  const [staffProfileEffectAccess, setStaffProfileEffectAccess] = useState(false)
  const [cosmeticsOpen, setCosmeticsOpen] = useState(false)
  const [cosmeticsTab, setCosmeticsTab] = useState<CosmeticPickerTab>("decoration")
  const [themePrimary, setThemePrimary] = useState(user?.profileThemePrimary || "#111111")
  const [themeAccent, setThemeAccent] = useState(user?.profileThemeAccent || "#2b2b2b")
  const [themeStyle, setThemeStyle] = useState<ProfileThemeStyle>(user?.profileThemeStyle || "solid")
  const [themeBusy, setThemeBusy] = useState(false)

  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropMode, setCropMode] = useState<"pfp" | "banner">("pfp")
  const pfpInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)

  const [connections, setConnections] = useState<Connection[]>([])

  useEffect(() => {
    let active = true
    loadConnections().then((loaded) => { if (active) setConnections(loaded) }).catch(() => { if (active) setConnections([]) })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    let active = true
    api.getShop().then((shop) => {
      if (!active) return
      setOwnedDecos(new Set(shop.inventory.filter((item) => item.itemType === "avatar_deco").map((item) => item.itemId)))
      setOwnedEffects(new Set(shop.inventory.filter((item) => item.itemType === "profile_effect").map((item) => item.itemId)))
      setStaffDecorationAccess(shop.staffDecorationAccess)
      setStaffProfileEffectAccess(shop.staffProfileEffectAccess)
    }).catch(() => {
      if (active) toast.error("Could not load avatar decoration ownership")
    })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    setThemePrimary(user?.profileThemePrimary || "#111111")
    setThemeAccent(user?.profileThemeAccent || "#2b2b2b")
    setThemeStyle(user?.profileThemeStyle || "solid")
  }, [user?.profileThemePrimary, user?.profileThemeAccent, user?.profileThemeStyle])

  if (!user) return null

  // Profile privacy/settings (read from localStorage)
  const showConnections = readSetting("profile.showConnections", true)
  const profileBg = readSetting("profile.background", "")

  const canUseShortUsername = user.role === "OWNER" || user.role === "HEAD_ADMIN" || user.role === "ADMIN"
  const dirty = displayName !== user.displayName || bio !== user.bio || username !== user.username

  const saveProfile = async () => {
    setSaving(true)
    try {
      const { user: updated } = await api.updateProfile({ displayName, bio, username })
      setUser(updated); toast.success("Profile saved")
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
    finally { setSaving(false) }
  }

  const saveStatus = async () => {
    setSavingStatus(true)
    try {
      const { user: updated } = await api.setStatus(status)
      setUser(updated); toast.success("Status updated")
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed") }
    finally { setSavingStatus(false) }
  }

  const openCosmetics = (tab: CosmeticPickerTab) => {
    setCosmeticsTab(tab)
    setCosmeticsOpen(true)
  }

  const saveTheme = async () => {
    setThemeBusy(true)
    try {
      const { user: updated } = await api.setProfileTheme({ primary: themePrimary, accent: themeAccent, style: themeStyle })
      setUser(updated)
      toast.success("Profile theme saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save profile theme")
    } finally {
      setThemeBusy(false)
    }
  }

  /**
   * Animated formats must NEVER go through the cropper.
   *
   * The cropper draws a single frame to a <canvas> and calls
   * `canvas.toBlob(..., "image/png")`. Canvas has no concept of frames, so the
   * result is always a static PNG — which is exactly why uploaded GIFs stopped
   * moving. Animated files are uploaded as-is instead.
   */
  const pickImage = (e: React.ChangeEvent<HTMLInputElement>, mode: "pfp" | "banner") => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !file.type.startsWith("image/")) {
      toast.error("Please choose an image")
      return
    }

    const animated = file.type === "image/gif" || file.type === "image/webp" || file.type === "image/apng"
    if (animated) {
      // GIFs skip the cropper — canvas crop destroys animation frames.
      // Upload as-is, the CSS object-cover handles display.
      void uploadDirect(mode, file)
      toast.info("GIF uploaded as-is — animation preserved (crop not available for animated images)")
      return
    }

    setCropSrc(URL.createObjectURL(file))
    setCropMode(mode)
    setCropOpen(true)
  }

  const onPickPfp = (e: React.ChangeEvent<HTMLInputElement>) => pickImage(e, "pfp")
  const onPickBanner = (e: React.ChangeEvent<HTMLInputElement>) => pickImage(e, "banner")

  const uploadDirect = async (type: "pfp" | "banner", file: Blob) => {
    setUploading(type)
    try {
      const result = await api.uploadImage(type, file)
      setUser(result.user)
      toast.success(result.pending ? `${type === "pfp" ? "Profile picture" : "Banner"} sent for staff approval` : `${type === "pfp" ? "Profile picture" : "Banner"} updated`)
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed") }
    finally { setUploading(null) }
  }

  const onCropConfirm = async (blob: Blob) => {
    setCropOpen(false)
    await uploadDirect(cropMode, blob)
    if (cropSrc) URL.revokeObjectURL(cropSrc); setCropSrc(null)
  }

  const onCropCancel = () => {
    setCropOpen(false)
    if (cropSrc) URL.revokeObjectURL(cropSrc); setCropSrc(null)
  }

  return (
    <div className="h-full overflow-y-auto custom-scroll relative">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 relative">
        {/* Banner */}
        <div className="relative rounded-xl overflow-hidden border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)]">
          <div
            className="h-40 sm:h-48 w-full bg-black"
            style={profileBg ? { background: profileBg } : undefined}
          >
            {user.bannerUrl && <img src={user.bannerUrl} alt="Banner" className="w-full h-full object-cover" />}
          </div>
          <button
            onClick={() => bannerInput.current?.click()}
            disabled={uploading === "banner"}
            className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-black border border-[var(--synnical-border)] hover:bg-[var(--synnical-bg)] disabled:opacity-50 cursor-pointer"
            style={{ pointerEvents: "auto" }}
          >
            {uploading === "banner" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            {user.bannerUrl ? "Change banner" : "Upload banner"}
          </button>
          <input ref={bannerInput} type="file" accept="image/*" className="hidden" onChange={onPickBanner} />
        </div>

        {/* PFP overlaps banner; name sits below, not behind it */}
        <div className="px-2 relative" style={{ zIndex: 10 }}>
          <div className="absolute top-1 right-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--synnical-border)] bg-black/30 px-2.5 py-0.5 text-[11px] text-[var(--synnical-muted)]">Privacy managed in Settings</span>
          </div>
          <div className="flex items-end gap-4 -mt-10">
            <div className="relative shrink-0">
              <AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={user.avatarDeco} isGif={user.pfpIsGif} size="xl" avatarClassName="border-4 border-background" />
              <button onClick={() => pfpInput.current?.click()} disabled={uploading === "pfp"} className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-[var(--synnical-bg)] border border-[var(--synnical-border)] flex items-center justify-center hover:bg-[var(--synnical-surface-2)] disabled:opacity-50" aria-label="Change profile picture">
                {uploading === "pfp" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input ref={pfpInput} type="file" accept="image/*" className="hidden" onChange={onPickPfp} />
            </div>
          </div>
          {/* Name block is in its own row, clearly below the banner */}
          <div className="pt-2 pb-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <DisplayName name={user.displayName} role={user.role} className="text-lg font-semibold" />
              <RoleBadge role={user.role} tags={user.tags} />
            </div>
            {user.tags && user.tags.length > 0 && (
              <TagsDisplay tags={user.tags} className="mt-1.5" />
            )}
            <p className="text-sm text-[var(--synnical-muted)]">@{user.username}</p>
            {user.status && <p className="text-xs text-[var(--synnical-muted)] mt-0.5 italic">"{user.status}"</p>}
          </div>
        </div>

        {/* Compact profile cosmetics controls. Full previews live in a separate dialog. */}
        <section className="mt-6 rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-white" /><h3 className="text-sm font-semibold">Profile cosmetics</h3></div>
          <p className="mt-1 text-xs text-[var(--synnical-muted)]">Choose and preview cosmetics in a separate full-size profile window so this editor stays compact.</p>
          <div className="mt-4 divide-y divide-[var(--synnical-border)] rounded-lg border border-[var(--synnical-border)] bg-black">
            <button type="button" onClick={() => openCosmetics("decoration")} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#111]">
              <div className="flex h-10 w-10 items-center justify-center"><AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={user.avatarDeco} size="sm" /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">Avatar decoration</p><p className="truncate text-xs text-[var(--synnical-muted)]">{user.avatarDeco ? AVATAR_DECORATIONS.find((item) => item.id === user.avatarDeco)?.name || "Equipped decoration" : "None"}</p></div>
              <ChevronRight className="h-4 w-4 text-[var(--synnical-muted)]" />
            </button>
            <button type="button" onClick={() => openCosmetics("effect")} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[#111]">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#111]"><Sparkles className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">Profile effect</p><p className="truncate text-xs text-[var(--synnical-muted)]">{user.profileEffect ? PROFILE_EFFECTS.find((item) => item.id === user.profileEffect)?.name || "Equipped effect" : "None"}</p></div>
              <ChevronRight className="h-4 w-4 text-[var(--synnical-muted)]" />
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4">
          <div className="flex items-center gap-2"><Palette className="h-4 w-4 text-white" /><h3 className="text-sm font-semibold">Profile card theme</h3></div>
          <p className="mt-1 text-xs text-[var(--synnical-muted)]">These colors are saved to your account, so everyone sees the same card theme.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="rounded-lg border border-[var(--synnical-border)] bg-black p-3"><span className="mb-2 block text-xs text-[var(--synnical-muted)]">Primary</span><div className="flex items-center gap-2"><input aria-label="Primary profile color" type="color" value={themePrimary} onChange={(event) => setThemePrimary(event.target.value)} className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent p-0" /><Input value={themePrimary} onChange={(event) => setThemePrimary(event.target.value)} maxLength={7} className="font-mono" /></div></label>
            <label className="rounded-lg border border-[var(--synnical-border)] bg-black p-3"><span className="mb-2 block text-xs text-[var(--synnical-muted)]">Accent</span><div className="flex items-center gap-2"><input aria-label="Accent profile color" type="color" value={themeAccent} onChange={(event) => setThemeAccent(event.target.value)} className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent p-0" /><Input value={themeAccent} onChange={(event) => setThemeAccent(event.target.value)} maxLength={7} className="font-mono" /></div></label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setThemeStyle("solid")} className={`rounded-lg border px-3 py-2 text-sm ${themeStyle === "solid" ? "border-white bg-white text-black" : "border-[var(--synnical-border)] bg-black text-white"}`}>Solid</button>
            <button type="button" onClick={() => setThemeStyle("gradient")} className={`rounded-lg border px-3 py-2 text-sm ${themeStyle === "gradient" ? "border-white bg-white text-black" : "border-[var(--synnical-border)] bg-black text-white"}`}>Gradient</button>
          </div>
          <div className="mt-3 h-10 rounded-lg border border-white/15" style={{ background: themeStyle === "gradient" ? `linear-gradient(145deg, ${themePrimary}, ${themeAccent})` : themePrimary }} />
          <div className="mt-3 flex justify-end"><Button onClick={() => void saveTheme()} disabled={themeBusy || (themePrimary === user.profileThemePrimary && themeAccent === user.profileThemeAccent && themeStyle === user.profileThemeStyle)}>{themeBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save theme</Button></div>
        </section>

        {/* Editable fields */}
        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username {canUseShortUsername && <span className="text-amber-500 text-xs">(staff: 1 char min)</span>}</Label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} maxLength={24} />
            <p className="text-xs text-[var(--synnical-muted)]">Lowercase letters, numbers, hyphens, underscores. {canUseShortUsername ? "Owner and admin can use 1 character." : "Minimum 2 characters."}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200} rows={3} placeholder="Tell people about yourself" />
            <p className="text-xs text-[var(--synnical-muted)] text-right">{bio.length}/200</p>
          </div>
          <Button
            variant="outline"
            className="w-full gap-2 border-[#353535] text-white hover:bg-[#111] hover:text-white"
            onClick={() => setStatsOpen(true)}
          >
            <ShieldCheck className="h-4 w-4" />
            Account Standing &amp; Stats
          </Button>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <div className="flex gap-2">
              <Input id="status" value={status} onChange={(e) => setStatus(e.target.value)} maxLength={100} placeholder="What are you up to?" />
              <Button onClick={saveStatus} disabled={savingStatus || status === user.status} variant="outline" className="shrink-0">{savingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={!dirty || saving} className="border border-white bg-white text-black hover:bg-[#e8e8e8]">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : dirty ? <Check className="mr-2 h-4 w-4" /> : null}
              Save changes
            </Button>
          </div>
        </div>

        {/* Connections — read from localStorage, shown only if the user has any */}
        {showConnections && connections.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-[var(--synnical-text)] mb-3">Connections</h3>
            <div className="flex flex-wrap gap-2">
              {connections.map((c) => {
                const platform = getPlatform(c.platform)
                return (
                  <div
                    key={c.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] py-1.5 pl-1.5 pr-3"
                  >
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-md overflow-hidden shrink-0"
                      style={platform ? { backgroundColor: `#${platform.color}1a` } : undefined}
                    >
                      {platform ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={platform.iconUrl} alt={platform.name} className="h-4 w-4" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium leading-tight text-[var(--synnical-text)] truncate max-w-[140px]">
                        {c.username}
                      </p>
                      <p className="text-[10px] leading-tight text-[var(--synnical-muted)] truncate max-w-[140px]">
                        {platform?.name || c.platform}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <IdentityStudio />

        <ProfileAdvancedEditor user={user} onUserRefresh={async () => { try { const { user: updated } = await api.me(); if (updated) setUser(updated) } catch {} }} />

        {/* Server-enforced privacy lives in Settings, not browser-only switches. */}
        <div className="mt-6 rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--synnical-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--synnical-text)]">Profile Privacy</h3>
          </div>
          <p className="text-xs text-[var(--synnical-muted)]">Your real visibility rules are enforced on the server. Open Settings → Privacy & Safety to choose account defaults, per-friend overrides, and preview what a specific friend can see.</p>
        </div>
      </div>

      <ImageCropperV2 open={cropOpen} src={cropSrc} aspect={cropMode === "pfp" ? 1 : 3} circular={cropMode === "pfp"} title={cropMode === "pfp" ? "Crop profile picture" : "Crop banner"} onConfirm={onCropConfirm} onCancel={onCropCancel} />

      <ProfileCosmeticsDialog
        open={cosmeticsOpen}
        onOpenChange={setCosmeticsOpen}
        initialTab={cosmeticsTab}
        user={user}
        ownedDecorations={ownedDecos}
        ownedEffects={ownedEffects}
        staffDecorationAccess={staffDecorationAccess}
        staffProfileEffectAccess={staffProfileEffectAccess}
        onUserUpdated={setUser}
      />

      <AccountStats open={statsOpen} onOpenChange={setStatsOpen} />
    </div>
  )
}

function PrivacyBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium border ${enabled ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-red-500/10 text-red-400 border-red-500/30"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-400" : "bg-red-400"}`} />
      {label}
    </span>
  )
}
