"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Link2, ShieldCheck, Music, Trophy, Eye, Palette, Heart, Save, Loader2, Trash2, CheckCircle2, Star } from "lucide-react"
import { toast } from "sonner"
import { AVATAR_DECORATIONS } from "@/lib/avatar-decoration-catalog"
import { PROFILE_EFFECTS } from "@/lib/profile-effect-catalog"
import type { SafeUser } from "@/lib/api"

type ProfileFeatures = {
  profile: {
    birthday?: string | null
    birthdayVisibility?: string
    pronouns?: string
    pronounsVisibility?: string
    visitorVisibility?: string
    profileAccentGradient?: string
    bannerPositionX?: number
    bannerPositionY?: number
    statusExpiresAt?: string | null
    profileMusic?: { provider?: "audius" | "piped" | "invidious"; trackId?: string; title?: string; artist?: string; artwork?: string } | null
  }
  links: Array<any>
  showcases: Array<any>
  achievements: Array<any>
  visitorCount: number | null
  visitors: Array<any>
  cosmeticFavorites: Array<any>
  cosmeticLoadouts: Array<any>
  cosmeticWishlist: Array<any>
}

async function featureFetch(body?: any) {
  const res = await fetch("/api/features/profile", body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || "Profile feature request failed")
  return json
}

export function ProfileAdvancedEditor({ user, onUserRefresh }: { user: SafeUser; onUserRefresh?: () => void | Promise<void> }) {
  const [state, setState] = useState<ProfileFeatures | null>(null)
  const [busy, setBusy] = useState("")
  const [birthday, setBirthday] = useState("")
  const [birthdayVisibility, setBirthdayVisibility] = useState("private")
  const [pronouns, setPronouns] = useState("")
  const [pronounsVisibility, setPronounsVisibility] = useState("everyone")
  const [visitorVisibility, setVisitorVisibility] = useState("enabled")
  const [gradient, setGradient] = useState("")
  const [bannerX, setBannerX] = useState(50)
  const [bannerY, setBannerY] = useState(50)
  const [statusExpiry, setStatusExpiry] = useState("")
  const [musicProvider, setMusicProvider] = useState("audius")
  const [musicTitle, setMusicTitle] = useState("")
  const [musicArtist, setMusicArtist] = useState("")
  const [musicTrackId, setMusicTrackId] = useState("")
  const [musicArtwork, setMusicArtwork] = useState("")
  const [linkLabel, setLinkLabel] = useState("")
  const [linkUrl, setLinkUrl] = useState("")
  const [showcaseKind, setShowcaseKind] = useState("game")
  const [showcaseRef, setShowcaseRef] = useState("")
  const [showcaseLabel, setShowcaseLabel] = useState("")
  const [loadoutName, setLoadoutName] = useState("")

  const load = useCallback(async () => {
    try {
      const body = await featureFetch() as ProfileFeatures
      setState(body)
      const p = body.profile || {}
      setBirthday(p.birthday || "")
      setBirthdayVisibility(p.birthdayVisibility || "private")
      setPronouns(p.pronouns || "")
      setPronounsVisibility(p.pronounsVisibility || "everyone")
      setVisitorVisibility(p.visitorVisibility || "enabled")
      setGradient(p.profileAccentGradient || "")
      setBannerX(Number(p.bannerPositionX ?? 50))
      setBannerY(Number(p.bannerPositionY ?? 50))
      setStatusExpiry(p.statusExpiresAt ? new Date(p.statusExpiresAt).toISOString().slice(0, 16) : "")
      setMusicProvider(p.profileMusic?.provider || "audius")
      setMusicTitle(p.profileMusic?.title || "")
      setMusicArtist(p.profileMusic?.artist || "")
      setMusicTrackId(p.profileMusic?.trackId || "")
      setMusicArtwork(p.profileMusic?.artwork || "")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load profile features") }
  }, [])

  useEffect(() => { void load() }, [load])

  const act = async (key: string, body: any, success?: string) => {
    setBusy(key)
    try {
      await featureFetch(body)
      if (success) toast.success(success)
      await load()
      await onUserRefresh?.()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Request failed") }
    finally { setBusy("") }
  }

  const favoriteKeys = useMemo(() => new Set((state?.cosmeticFavorites || []).map((row: any) => `${row.itemType}:${row.itemId}`)), [state?.cosmeticFavorites])
  const wishKeys = useMemo(() => new Set((state?.cosmeticWishlist || []).map((row: any) => `${row.itemType}:${row.itemId}`)), [state?.cosmeticWishlist])

  if (!state) return <div className="mt-6 flex items-center justify-center rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-6 text-xs text-[var(--synnical-muted)]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading account-backed profile features…</div>

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4">
        <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4" /><h3 className="text-sm font-semibold">Identity & privacy</h3></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Birthday"><Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></Field>
          <Field label="Birthday visibility"><NativeSelect value={birthdayVisibility} onChange={setBirthdayVisibility} options={["everyone", "friends", "private"]} /></Field>
          <Field label="Pronouns"><Input maxLength={40} value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="Optional" /></Field>
          <Field label="Pronouns visibility"><NativeSelect value={pronounsVisibility} onChange={setPronounsVisibility} options={["everyone", "friends", "private"]} /></Field>
          <Field label="Profile visitors"><NativeSelect value={visitorVisibility} onChange={setVisitorVisibility} options={["enabled", "private"]} /></Field>
          <Field label="Status expires"><Input type="datetime-local" value={statusExpiry} onChange={(e) => setStatusExpiry(e.target.value)} /></Field>
        </div>
        <Button className="mt-3" size="sm" onClick={() => void act("identity", { action: "update-profile", birthday: birthday || null, birthdayVisibility, pronouns, pronounsVisibility, visitorVisibility, statusExpiresAt: statusExpiry ? new Date(statusExpiry).toISOString() : null }, "Profile privacy saved")} disabled={busy === "identity"}>{busy === "identity" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save identity settings</Button>
        {visitorVisibility === "enabled" && <div className="mt-3 rounded-lg border border-[#222] bg-black/40 p-3"><p className="flex items-center gap-2 text-xs font-medium"><Eye className="h-3.5 w-3.5" />Profile visitors · {state.visitorCount ?? 0} unique</p><div className="mt-2 flex flex-wrap gap-1.5">{state.visitors?.slice(0, 12).map((v: any) => <span key={v.id} className="rounded-md bg-[#151515] px-2 py-1 text-[11px] text-[#aaa]">@{v.viewer?.username || "unknown"}</span>)}</div></div>}
      </div>

      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4">
        <div className="mb-3 flex items-center gap-2"><Palette className="h-4 w-4" /><h3 className="text-sm font-semibold">Profile presentation</h3></div>
        <Field label="Accent gradient"><Input value={gradient} onChange={(e) => setGradient(e.target.value)} placeholder="linear-gradient(135deg, #001a44, #000000)" /></Field>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={`Banner horizontal position · ${bannerX}%`}><Input type="range" min={0} max={100} value={bannerX} onChange={(e) => setBannerX(Number(e.target.value))} /></Field><Field label={`Banner vertical position · ${bannerY}%`}><Input type="range" min={0} max={100} value={bannerY} onChange={(e) => setBannerY(Number(e.target.value))} /></Field></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Profile music provider"><NativeSelect value={musicProvider} onChange={setMusicProvider} options={["audius", "piped", "invidious"]} /></Field><Field label="Track ID"><Input value={musicTrackId} onChange={(e) => setMusicTrackId(e.target.value)} placeholder="Provider track/video ID" /></Field><Field label="Profile music title"><Input value={musicTitle} onChange={(e) => setMusicTitle(e.target.value)} /></Field><Field label="Artist"><Input value={musicArtist} onChange={(e) => setMusicArtist(e.target.value)} /></Field><Field label="Artwork URL"><Input value={musicArtwork} onChange={(e) => setMusicArtwork(e.target.value)} /></Field></div>
        <p className="mt-2 text-[11px] text-[var(--synnical-muted)]">Profile tracks use the same first-party Synnical music proxy as Music. Paste a provider track/video ID, not an arbitrary media URL.</p>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => void act("presentation", { action: "update-profile", profileAccentGradient: gradient, bannerPositionX: bannerX, bannerPositionY: bannerY, profileMusic: musicTrackId ? { provider: musicProvider, trackId: musicTrackId, title: musicTitle, artist: musicArtist, artwork: musicArtwork } : null }, "Profile presentation saved")} disabled={busy === "presentation"}><Music className="mr-2 h-4 w-4" />Save presentation</Button><Button size="sm" variant="outline" onClick={() => void act("clear-music", { action: "update-profile", profileMusic: null }, "Profile music cleared")}>Clear music</Button></div>
      </div>

      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4">
        <div className="mb-3 flex items-center gap-2"><Link2 className="h-4 w-4" /><h3 className="text-sm font-semibold">Verified profile links</h3></div>
        <div className="flex flex-col gap-2 sm:flex-row"><Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label" className="sm:w-40" /><Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" /><Button size="sm" onClick={() => void act("add-link", { action: "add-link", label: linkLabel, url: linkUrl }, "Link added")} disabled={!linkLabel || !linkUrl || busy === "add-link"}>Add</Button></div>
        <div className="mt-3 space-y-2">{state.links.map((link: any) => <div key={link.id} className="rounded-lg border border-[#222] bg-black/30 p-3"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{link.label} · {link.domain}</p><p className="truncate text-[11px] text-[#666]">{link.verifiedAt ? "Verified" : `Put token ${link.verificationToken} in /.well-known/synnical-verification.txt`}</p></div>{link.verifiedAt ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Button size="sm" variant="outline" onClick={() => void act(`verify:${link.id}`, { action: "verify-link", linkId: link.id }, "Domain verified")}>Verify</Button>}<Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void act(`delete:${link.id}`, { action: "delete-link", linkId: link.id })}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>)}</div>
      </div>

      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4">
        <div className="mb-3 flex items-center gap-2"><Trophy className="h-4 w-4" /><h3 className="text-sm font-semibold">Showcase</h3></div>
        <div className="grid gap-2 sm:grid-cols-[140px_1fr_1fr_auto]"><NativeSelect value={showcaseKind} onChange={setShowcaseKind} options={["game", "achievement", "badge", "cosmetic"]} /><Input value={showcaseRef} onChange={(e) => setShowcaseRef(e.target.value)} placeholder="Reference ID" /><Input value={showcaseLabel} onChange={(e) => setShowcaseLabel(e.target.value)} placeholder="Display label" /><Button size="sm" onClick={() => void act("showcase", { action: "showcase", kind: showcaseKind, refId: showcaseRef, label: showcaseLabel }, "Showcase saved")}>Add</Button></div>
        <div className="mt-3 flex flex-wrap gap-2">{state.showcases.map((item: any) => <span key={item.id} className="inline-flex items-center gap-2 rounded-lg border border-[#222] bg-black/30 px-2 py-1 text-xs">{item.kind}: {item.label}<button onClick={() => void act(`delshow:${item.id}`, { action: "delete-showcase", id: item.id })}><Trash2 className="h-3 w-3 text-[#777]" /></button></span>)}</div>
        {state.achievements.length > 0 && <div className="mt-3"><p className="mb-2 text-[11px] text-[#777]">Earned achievements · add one to your showcase</p><div className="flex flex-wrap gap-1.5">{state.achievements.slice(0, 20).map((row: any) => <button key={row.achievementId} onClick={() => void act(`ach:${row.achievementId}`, { action: "showcase", kind: "achievement", refId: row.achievementId, label: row.achievement?.name || row.achievementId }, "Achievement showcased")} className="rounded-md border border-[#222] bg-black/30 px-2 py-1 text-[11px] hover:border-[#444]">{row.achievement?.name || row.achievementId}</button>)}</div></div>}
      </div>

      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-4">
        <div className="mb-3 flex items-center gap-2"><Heart className="h-4 w-4" /><h3 className="text-sm font-semibold">Cosmetic favourites, wishlist & loadouts</h3></div>
        <div className="flex gap-2"><Input value={loadoutName} onChange={(e) => setLoadoutName(e.target.value)} placeholder="Loadout name" /><Button size="sm" onClick={() => void act("loadout", { action: "save-loadout", name: loadoutName, avatarDeco: user.avatarDeco, profileEffect: user.profileEffect, themePrimary: user.profileThemePrimary, themeAccent: user.profileThemeAccent, themeStyle: user.profileThemeStyle }, "Loadout saved")}>Save current</Button></div>
        <div className="mt-2 flex flex-wrap gap-2">{state.cosmeticLoadouts.map((row: any) => <Button key={row.id} size="sm" variant="outline" onClick={() => void act(`load:${row.id}`, { action: "apply-loadout", id: row.id }, `Applied ${row.name}`)}>{row.name}</Button>)}</div>
        <p className="mt-4 text-[11px] text-[#777]">Quick cosmetic lists. The full visual preview remains in Profile Cosmetics.</p>
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">{[...AVATAR_DECORATIONS, ...PROFILE_EFFECTS].map((item: any) => { const itemType = item.id.startsWith("deco-") ? "avatar_deco" : "profile_effect"; const key=`${itemType}:${item.id}`; return <div key={key} className="flex items-center gap-2 rounded-lg border border-[#191919] bg-black/25 px-2 py-1.5"><span className="min-w-0 flex-1 truncate text-xs">{item.name}</span><button className={favoriteKeys.has(key) ? "text-amber-300" : "text-[#555]"} title="Favourite" onClick={() => void act(`fav:${key}`, { action: "toggle-cosmetic-favorite", itemType, itemId: item.id })}><Star className="h-4 w-4" fill={favoriteKeys.has(key) ? "currentColor" : "none"} /></button><button className={wishKeys.has(key) ? "text-pink-300" : "text-[#555]"} title="Wishlist" onClick={() => void act(`wish:${key}`, { action: "toggle-cosmetic-wishlist", itemType, itemId: item.id })}><Heart className="h-4 w-4" fill={wishKeys.has(key) ? "currentColor" : "none"} /></button></div> })}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div><Label className="mb-1.5 block text-xs text-[var(--synnical-muted)]">{label}</Label>{children}</div> }
function NativeSelect({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) { return <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-[var(--synnical-border)] bg-black px-3 text-xs text-white">{options.map((option) => <option value={option} key={option}>{option}</option>)}</select> }
