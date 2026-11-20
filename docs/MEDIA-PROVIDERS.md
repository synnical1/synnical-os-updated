# Native media configuration

SynnFlix and Synnime use TMDB for catalogue metadata, search, title details, cast, seasons, episodes, recommendations and UK watch-provider availability. Synnime is restricted to animation with Japanese language or Japanese origin. The catalogue is native to Synnical and does not proxy third-party browsing sites.

Account/profile-scoped media profiles, lists, ratings and progress records remain stored. No database migration or user-data deletion is part of this change.

## TMDB metadata

Add `TMDB_READ_ACCESS_TOKEN` as a GitHub Actions repository secret under Settings → Secrets and variables → Actions. The main-branch deployment workflow transfers it over SSH and writes it into the private server-side `.env` with restrictive permissions before restarting Synnical. No manual Oracle `.env` edit is required. Use the TMDB API Read Access Token as a Bearer credential. Do not add it to a `NEXT_PUBLIC_` variable, source file, client bundle or committed `.env` file. The `/api/tmdb` route rate-limits catalogue requests by IP, rejects cross-origin requests when an Origin header is present, and normalises TMDB responses before returning them to the client. Search excludes adult results. Synnime requires the Animation genre and Japanese language or Japanese origin. UK provider availability is informational and links to TMDB's watch page; provider catalogues and subscription requirements can change. Synnical uses the TMDB API but is not endorsed or certified by TMDB.

## Authorised playback

CineSrc is the default playback provider. It creates the documented `https://cinesrc.st/embed/movie/{tmdb_id}` URL for films and `https://cinesrc.st/embed/tv/{tmdb_id}?s={season}&e={episode}` URL for TV. Only validated TMDB IDs and episode numbers are used to build these URLs. TV auto-next is disabled so the app's selected episode identity remains aligned with progress tracking.

An operator-managed manifest remains available as a per-title override. Configure:

- `MEDIA_PLAYBACK_MANIFEST`: path to a private manifest outside public/upload directories; keep it under 2 MB.
- `MEDIA_PLAYBACK_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins approved for manifest sources and subtitles.

Manifest sources and subtitles reject credentials in URL authority, non-HTTPS, IP literals, localhost, fragments and unapproved origins. Keep manifest files private and never accept their paths or URLs from browser requests.

The browser sends only media identity. It cannot choose a URL, origin, filesystem path or provider. CineSrc URLs are created from validated TMDB IDs on the server; manifest overrides are read from a private file and checked against exact allowed HTTPS origins. The server does not fetch playback URLs. Manifest sources and subtitles reject credentials in URL authority, non-HTTPS, IP literals, localhost, fragments and unapproved origins. Playback source responses require authentication and use private/no-store and no-referrer headers.

\`getMovieSource\` / \`getEpisodeSource\` can be implemented by another licensed provider without changing catalogue or list components. The manifest adapter is an integration boundary, not a DRM/entitlement service. Account/title entitlement checks, license expiry and DRM would belong in that adapter.

## Player and state

Native file and HLS sources use video controls; HLS is loaded on demand through hls.js, or natively on compatible browsers. Playback exposes seeking, volume, mute, fullscreen, subtitles, keyboard controls, resume, loading/buffering and errors. DASH is represented by the contract but currently depends on native browser support; no general DASH/DRM engine is installed. Alternate audio track metadata is reserved by the contract; no track switching UI is implemented.

The CineSrc iframe allows scripts, same-origin execution within its own origin, forms and presentation, plus autoplay/fullscreen/picture-in-picture permissions. Its documented `postMessage` events are accepted only when both `event.origin` matches the iframe origin and `event.source` is the exact iframe window. Time updates are validated and throttled before being passed to Synnical's progress callback; untrusted messages are ignored. The native catalogue saves progress into the account/profile-scoped media progress records.

Native time events are throttled to one per second. Persistence normally occurs every 15 seconds, with pause/seek/end/close/page lifecycle flushes. Progress is finite, bounded and server-owned by the authenticated account and selected profile. Continue Watching retains the furthest credible progress, treats 92% as completed, and provides explicit replay/reset. Previous/next/select controls work within a loaded season; end-of-season discovery and actual autoplay on browser transition require live playback validation.

## Operations

Run Node 22, \`npm ci\`, \`npm run release:gate\`, \`npm run check:proxy\`, and \`npm run test:smoke\` before rollout. Smoke tests use disposable schema/uploads and fixture origins only. Do not commit private playback manifests or credentials. No database schema change is required to keep the media profiles and user state.

Music bridge hosts returning streams outside their own origin or googlevideo.com must be explicitly approved using \`MUSIC_STREAM_ALLOWED_ORIGINS\`. Each redirect is revalidated. This can intentionally reject an existing operator bridge until its legitimate CDN is allowlisted.

## Cloud gaming authentication

The bundled Stratus site key was previously committed and shipped to the browser. Rotate that value. Configure a fresh \`STRATUS_API_KEY\` on the server only; an empty key disables cloud-session operations with HTTP 503 while preserving the public health/catalogue routes. Cloud HTTP/signaling requests require a current Synnical session and ban/origin checks. The custom server supplies the internal key and overrides the internal account identity; queue/start/ping/quit/embed-data/signaling are bound to the creating account. SVG clients obtain the existing short-lived signed proxy ticket for the embedded player. The cloud player derives its signaling address from its own origin rather than accepting a \`host\` URL parameter.
