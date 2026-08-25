import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Synnical OS",
    short_name: "Synnical",
    description: "Synnical OS desktop experience",
    start_url: "/",
    display: "fullscreen",
    background_color: "#000000",
    theme_color: "#111318",
    icons: [
      { src: "/logo.svg", sizes: "any", type: "image/svg+xml" },
    ],
  }
}
