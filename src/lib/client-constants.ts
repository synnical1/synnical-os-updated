// Client-side constants for Synnical

// Quick links use bundled, recognisable brand marks. Keeping these local avoids
// a third-party favicon request on every new tab and means the dashboard still
// looks complete when a search provider is rate-limiting the server IP.
export type QuickLink = { name: string; url: string; thumbnail: string }

export const QUICK_LINKS: QuickLink[] = [
  { name: "Wikipedia", url: "https://en.wikipedia.org", thumbnail: "/brand/shortcuts/wikipedia.svg" },
  { name: "MDN", url: "https://developer.mozilla.org", thumbnail: "/brand/shortcuts/mdn.svg" },
  { name: "Hacker News", url: "https://news.ycombinator.com", thumbnail: "/brand/shortcuts/hacker-news.svg" },
  { name: "Lobsters", url: "https://lobste.rs", thumbnail: "/brand/shortcuts/lobsters.svg" },
  { name: "Archive.org", url: "https://archive.org", thumbnail: "/brand/shortcuts/archive.svg" },
  { name: "DuckDuckGo", url: "https://duckduckgo.com", thumbnail: "/brand/shortcuts/duckduckgo.svg" },
  { name: "Raccoon", url: "https://www.raccoongame.com/#/platform/cloudgame", thumbnail: "https://www.raccoongame.com/favicon.ico" },
]

// Search engines — lucide icons
import type { LucideIcon } from "lucide-react"
import { Search, BookOpen } from "lucide-react"

export type SearchEngine = { id: string; name: string; url: string; icon: LucideIcon }

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=", icon: Search },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=", icon: Search },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=", icon: Search },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=", icon: Search },
  { id: "startpage", name: "Startpage", url: "https://www.startpage.com/sp/search?query=", icon: Search },
  { id: "wikipedia", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=", icon: BookOpen },
]
