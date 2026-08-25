import type { Metadata } from "next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/hooks/use-auth"
import { UserProfileProvider } from "@/components/user-profile-modal"
import { ThemeApplier } from "@/components/theme-applier"
import { SettingsApplier } from "@/components/settings-generic"
import { AdInjector } from "@/components/ad-injector"
import { proxyAsset } from "@/lib/proxy-runtime"


export const metadata: Metadata = {
  title: "Google Classroom",
  description: "Google Classroom",
  applicationName: "Google Classroom",
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
    description: "Google Classroom",
    siteName: "Google Classroom",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Google Classroom",
    description: "Google Classroom",
  },
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
