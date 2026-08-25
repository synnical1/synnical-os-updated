"use client"

import { useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { AnimatedBrandMark } from "@/components/animated-brand-mark"

export function AuthScreen({ embedded = false }: { embedded?: boolean }) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [securityQuestion, setSecurityQuestion] = useState("What was the name of your first pet?")
  const [securityAnswer, setSecurityAnswer] = useState("")
  const [useRecovery, setUseRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || (mode === "login" && useRecovery ? !recoveryCode.trim() : !password) || (mode === "register" && (!securityQuestion.trim() || !securityAnswer.trim()))) return
    setBusy(true)
    try {
      if (mode === "login") await login(username.trim(), password, useRecovery ? recoveryCode.trim() : undefined)
      else await register(username.trim(), password, securityQuestion.trim(), securityAnswer)
      toast.success(mode === "login" ? "Welcome back" : "Account created")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  const form = (
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-[#101010] border border-[#2a2a2a] flex items-center justify-center mb-3">
              <AnimatedBrandMark className="h-8 w-8 rounded-lg" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Synnical</h1>
            <p className="text-sm text-[var(--synnical-muted)] mt-1">Welcome back.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Pick a username"
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            {mode === "login" && useRecovery ? (
              <div className="space-y-2">
                <Label htmlFor="recoveryCode">Recovery code</Label>
                <Input id="recoveryCode" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())} placeholder="ABCDE-FGHIJ-KLMNO-PQRST" autoComplete="one-time-code" required />
                <p className="text-xs text-[var(--synnical-muted)]">Each recovery code works once. A successful sign-in consumes it.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  required
                />
              </div>
            )}
            {mode === "login" && (
              <button type="button" onClick={() => setUseRecovery((value) => !value)} className="text-xs text-[var(--synnical-accent)] hover:underline">
                {useRecovery ? "Use password instead" : "Use a recovery code"}
              </button>
            )}
            {mode === "register" && (
              <div className="space-y-3 rounded-lg border border-[var(--synnical-border)] p-3">
                <div className="space-y-2"><Label htmlFor="security-question">Security question</Label><Input id="security-question" value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)} minLength={8} maxLength={180} required /></div>
                <div className="space-y-2"><Label htmlFor="security-answer">Security answer</Label><Input id="security-answer" type="password" value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} minLength={3} maxLength={220} autoComplete="off" required /><p className="text-[11px] text-[var(--synnical-muted)]">Used only for the verified password-recovery path.</p></div>
              </div>
            )}

            <Button type="submit" className="w-full bg-[var(--synnical-accent)] hover:bg-[var(--synnical-accent-hover)] text-black" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-[var(--synnical-muted)]">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
              className="text-[var(--synnical-accent)] hover:text-[var(--synnical-accent)] font-medium"
            >
              {mode === "login" ? "Register" : "Log in"}
            </button>
          </div>
        </div>
  )

  if (embedded) {
    return (
      <div className="h-full overflow-y-auto bg-[var(--synnical-bg)] p-4">
        <div className="min-h-full flex flex-col items-center justify-center">
          <div className="mb-5 max-w-sm text-center">
            <p className="text-sm font-semibold text-[var(--synnical-text)]">Guest mode is active</p>
            <p className="mt-1 text-xs text-[var(--synnical-muted)]">The Browser works without an account. Log in only when you want Chat, Friends, Shop, and Profile.</p>
          </div>
          {form}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--synnical-bg)]">
      <main className="flex-1 flex items-center justify-center p-4">{form}</main>
    </div>
  )
}
