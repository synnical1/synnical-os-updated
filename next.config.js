/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  compress: true,
  experimental: {
    optimizePackageImports: ["lucide-react", "react-markdown", "remark-gfm"],
  },
  transpilePackages: ["@mercuryworkshop/scramjet-controller"],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "www.google.com" },
      { protocol: "https", hostname: "media.giphy.com" },
      { protocol: "https", hostname: "www.crazygames.com" },
      { protocol: "https", hostname: "img.crazygames.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "www.themoviedb.org" },
      { protocol: "https", hostname: "download-oss.raccoongame.com" },
    ],
  },
  async headers() {
    const appShellNoStore = [
      { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ]

    return [
      { source: "/", headers: appShellNoStore },
      { source: "/games/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/scramjet/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, immutable" }, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
      { source: "/controller/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, immutable" }, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
      { source: "/discord-assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, immutable" }, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Cross-Origin-Resource-Policy", value: "same-origin" }] },
    ]
  },
}

module.exports = nextConfig
