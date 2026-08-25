"use client"

import { Component, ReactNode, useState, useEffect } from "react"

type State = { hasError: boolean; error: Error | null; resetKey: number }

/**
 * Error boundary that catches render crashes in panels.
 *
 * The "Try again" button increments a resetKey which forces a full remount
 * of children (via key prop), rather than just clearing the error state.
 * This actually clears stale refs, timers, and broken component state that
 * caused the crash in the first place.
 *
 */
export class ErrorBoundary extends Component<{ children: ReactNode; name?: string }, State> {
  state: State = { hasError: false, error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error, info)
  }

  handleReset = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      resetKey: prev.resetKey + 1,
    }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
          <div className="max-w-md space-y-3">
            <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-red-500">
              {this.props.name ? `${this.props.name} crashed` : "Panel crashed"}
            </h2>
            <p className="text-sm text-[#888888] break-words">
              {this.state.error?.message || "Unknown error"}
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded-md bg-white text-black text-sm hover:bg-[#e8e8e8] transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return (
      <div key={this.state.resetKey} className="h-full">
        {this.props.children}
      </div>
    )
  }
}

/**
 * Hook for catching async errors in client components.
 * Usage: const { catchError } = useAsyncError();
 *        try { ... } catch (e) { catchError(e) }
 *
 * This is needed because error boundaries only catch errors thrown during
 * render or in lifecycle methods — not in async callbacks, setTimeout,
 * or event handlers.
 */
export function useAsyncError() {
  const [, setError] = useState(0)
  return {
    catchError: (err: unknown) => {
      console.error("[AsyncError]", err)
      setError(() => { throw err })
    },
  }
}

/**
 * Hook that wraps async callbacks to catch errors and forward them to the
 * nearest error boundary. Use this instead of raw try/catch in event handlers
 * and useEffect when you want errors to show the ErrorBoundary UI.
 *
 * Usage:
 *   const safeAsync = useSafeAsync()
 *   useEffect(() => {
 *     safeAsync(async () => { ... })  // crashes show in ErrorBoundary, not silent
 *   }, [])
 */
export function useSafeAsync() {
  const { catchError } = useAsyncError()
  return (fn: () => Promise<void>) => {
    fn().catch(catchError)
  }
}

/**
 * Top-level diagnostics for errors that occur outside React render/lifecycle.
 *
 * Panel render crashes are isolated by the per-panel ErrorBoundary instances in
 * AppShell. Async event/fetch failures must not be deliberately re-thrown from
 * AppShell itself, because doing that bypasses panel isolation and turns one
 * rejected promise into the framework-level full-page error screen.
 */
export function useGlobalErrorHandler() {
  useEffect(() => {
    const report = (kind: "unhandledrejection" | "error", cause: unknown) => {
      console.error(`[Synnical ${kind}]`, cause)
      const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Unexpected client error"
      window.dispatchEvent(new CustomEvent("synnical-client-error", { detail: { kind, message } }))
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => report("unhandledrejection", event.reason)
    const onError = (event: ErrorEvent) => report("error", event.error || event.message)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("error", onError)
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
      window.removeEventListener("error", onError)
    }
  }, [])
}
