"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Expand, Loader2, ShoppingCart, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AvatarWithDeco } from "@/components/role-ui"
import { ProfileCardPreview } from "@/components/profile-card-preview"
import { ProfileEffectThumbnail, profileEffectGeometryLabel, useProfileEffectGeometry } from "@/components/profile-effects"
import { AVATAR_DECORATIONS } from "@/lib/avatar-decoration-catalog"
import { PROFILE_EFFECTS } from "@/lib/profile-effect-catalog"
import { api, type SafeUser } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

export type CosmeticPickerTab = "decoration" | "effect"

export function ProfileCosmeticsDialog({
  open,
  onOpenChange,
  initialTab,
  user,
  ownedDecorations,
  ownedEffects,
  staffDecorationAccess,
  staffProfileEffectAccess,
  onUserUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab: CosmeticPickerTab
  user: SafeUser
  ownedDecorations: Set<string>
  ownedEffects: Set<string>
  staffDecorationAccess: boolean
  staffProfileEffectAccess: boolean
  onUserUpdated: (user: SafeUser) => void
}) {
  const [tab, setTab] = useState<CosmeticPickerTab>(initialTab)
  const [previewDeco, setPreviewDeco] = useState<string | null>(user.avatarDeco)
  const [previewEffect, setPreviewEffect] = useState<string | null>(user.profileEffect)
  const [busy, setBusy] = useState(false)
  const effectGeometry = useProfileEffectGeometry(previewEffect)

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    setPreviewDeco(user.avatarDeco)
    setPreviewEffect(user.profileEffect)
  }, [initialTab, open, user.avatarDeco, user.profileEffect])

  const selectedName = useMemo(() => {
    if (tab === "decoration") return previewDeco ? AVATAR_DECORATIONS.find((x) => x.id === previewDeco)?.name || "Decoration" : "No decoration"
    return previewEffect ? PROFILE_EFFECTS.find((x) => x.id === previewEffect)?.name || "Profile effect" : "No profile effect"
  }, [previewDeco, previewEffect, tab])

  const selectedOwned = tab === "decoration"
    ? !previewDeco || staffDecorationAccess || ownedDecorations.has(previewDeco)
    : !previewEffect || staffProfileEffectAccess || ownedEffects.has(previewEffect)

  const changed = tab === "decoration" ? previewDeco !== user.avatarDeco : previewEffect !== user.profileEffect

  const apply = async () => {
    if (!selectedOwned) return toast.error("Buy this item in the Shop before equipping it")
    setBusy(true)
    try {
      const result = tab === "decoration" ? await api.setDeco(previewDeco) : await api.setProfileEffect(previewEffect)
      onUserUpdated(result.user)
      toast.success(tab === "decoration" ? (previewDeco ? "Avatar decoration equipped" : "Avatar decoration removed") : (previewEffect ? "Profile effect equipped" : "Profile effect removed"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not equip profile cosmetic")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="inset-0 left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Choose profile cosmetic</DialogTitle>
        <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_380px] max-lg:grid-cols-1 max-lg:grid-rows-[minmax(0,1fr)_minmax(280px,44vh)]">
          <main className="relative min-h-0 overflow-auto bg-[#030303] p-6 max-sm:p-4">
            <div className="pointer-events-none sticky left-0 top-0 z-10 mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-white/45">Full profile preview</p>
                <p className="mt-1 text-sm text-white/70">The card follows the effect&apos;s original canvas instead of stretching the effect.</p>
              </div>
              <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 text-[11px] text-white/55 md:inline-flex">
                <Expand className="h-3.5 w-3.5" />
                {previewEffect ? profileEffectGeometryLabel(effectGeometry) : "Default profile canvas"}
              </span>
            </div>

            <div className="flex min-h-[calc(100%-72px)] items-start justify-center py-4">
              <div data-synnical-cosmetic-preview><ProfileCardPreview user={user} avatarDeco={previewDeco} profileEffect={previewEffect} scale="showcase" /></div>
            </div>
          </main>

          <aside className="flex min-h-0 flex-col border-l border-white/10 bg-[#070707] max-lg:border-l-0 max-lg:border-t">
            <div className="shrink-0 border-b border-white/10 p-4 pr-12">
              <div className="flex gap-1 rounded-lg border border-white/10 bg-black p-1">
                <button type="button" onClick={() => setTab("decoration")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", tab === "decoration" ? "bg-white text-black" : "text-white/55 hover:text-white")}>Avatar decorations</button>
                <button type="button" onClick={() => setTab("effect")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", tab === "effect" ? "bg-white text-black" : "text-white/55 hover:text-white")}>Profile effects</button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scroll">
              {tab === "decoration" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setPreviewDeco(null)} className={cn("rounded-xl border p-3", previewDeco === null ? "border-white bg-[#151515]" : "border-white/10 bg-[#0b0b0b]")}>                    
                    <div className="mx-auto flex h-24 items-center justify-center text-sm text-white/45">None</div>
                    <p className="text-xs font-medium">Remove decoration</p>
                  </button>
                  {AVATAR_DECORATIONS.map((item) => {
                    const available = staffDecorationAccess || ownedDecorations.has(item.id)
                    return (
                      <button key={item.id} type="button" onClick={() => setPreviewDeco(item.id)} className={cn("min-w-0 rounded-xl border p-3 text-left", previewDeco === item.id ? "border-white bg-[#151515]" : "border-white/10 bg-[#0b0b0b]")}>                        
                        <div className="flex h-24 items-center justify-center overflow-visible"><AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={item.id} size="lg" /></div>
                        <p className="mt-1 truncate text-xs font-medium">{item.name}</p>
                        <p className={cn("mt-1 text-[10px]", available ? "text-emerald-300" : "text-white/40")}>{available ? (staffDecorationAccess ? "Staff access" : "Owned") : "Shop · 1,000"}</p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setPreviewEffect(null)} className={cn("overflow-hidden rounded-xl border text-left", previewEffect === null ? "border-white bg-[#151515]" : "border-white/10 bg-[#0b0b0b]")}>                    
                    <div className="flex aspect-[4/5] items-center justify-center bg-black text-sm text-white/45">None</div>
                    <div className="p-3"><p className="text-xs font-medium">Remove effect</p></div>
                  </button>
                  {PROFILE_EFFECTS.map((item) => {
                    const available = staffProfileEffectAccess || ownedEffects.has(item.id)
                    return (
                      <button key={item.id} type="button" onClick={() => setPreviewEffect(item.id)} className={cn("min-w-0 overflow-hidden rounded-xl border text-left", previewEffect === item.id ? "border-white bg-[#151515]" : "border-white/10 bg-[#0b0b0b]")}>                        
                        <ProfileEffectThumbnail effect={item.id} className="max-h-48" />
                        <div className="p-3">
                          <p className="truncate text-xs font-medium">{item.name}</p>
                          <p className={cn("mt-1 text-[10px]", available ? "text-emerald-300" : "text-white/40")}>{available ? (staffProfileEffectAccess ? "Staff access" : "Owned") : "Shop · 2,000"}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-white/10 bg-[#050505] p-4">
              <p className="truncate text-center text-sm font-semibold">{selectedName}</p>
              {!selectedOwned ? <p className="mt-1 text-center text-xs text-amber-300"><ShoppingCart className="mr-1 inline h-3 w-3" />Preview only · buy in Shop to equip</p> : null}
              {tab === "effect" && previewEffect ? <p className="mt-1 text-center text-[10px] text-white/35">Native canvas: {profileEffectGeometryLabel(effectGeometry)}</p> : null}
              <Button className="mt-3 w-full" onClick={() => void apply()} disabled={!changed || !selectedOwned || busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Apply
              </Button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
