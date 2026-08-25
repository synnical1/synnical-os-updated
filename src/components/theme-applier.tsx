"use client"

import { useEffect } from "react"
import { useBrowser } from "@/hooks/use-browser"
import { applyTheme } from "@/lib/themes"

/**
 * Applies the currently selected theme AND accessibility settings to the
 * document root. Must be a client component because it reads from zustand
 * (localStorage-persisted) and mutates document.documentElement.style.
 */
export function ThemeApplier() {
  const theme = useBrowser(s => s.theme)

  // Apply theme
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Apply accessibility settings from localStorage
  useEffect(() => {
    const root = document.documentElement

    // Media query listener state for darkModeAuto (managed across applySettings calls)
    let mediaQuery: MediaQueryList | null = null
    let mediaHandler: (() => void) | null = null

    const applySettings = () => {
      // Reduce motion
      const reduceMotion = localStorage.getItem("synnical:a11y.reduceMotion") === "true"
      root.style.setProperty("--syn-motion", reduceMotion ? "0s" : "")
      if (reduceMotion) {
        root.classList.add("reduce-motion")
      } else {
        root.classList.remove("reduce-motion")
      }

      // Font scaling
      const fontScale = parseInt(localStorage.getItem("synnical:appearance.fontScale") || "100", 10)
      root.style.fontSize = `${fontScale}%`

      // Caption size
      const captionSize = parseInt(localStorage.getItem("synnical:a11y.captionSize") || "100", 10)
      root.style.setProperty("--caption-scale", `${captionSize / 100}`)

      // Dyslexic font
      const dyslexicFont = localStorage.getItem("synnical:a11y.dyslexicFont") === "true"
      if (dyslexicFont) {
        root.classList.add("dyslexic-font")
      } else {
        root.classList.remove("dyslexic-font")
      }

      // Reduce transparency
      const reduceTransparency = localStorage.getItem("synnical:appearance.reduceTransparency") === "true"
      if (reduceTransparency) {
        root.classList.add("no-transparency")
      } else {
        root.classList.remove("no-transparency")
      }

      // Custom profile color
      const profileColor = localStorage.getItem("synnical:profile.customColor")
      if (profileColor) {
        root.style.setProperty("--profile-accent", profileColor)
      } else {
        root.style.removeProperty("--profile-accent")
      }

      /* ───────────────────────────────────────────────────────────────
       * Theme settings (stored JSON-encoded under "synnical:settings:")
       * ─────────────────────────────────────────────────────────────── */
      const readThemeSetting = <T,>(key: string, fallback: T): T => {
        try {
          const raw = localStorage.getItem("synnical:settings:" + key)
          return raw === null ? fallback : (JSON.parse(raw) as T)
        } catch {
          return fallback
        }
      }

      // 1. Custom CSS — inject (or replace) a <style> tag in <head>
      const customCss = readThemeSetting<string>("theme.customCss", "")
      const existingStyle = document.getElementById("synnical-custom-css")
      if (existingStyle) existingStyle.remove()
      if (customCss) {
        const styleEl = document.createElement("style")
        styleEl.id = "synnical-custom-css"
        styleEl.textContent = customCss
        document.head.appendChild(styleEl)
      }

      // 2–5. Animation speed, blur, shadow, radius (percentage → scale factor)
      const animSpeed = readThemeSetting<number>("theme.animSpeed", 100)
      root.style.setProperty("--synnical-anim-speed", `${animSpeed / 100}`)

      const blurIntensity = readThemeSetting<number>("theme.blur", 100)
      root.style.setProperty("--synnical-blur-intensity", `${blurIntensity / 100}`)

      const shadowIntensity = readThemeSetting<number>("theme.shadow", 100)
      root.style.setProperty("--synnical-shadow-intensity", `${shadowIntensity / 100}`)

      const radiusScale = readThemeSetting<number>("theme.radius", 100)
      root.style.setProperty("--synnical-radius-scale", `${radiusScale / 100}`)

      // 6. Dark mode auto — follow system prefers-color-scheme
      const darkModeAuto = readThemeSetting<boolean>("theme.darkModeAuto", false)
      if (darkModeAuto) {
        if (!mediaQuery) {
          mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
          mediaHandler = () => {
            const currentTheme = useBrowser.getState().theme
            applyTheme(mediaQuery!.matches ? currentTheme : "monochrome")
          }
          mediaQuery.addEventListener("change", mediaHandler)
          mediaHandler() // apply immediately for the current scheme
        }
      } else if (mediaQuery && mediaHandler) {
        mediaQuery.removeEventListener("change", mediaHandler)
        mediaQuery = null
        mediaHandler = null
      }

      // 7. Wallpaper — set body background image
      const wallpaper = readThemeSetting<string>("theme.wallpaper", "")
      if (wallpaper) {
        document.body.style.backgroundImage = `url("${wallpaper}")`
      } else {
        document.body.style.backgroundImage = ""
      }

      // 8. Accent gradient — toggle class on root
      const accentGradient = readThemeSetting<boolean>("theme.accentGradient", false)
      if (accentGradient) {
        root.classList.add("accent-gradient")
      } else {
        root.classList.remove("accent-gradient")
      }
    }

    applySettings()

    // Re-apply when localStorage changes (e.g. from settings panel)
    window.addEventListener("storage", applySettings)
    return () => {
      window.removeEventListener("storage", applySettings)
      if (mediaQuery && mediaHandler) {
        mediaQuery.removeEventListener("change", mediaHandler)
      }
    }
  }, [])

  return null
}
