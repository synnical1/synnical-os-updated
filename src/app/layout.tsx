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
import { proxyAsset } from "@/lib/proxy-runtime"


export const metadata: Metadata = {
  title: "Synnical",
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
    title: "Synnical",
    description: "Your social desktop on the web.",
    siteName: "Synnical",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Synnical",
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
    <link rel="preload" href="/brand/wallpapers/thorfinn.webp" as="image" type="image/webp" />
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
          // Resolve Light/Dark before hydration. This touches only the
          // appearance marker; applyTheme commits the final palette atomically.
          dangerouslySetInnerHTML={{ __html: `try { const raw = localStorage.getItem('synnical:settings:appearance.mode'); const mode = raw ? JSON.parse(raw) : 'light'; const safe = mode === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.appearance = safe; document.documentElement.style.colorScheme = safe; document.documentElement.classList.toggle('dark', safe === 'dark'); } catch (_) { document.documentElement.dataset.appearance = 'light'; document.documentElement.style.colorScheme = 'light'; }` }}
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
