# Native media configuration

SynnFlix and Synnime use TMDB for catalogue metadata, search, title details, cast, seasons, episodes, recommendations and UK watch-provider availability. Synnime is restricted to animation with Japanese language or Japanese origin. The catalogue is native to Synnical and does not proxy third-party browsing sites.

Account/profile-scoped media profiles, lists, ratings and progress records remain stored. No database migration or user-data deletion is part of this change.

## TMDB metadata

Set `TMDB_READ_ACCESS_TOKEN` in the private server environment. Use the TMDB API Read Access Token as a Bearer credential. Do not add it to a `NEXT_PUBLIC_` variable, source file, client bundle or committed `.env` file. The `/api/tmdb` route rate-limits catalogue requests by IP, rejects cross-origin requests when an Origin header is present, and normalises TMDB responses before returning them to the client. Search excludes adult results. Synnime requires the Animation genre and Japanese language or Japanese origin. UK provider availability is informational and links to TMDB's watch page; provider catalogues and subscription requirements can change. Synnical uses the TMDB API but is not endorsed or certified by TMDB.

## Authorised playback

With no configured source, playback remains unavailable. The default \`MediaPlaybackProvider\` reads an operator-managed private JSON manifest. Configure:

- \`MEDIA_PLAYBACK_MANIFEST\`: path to a private manifest outside public/upload directories; keep it under 2 MB.
- \`MEDIA_PLAYBACK_ALLOWED_ORIGINS\`: comma-separated exact HTTPS origins approved by the operator.

Provision sources only when you have authorization to play them. A manifest shape (illustrative domains, no real source):

\`\`\`json
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
\`\`\`

The browser sends only media identity. It cannot choose a URL, origin, filesystem path or provider. The server checks the manifest and origin policy and never fetches the playback URL. Sources and subtitles reject credentials in URL authority, non-HTTPS, IP literals, localhost, fragments and unapproved origins. Source responses require authentication and use private/no-store and no-referrer headers. Signed source URLs, if required by a licensed provider, necessarily reach its player; keep authorization short-lived and scoped in a future provider adapter.

\`getMovieSource\` / \`getEpisodeSource\` can be implemented by another licensed provider without changing catalogue or list components. The manifest adapter is an integration boundary, not a DRM/entitlement service. Account/title entitlement checks, license expiry and DRM would belong in that adapter.

## Player and state

Native file and HLS sources use video controls; HLS is loaded on demand through hls.js, or natively on compatible browsers. Playback exposes seeking, volume, mute, fullscreen, subtitles, keyboard controls, resume, loading/buffering and errors. DASH is represented by the contract but currently depends on native browser support; no general DASH/DRM engine is installed. Alternate audio track metadata is reserved by the contract; no track switching UI is implemented.

An explicitly approved embed uses \`allow-scripts allow-same-origin\`, fullscreen/picture-in-picture, and no-referrer, with no popup/top-navigation permissions. There is no generic postMessage progress bridge. Embed progress/resume and watch-party control therefore require a future authenticated provider-specific integration; do not invent progress from untrusted messages.

Native time events are throttled to one per second. Persistence normally occurs every 15 seconds, with pause/seek/end/close/page lifecycle flushes. Progress is finite, bounded and server-owned by the authenticated account and selected profile. Continue Watching retains the furthest credible progress, treats 92% as completed, and provides explicit replay/reset. Previous/next/select controls work within a loaded season; end-of-season discovery and actual autoplay on browser transition require live playback validation.

## Operations

Run Node 22, \`npm ci\`, \`npm run release:gate\`, \`npm run check:proxy\`, and \`npm run test:smoke\` before rollout. Smoke tests use disposable schema/uploads and fixture origins only. Do not commit private playback manifests or credentials. No database schema change is required to keep the media profiles and user state.

Music bridge hosts returning streams outside their own origin or googlevideo.com must be explicitly approved using \`MUSIC_STREAM_ALLOWED_ORIGINS\`. Each redirect is revalidated. This can intentionally reject an existing operator bridge until its legitimate CDN is allowlisted.

## Cloud gaming authentication

The bundled Stratus site key was previously committed and shipped to the browser. Rotate that value. Configure a fresh \`STRATUS_API_KEY\` on the server only; an empty key disables cloud-session operations with HTTP 503 while preserving the public health/catalogue routes. Cloud HTTP/signaling requests require a current Synnical session and ban/origin checks. The custom server supplies the internal key and overrides the internal account identity; queue/start/ping/quit/embed-data/signaling are bound to the creating account. SVG clients obtain the existing short-lived signed proxy ticket for the embedded player. The cloud player derives its signaling address from its own origin rather than accepting a \`host\` URL parameter.
