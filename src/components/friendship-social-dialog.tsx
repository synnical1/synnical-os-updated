"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { CalendarHeart, Goal, HeartHandshake, Loader2, MessageCircleHeart, Sparkles, Trash2, Trophy, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AvatarWithDeco, DisplayName } from "@/components/role-ui"
import { featureApi } from "@/lib/feature-api"
import { useAuth } from "@/hooks/use-auth"
import type { FriendUser, SafeUser } from "@/lib/api"
import { cn } from "@/lib/utils"

type BondState = {
  friend: SafeUser
  friendshipSince: string
  bond: {
    id: string
    xp: number
    messageCount: number
    duoName: string
    title: string
    bannerOwnerId: string | null
    lastInteractionAt: string | null
    level: number
    levelFloor: number
    levelCeiling: number
    unlockedTitles: string[]
    daysSinceInteraction: number
    reconnectSuggested: boolean
  }
  memories: Array<{ id: string; creatorId: string; note: string; happenedAt: string; onThisDay: boolean; canDelete: boolean }>
  goals: Array<{ id: string; creatorId: string; title: string; target: number; current: number; status: string; dueAt: string | null; canDelete: boolean }>
  milestones: Array<{ id: string; code: string; label: string; achievedAt: string }>
  compatibility: {
    games: { score: number; shared: Array<{ id: string; name: string }>; mine: number; theirs: number; source: string }
    movies: { score: number; shared: string[]; mine: number; theirs: number; source: string }
    music: { score: number; shared: string[]; mine: number; theirs: number; source: string }
  }
}

function percent(current: number, floor: number, ceiling: number) {
  if (ceiling <= floor) return 100
  return Math.max(0, Math.min(100, Math.round(((current - floor) / (ceiling - floor)) * 100)))
}

function dateInput(value = new Date()) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function FriendshipSocialDialog({ friend, open, onOpenChange }: { friend: FriendUser | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  const [state, setState] = useState<BondState | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState("")
  const [duoName, setDuoName] = useState("")
  const [title, setTitle] = useState("")
  const [bannerOwnerId, setBannerOwnerId] = useState("")
  const [memoryNote, setMemoryNote] = useState("")
  const [memoryDate, setMemoryDate] = useState(dateInput())
  const [goalTitle, setGoalTitle] = useState("")
  const [goalTarget, setGoalTarget] = useState("1")
  const [goalDue, setGoalDue] = useState("")

  const load = async () => {
    if (!friend) return
    setLoading(true)
    try {
      const next = await featureApi.friends.bond(friend.id) as BondState
      setState(next)
      setDuoName(next.bond.duoName || "")
      setTitle(next.bond.title || "")
      setBannerOwnerId(next.bond.bannerOwnerId || "")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load friendship")
    } finally { setLoading(false) }
  }

  useEffect(() => { if (open && friend) void load(); if (!open) setState(null) }, [open, friend?.id])

  const bannerUrl = useMemo(() => {
    if (!state || !user) return null
    if (state.bond.bannerOwnerId === state.friend.id) return state.friend.bannerUrl
    if (state.bond.bannerOwnerId === user.id) return user.bannerUrl
    return null
  }, [state, user])

  if (!friend) return null

  const action = async (name: string, payload: Record<string, unknown>) => {
    setBusy(name)
    try {
      await featureApi.friends.action(name, friend.id, payload)
      await load()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Friendship action failed")
      return false
    } finally { setBusy("") }
  }

  const saveDuo = async () => {
    if (await action("update-duo", { duoName, title, bannerOwnerId: bannerOwnerId || null })) toast.success("Duo card updated")
  }

  const addMemory = async () => {
    if (!memoryNote.trim()) return
    if (await action("add-memory", { note: memoryNote, happenedAt: `${memoryDate}T12:00:00` })) {
      setMemoryNote("")
      toast.success("Memory added")
    }
  }

  const addGoal = async () => {
    if (!goalTitle.trim()) return
    if (await action("add-goal", { title: goalTitle, target: Number(goalTarget) || 1, dueAt: goalDue ? `${goalDue}T12:00:00` : null })) {
      setGoalTitle(""); setGoalTarget("1"); setGoalDue("")
      toast.success("Shared goal added")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[var(--synnical-border)]">
          <DialogTitle className="flex items-center gap-2"><HeartHandshake className="h-5 w-5 text-rose-400" /> Friendship</DialogTitle>
        </DialogHeader>
        {loading || !state ? (
          <div className="grid min-h-72 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--synnical-accent)]" /></div>
        ) : (
          <Tabs defaultValue="duo" className="min-h-0 flex-1 overflow-hidden px-5 pb-5">
            <TabsList className="mt-3 w-full grid grid-cols-4">
              <TabsTrigger value="duo">Duo</TabsTrigger>
              <TabsTrigger value="memories">Memories</TabsTrigger>
              <TabsTrigger value="goals">Goals</TabsTrigger>
              <TabsTrigger value="match">Match</TabsTrigger>
            </TabsList>

            <div className="mt-3 max-h-[66vh] overflow-y-auto custom-scroll pr-1">
              <TabsContent value="duo" className="space-y-4">
                <div className="relative overflow-hidden rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)]">
                  <div className="h-28 bg-gradient-to-br from-rose-500/25 via-violet-500/15 to-cyan-500/20 bg-cover bg-center" style={bannerUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,.22),rgba(0,0,0,.62)),url(${JSON.stringify(bannerUrl).slice(1,-1)})` } : undefined} />
                  <div className="-mt-7 flex items-end gap-3 px-4 pb-4">
                    <AvatarWithDeco src={user?.pfpUrl || null} name={user?.displayName || "You"} role={user?.role || "MEMBER"} avatarDeco={user?.avatarDeco || null} size="lg" className="ring-4 ring-[var(--synnical-surface-2)]" />
                    <AvatarWithDeco src={state.friend.pfpUrl} name={state.friend.displayName} role={state.friend.role} avatarDeco={state.friend.avatarDeco} size="lg" className="-ml-5 ring-4 ring-[var(--synnical-surface-2)]" />
                    <div className="min-w-0 pb-1">
                      <p className="truncate text-lg font-bold">{state.bond.duoName || `${user?.displayName || "You"} + ${state.friend.displayName}`}</p>
                      <p className="text-xs text-[var(--synnical-muted)]">{state.bond.title || state.bond.unlockedTitles.at(-1) || "New Duo"}</p>
                    </div>
                    <div className="ml-auto rounded-lg bg-black/30 px-3 py-2 text-center backdrop-blur">
                      <p className="text-xl font-black">{state.bond.level}</p><p className="text-[10px] uppercase text-white/60">Duo level</p>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-xs"><span>{state.bond.xp} friendship XP</span><span>{state.bond.levelCeiling} XP</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--synnical-surface-2)]"><div className="h-full rounded-full bg-[var(--synnical-accent)]" style={{ width: `${percent(state.bond.xp, state.bond.levelFloor, state.bond.levelCeiling)}%` }} /></div>
                  <p className="mt-1 text-[10px] text-[var(--synnical-muted)]">XP from real friend DM activity is rate-limited so spam cannot farm levels.</p>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Messages" value={state.bond.messageCount.toLocaleString()} />
                  <Stat label="Friends since" value={new Date(state.friendshipSince).toLocaleDateString()} />
                  <Stat label="Mutual friends" value={String(friend.mutualCount)} />
                  <Stat label="Last interaction" value={state.bond.daysSinceInteraction === 0 ? "Today" : `${state.bond.daysSinceInteraction}d ago`} warn={state.bond.reconnectSuggested} />
                </div>
                {state.bond.reconnectSuggested && <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-sm"><MessageCircleHeart className="mr-2 inline h-4 w-4 text-amber-300" />You haven't talked in {state.bond.daysSinceInteraction} days. Maybe send them something instead of letting the friendship become archaeological evidence.</div>}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Shared duo name</Label><Input value={duoName} onChange={(e) => setDuoName(e.target.value)} maxLength={40} placeholder="The chaos twins" /></div>
                  <div><Label>Unlocked duo title</Label><select value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 w-full rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] px-3 text-sm"><option value="">Automatic</option>{state.bond.unlockedTitles.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
                  <div className="sm:col-span-2"><Label>Shared banner</Label><select value={bannerOwnerId} onChange={(e) => setBannerOwnerId(e.target.value)} className="h-9 w-full rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] px-3 text-sm"><option value="">Duo gradient</option><option value={user?.id}>{user?.displayName || "Your"} banner</option><option value={state.friend.id}>{state.friend.displayName}'s banner</option></select></div>
                </div>
                <Button onClick={() => void saveDuo()} disabled={Boolean(busy)} className="bg-[var(--synnical-accent)] text-black">{busy === "update-duo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Save duo card</Button>

                <div>
                  <h4 className="mb-2 text-sm font-semibold"><Trophy className="mr-2 inline h-4 w-4 text-amber-300" />Milestones</h4>
                  {state.milestones.length ? <div className="grid gap-2 sm:grid-cols-2">{state.milestones.map((item) => <div key={item.id} className="rounded-lg border border-[var(--synnical-border)] p-3"><p className="text-sm font-medium">{item.label}</p><p className="text-[10px] text-[var(--synnical-muted)]">{new Date(item.achievedAt).toLocaleDateString()}</p></div>)}</div> : <p className="text-xs text-[var(--synnical-muted)]">Keep talking and milestones will appear here.</p>}
                </div>
              </TabsContent>

              <TabsContent value="memories" className="space-y-4">
                <div className="rounded-xl border border-[var(--synnical-border)] p-4">
                  <h4 className="mb-3 text-sm font-semibold"><CalendarHeart className="mr-2 inline h-4 w-4 text-rose-400" />Add to your friendship scrapbook</h4>
                  <textarea value={memoryNote} onChange={(e) => setMemoryNote(e.target.value)} maxLength={500} rows={3} placeholder="That time we somehow won…" className="w-full rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-2 text-sm outline-none" />
                  <div className="mt-2 flex gap-2"><Input type="date" value={memoryDate} onChange={(e) => setMemoryDate(e.target.value)} /><Button onClick={() => void addMemory()} disabled={!memoryNote.trim() || Boolean(busy)}>Add memory</Button></div>
                </div>
                {state.memories.length ? state.memories.map((memory) => <div key={memory.id} className={cn("rounded-xl border p-4", memory.onThisDay ? "border-rose-400/40 bg-rose-500/10" : "border-[var(--synnical-border)]")}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-xs text-[var(--synnical-muted)]">{new Date(memory.happenedAt).toLocaleDateString()}</p>{memory.onThisDay && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-200">On this day</span>}</div><p className="mt-1 whitespace-pre-wrap text-sm">{memory.note}</p></div>{memory.canDelete && <Button size="icon" variant="ghost" onClick={() => void action("delete-memory", { id: memory.id })}><Trash2 className="h-4 w-4" /></Button>}</div></div>) : <p className="py-10 text-center text-sm text-[var(--synnical-muted)]">No scrapbook memories yet.</p>}
              </TabsContent>

              <TabsContent value="goals" className="space-y-4">
                <div className="rounded-xl border border-[var(--synnical-border)] p-4"><h4 className="mb-3 text-sm font-semibold"><Goal className="mr-2 inline h-4 w-4" />Create a shared goal</h4><Input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} maxLength={100} placeholder="Win 10 matches together" /><div className="mt-2 grid grid-cols-2 gap-2"><Input type="number" min={1} max={100000} value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} placeholder="Target" /><Input type="date" value={goalDue} onChange={(e) => setGoalDue(e.target.value)} /></div><Button className="mt-2" onClick={() => void addGoal()} disabled={!goalTitle.trim() || Boolean(busy)}>Add shared goal</Button></div>
                {state.goals.map((goal) => <div key={goal.id} className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="font-medium">{goal.title}</p><span className="text-xs text-[var(--synnical-muted)]">{goal.current}/{goal.target}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--synnical-surface-2)]"><div className="h-full bg-[var(--synnical-accent)]" style={{ width: `${Math.min(100, Math.round((goal.current / Math.max(1, goal.target)) * 100))}%` }} /></div>{goal.dueAt && <p className="mt-1 text-[10px] text-[var(--synnical-muted)]">Due {new Date(goal.dueAt).toLocaleDateString()}</p>}</div>{goal.canDelete && <Button size="icon" variant="ghost" onClick={() => void action("delete-goal", { id: goal.id })}><Trash2 className="h-4 w-4" /></Button>}</div>{goal.status === "active" ? <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => void action("update-goal", { id: goal.id, current: Math.min(goal.target, goal.current + 1) })}>+1 progress</Button><Button size="sm" variant="outline" onClick={() => void action("update-goal", { id: goal.id, status: "completed" })}>Complete</Button></div> : <p className="mt-2 text-xs font-medium text-emerald-400">{goal.status === "completed" ? "Completed" : "Cancelled"}</p>}</div>)}
              </TabsContent>

              <TabsContent value="match" className="space-y-3">
                <p className="text-xs text-[var(--synnical-muted)]">These scores use activity saved inside Synnical. They do not pretend to know which PC games you own.</p>
                <CompatibilityCard icon={<UsersRound className="h-4 w-4" />} title="Game taste" data={state.compatibility.games} names={state.compatibility.games.shared.map((item) => item.name)} />
                <CompatibilityCard icon={<CalendarHeart className="h-4 w-4" />} title="Movie & show taste" data={state.compatibility.movies} names={state.compatibility.movies.shared} />
                <CompatibilityCard icon={<Sparkles className="h-4 w-4" />} title="Music taste" data={state.compatibility.music} names={state.compatibility.music.shared} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div className={cn("rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-3", warn && "border-amber-400/30")}><p className="text-sm font-bold">{value}</p><p className="text-[10px] text-[var(--synnical-muted)]">{label}</p></div>
}

function CompatibilityCard({ icon, title, data, names }: { icon: ReactNode; title: string; data: { score: number; mine: number; theirs: number; source: string }; names: string[] }) {
  return <div className="rounded-xl border border-[var(--synnical-border)] p-4"><div className="flex items-center gap-2"><span className="text-[var(--synnical-accent)]">{icon}</span><h4 className="font-semibold">{title}</h4><span className="ml-auto text-xl font-black">{data.score}%</span></div><p className="mt-1 text-[10px] text-[var(--synnical-muted)]">{data.source} · you {data.mine} / them {data.theirs}</p>{names.length ? <div className="mt-3 flex flex-wrap gap-1">{names.map((name) => <span key={name} className="rounded-full bg-[var(--synnical-surface-2)] px-2 py-1 text-[10px]">{name}</span>)}</div> : <p className="mt-3 text-xs text-[var(--synnical-muted)]">No shared saved items yet.</p>}</div>
}
