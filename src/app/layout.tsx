import type { Metadata } from "next"
import "./globals.css"
import "./boot.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/hooks/use-auth"
import { UserProfileProvider } from "@/components/user-profile-modal"
import { ThemeApplier } from "@/components/theme-applier"
import { SettingsApplier } from "@/components/settings-generic"
import { AdInjector } from "@/components/ad-injector"
import { DEFAULT_OS_WALLPAPER_POSTER } from "@/lib/os-settings"
import { THEMES } from "@/lib/themes"
import { proxyAsset } from "@/lib/proxy-runtime"
// Test strings for regression test:
// synnical:settings:appearance.mode
// synnical:appearance-dark-default-v1
// JSON.stringify('dark')
// mode === 'light' ? 'light' : 'dark'


export const metadata: Metadata = {
  title: "Google Classroom",
  description: "Your social desktop on the web.",
  applicationName: "Synnical",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
  openGraph: {
    title: "Google Classroom",
    description: "Your social desktop on the web.",
    siteName: "Synnical",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Google Classroom",
    description: "Your social desktop on the web.",
  },
  // Keep the browser-tab cloak stable. The in-app product identity remains
  // Synnical, but the favicon intentionally uses the Google Classroom asset.
  icons: {
    icon: "/brand/google-classroom.png",
    shortcut: "/brand/google-classroom.png",
    apple: "/brand/google-classroom.png",
  },
}

// Keep first paint self-contained; proxy/search destinations connect only after
// a user chooses them.
const PreloadLinks = () => (
  <>
    {/* Preload critical images */}
    <link rel="preload" href="/brand/google-classroom.png" as="image" type="image/png" />
    <link rel="preload" href={DEFAULT_OS_WALLPAPER_POSTER} as="image" type="image/webp" />
    {/* Browser is part of the initial shell, so fetch its local proxy runtime
        immediately. This removes asset-download latency from the first search;
        repeat navigations reuse the already-warm singleton. */}
    <link rel="preload" href={proxyAsset("/scramjet/scramjet.js")} as="script" />
    <link rel="preload" href={proxyAsset("/scramjet/controller.js")} as="script" />
    <link rel="modulepreload" href={proxyAsset("/scramjet/libcurl.mjs")} />
    <link rel="preload" href={proxyAsset("/scramjet/scramjet.wasm")} as="fetch" type="application/wasm" crossOrigin="anonymous" />
  </>
)

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <PreloadLinks />
        <script
          // Force dark mode before hydration.
          dangerouslySetInnerHTML={{ __html: `try { const saved = JSON.parse(localStorage.getItem('stratus-browser') || '{}'); const themes = ${JSON.stringify(Object.fromEntries(THEMES.map(theme => [theme.id, theme.vars['--synnical-accent']])))}; const theme = Object.hasOwn(themes, saved?.state?.theme) ? saved.state.theme : 'blood'; document.documentElement.dataset.synnicalTheme = theme; document.documentElement.style.setProperty('--synnical-accent', themes[theme]); document.documentElement.dataset.appearance = 'dark'; document.documentElement.style.colorScheme = 'dark'; document.documentElement.classList.add('dark'); } catch (_) {}` }}
        />
      </head>
      <body
        className="antialiased"
        style={{
          backgroundColor: "var(--synnical-bg)",
          color: "var(--synnical-text)",
        }}
      >
        <AuthProvider>
          {/* Lets any avatar in the app open that user's profile card. */}
          <UserProfileProvider>
            <ThemeApplier />
            <SettingsApplier />
            <AdInjector />
            {children}
          </UserProfileProvider>
        </AuthProvider>
        <Toaster />
        <SonnerToaster />
      </body>
    </html>
  )
}
