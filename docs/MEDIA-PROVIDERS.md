# Native media configuration

SynnFlix and Synnime share the native catalogue and account/profile-scoped media state. Synnime selects the anime catalogue; it does not open a streaming website. TMDB metadata does not grant playback rights.

## Metadata

Set `TMDB_READ_TOKEN` (preferred) or `TMDB_API_KEY` in the server environment. `TMDB_API_READ_TOKEN` remains a compatibility alias. Do not use `NEXT_PUBLIC_*` variables for these credentials. Never commit the configured environment file.

`MediaMetadataProvider` exposes typed home, search, details and season operations. The TMDB adapter uses a five-minute, 256-entry process cache, coalesces equal requests, bounds concurrent upstream work to 32 requests, times out at 12 seconds, rejects redirects, and respects a bounded Retry-After cooldown. Browser request cancellation prevents stale catalogue/profile responses from replacing newer state. Shared upstream requests are intentionally not cancelled when one subscriber disconnects.

## Authorized playback

With no configured source, the player displays **Playback unavailable / Under Construction**. The former website providers return HTTP 410 and cannot perform upstream probes. No third-party streaming website supplies the application interface.

The default `MediaPlaybackProvider` reads an operator-managed private JSON manifest. Configure:

- `MEDIA_PLAYBACK_MANIFEST`: path to a private manifest outside public/upload directories; keep it under 2 MB.
- `MEDIA_PLAYBACK_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins approved by the operator.

Provision sources only when you have authorization to play them. A manifest shape (illustrative domains, no real source):

```json
{
  "movie:123": {
    "providerId": "licensed-catalogue",
    "kind": "file",
    "url": "https://media.example.org/title.mp4",
    "subtitles": [{ "url": "https://media.example.org/title.en.vtt", "language": "en", "label": "English" }]
  },
  "tv:456:1:2": {
    "providerId": "licensed-catalogue",
    "kind": "hls",
    "url": "https://media.example.org/episode.m3u8"
  }
}
```

The browser sends only media identity. It cannot choose a URL, origin, filesystem path or provider. The server checks the manifest and origin policy and never fetches the playback URL. Sources and subtitles reject credentials in URL authority, non-HTTPS, IP literals, localhost, fragments and unapproved origins. Source responses require authentication and use private/no-store and no-referrer headers. Signed source URLs, if required by a licensed provider, necessarily reach its player; keep authorization short-lived and scoped in a future provider adapter.

`getMovieSource` / `getEpisodeSource` can be implemented by another licensed provider without changing catalogue or list components. The manifest adapter is an integration boundary, not a DRM/entitlement service. Account/title entitlement checks, license expiry and DRM would belong in that adapter.

## Player and state

Native file and HLS sources use video controls; HLS is loaded on demand through hls.js, or natively on compatible browsers. Playback exposes seeking, volume, mute, fullscreen, subtitles, keyboard controls, resume, loading/buffering and errors. DASH is represented by the contract but currently depends on native browser support; no general DASH/DRM engine is installed. Alternate audio track metadata is reserved by the contract; no track switching UI is implemented.

An explicitly approved embed uses `allow-scripts allow-same-origin`, fullscreen/picture-in-picture, and no-referrer, with no popup/top-navigation permissions. There is no generic postMessage progress bridge. Embed progress/resume and watch-party control therefore require a future authenticated provider-specific integration; do not invent progress from untrusted messages.

Native time events are throttled to one per second. Persistence normally occurs every 15 seconds, with pause/seek/end/close/page lifecycle flushes. Progress is finite, bounded and server-owned by the authenticated account and selected profile. Continue Watching retains the furthest credible progress, treats 92% as completed, and provides explicit replay/reset. Previous/next/select controls work within a loaded season; end-of-season discovery and actual autoplay on browser transition require live playback validation.

## Operations

Run Node 22, `npm ci`, `npm run release:gate`, `npm run check:proxy`, and `npm run test:smoke` before rollout. Smoke tests use disposable schema/uploads and fixture origins only. Do not deploy a manifest or actual TMDB credentials through Git. No database schema change is required by this redesign.

Music bridge hosts returning streams outside their own origin or googlevideo.com must be explicitly approved using `MUSIC_STREAM_ALLOWED_ORIGINS`. Each redirect is revalidated. This can intentionally reject an existing operator bridge until its legitimate CDN is allowlisted.

Reference documentation: https://developer.themoviedb.org/docs/authentication-application ; https://developer.themoviedb.org/docs/append-to-response ; https://developer.themoviedb.org/docs/rate-limiting .

## Cloud gaming authentication

The bundled Stratus site key was previously committed and shipped to the browser. Rotate that value. Configure a fresh `STRATUS_API_KEY` on the server only; an empty key disables cloud-session operations with HTTP 503 while preserving the public health/catalogue routes. Cloud HTTP/signaling requests require a current Synnical session and ban/origin checks. The custom server supplies the internal key and overrides the internal account identity; queue/start/ping/quit/embed-data/signaling are bound to the creating account. SVG clients obtain the existing short-lived signed proxy ticket for the embedded player. The cloud player derives its signaling address from its own origin rather than accepting a `host` URL parameter.
