"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { SEARCH_ENGINES } from "@/lib/client-constants"
import type { ThemeId } from "@/lib/themes"
import { createClientId } from "@/lib/utils"

export type Bookmark = { id: string; title: string; url: string; createdAt: number }
export type HistoryEntry = { id: string; title: string; url: string; visitedAt: number }
export type Theme = ThemeId

type BrowserState = {
  searchEngineId: string
  homepage: string
  useProxy: boolean
  bookmarks: Bookmark[]
  history: HistoryEntry[]
  bookmarksBarCollapsed: boolean
  antiTabClose: boolean
  imageBlur: boolean
  theme: Theme
  setSearchEngine: (id: string) => void
  setHomepage: (url: string) => void
  setUseProxy: (v: boolean) => void
  setBookmarksBarCollapsed: (v: boolean) => void
  setAntiTabClose: (v: boolean) => void
  setImageBlur: (v: boolean) => void
  setTheme: (t: Theme) => void
  renameBookmark: (id: string, title: string) => void
  addBookmark: (b: Omit<Bookmark, "id" | "createdAt">) => void
  removeBookmark: (id: string) => void
  isBookmarked: (url: string) => boolean
  recordVisit: (url: string, title: string) => void
  clearHistory: () => void
  removeHistory: (id: string) => void
  replaceBookmarks: (items: Bookmark[]) => void
  replaceHistory: (items: HistoryEntry[]) => void
}

export const useBrowser = create<BrowserState>()(
  persist(
    (set, get) => ({
      searchEngineId: "duckduckgo",
      homepage: "",
      useProxy: true,
      bookmarks: [],
      history: [],
      bookmarksBarCollapsed: false,
      antiTabClose: false,
      imageBlur: false,
      theme: "blood",
      setSearchEngine: (id) => set({ searchEngineId: id }),
      setHomepage: (url) => set({ homepage: url }),
      setUseProxy: (v) => set({ useProxy: v }),
      setBookmarksBarCollapsed: (v) => set({ bookmarksBarCollapsed: v }),
      setAntiTabClose: (v) => set({ antiTabClose: v }),
      setImageBlur: (v) => set({ imageBlur: v }),
      setTheme: (t) => set({ theme: t }),
      renameBookmark: (id, title) =>
        set((s) => ({ bookmarks: s.bookmarks.map((b) => b.id === id ? { ...b, title } : b) })),
      addBookmark: (b) =>
        set((s) => {
          if (s.bookmarks.some((x) => x.url === b.url)) return s
          return { bookmarks: [...s.bookmarks, { ...b, id: createClientId(), createdAt: Date.now() }] }
        }),
      removeBookmark: (id) => set((s) => ({ bookmarks: s.bookmarks.filter((x) => x.id !== id) })),
      isBookmarked: (url) => get().bookmarks.some((x) => x.url === url),
      recordVisit: (url, title) =>
        set((s) => ({
          history: [{ id: createClientId(), url, title, visitedAt: Date.now() }, ...s.history.filter((h) => h.url !== url)].slice(0, 200),
        })),
      clearHistory: () => set({ history: [] }),
      removeHistory: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),
      replaceBookmarks: (items) => set({ bookmarks: items.slice(0, 1000) }),
      replaceHistory: (items) => set({ history: items.slice(0, 1000) }),
    }),
    { name: "stratus-browser" }
  )
)

export function searchEngine(id: string) {
  return SEARCH_ENGINES.find((s) => s.id === id) || SEARCH_ENGINES[0]
}
