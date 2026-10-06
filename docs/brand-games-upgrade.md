# Synnical branding, wallpaper, OLED and Stratus upgrade

## Release scope

Isolated branch: `feat/brand-wallpaper-stratus-20261006`.
Audited base: `b6776c7e6e7ec1a7945316000954006f801c851f`.
This upgrade is not merged or deployed. No production infrastructure, users,
uploads, database schema, PM2 configuration or deployment workflow is changed.
No npm dependencies or lockfiles changed. Node.js 22.23.2 was used locally.

## Supplied artwork and outputs

The latest repeated attachments are byte-identical to their earlier copies.
The PNG is present and visually inspected. Source SHA-256:
`01942dfd3e38dd478a834003d88c43f7a8d5ca23a9367e05c91dca997823124f`.
The archived source PNG is unchanged.

`SynnicalLogo` renders a transparent white neutral WebP layer above an accent
alpha mask colored with `--synnical-accent`. Minimum RGB extracts neutral light;
weighted residual luminance preserves blue/cyan intensity differences in the
mask. It preserves the supplied geometry, white S and wordmark. It does not
hue-rotate the whole image or generate a replacement. Crops: full `(350,245)`
to `(1065,915)`; globe `(440,255)` to `(975,755)`. Full crop is 715×670,
compact derivatives are 192×179 and 64×60. A padded 192×192 static icon is
used only for the installed-app manifest. Browser tab Google Classroom icons
and `src/app/icon.png` are unchanged.

Boot, authentication, Start and powered-off branding share this component.
Accent bootstrap reads the existing theme choice before hydration using values
serialized from the canonical theme definitions; CSS updates logo color live.

| Asset | Bytes |
|---|---:|
| `public/brand/synnical/synnical-logo-accent-mask.png` | 107,615 |
| `public/brand/synnical/synnical-logo-base.webp` | 35,538 |
| `public/brand/synnical/synnical-logo-source.png` | 585,195 |
| `public/brand/synnical/synnical-mark-accent-mask.png` | 18,903 |
| `public/brand/synnical/synnical-mark-base.webp` | 2,238 |
| `public/brand/synnical/synnical-mark-small-accent-mask.png` | 3,247 |
| `public/brand/synnical/synnical-mark-small-base.webp` | 286 |
| `public/brand/synnical/synnical-mark.png` | 41,677 |
| `public/brand/wallpapers/synnical-default-wallpaper.webm` | 11,707,043 |
| `public/brand/wallpapers/synnical-default-wallpaper-poster.webp` | 658,242 |

## Wallpaper and migration

Supplied source SHA-256:
`4a8e54b928a3ae4826e1bd9b40c83f7d53d89def7be05810c16f30c202997623`.
It is VP9, 3840×2160, 30 fps, 15.533 seconds and 31,149,305 bytes.
Runtime is VP9 1920×1080, 30 fps, 14.300 seconds; no upscale.
The black/fading tail is trimmed and 0.6 seconds of original frames crossfade
into the beginning. Poster matches source time 0.6 seconds. The 1440p candidate
was about 27 MiB and rejected. Final 1080p runtime is about 11.2 MiB;
SSIM against the downscaled source over unchanged frames is 0.972349.
`prepare-wallpaper-assets.sh` records the CRF 35 encoding recipe. The runtime
was reduced from 12,693,562 bytes so its base64 upload fits the GitHub connector
request limit; resolution, duration, source framing and loop timing are unchanged. The original large
video and rejected candidates are not committed.

`WallpaperVideo` uses one stable video per mounted surface. Muted, playsInline,
loop and metadata preload are explicit. Reduced motion uses the built-in poster;
hidden tabs, app motion settings, battery saver and performance mode pause the
video. Visibility/class observers are cleaned up; old two-second polling is
removed. Error fallback, existing dim/blur/saturation and fit controls remain.
Custom videos have no generated poster; reduced motion leaves their video paused.
Video tile fitting retains the prior cover behavior; static poster/image tile
fitting repeats normally.

Wallpaper default version 1 replaces only exact historically shipped defaults
on the desktop/lock settings. Custom uploads, HTTPS URLs, retained built-ins,
workspace choices and empty workspace inheritance survive. Local migration is
persisted once; account migration is persisted through the existing authenticated
settings API. A versioned choice of a historical URL is preserved. An unversioned
explicit choice identical to an old shipping default cannot be distinguished
from that default and will migrate once. No database migration is required.

Boot paints the poster immediately, then video, with the transparent supplied
logo above it. Existing navigation-only startup behavior is preserved.

## OLED and profile behavior

Every dark accent theme resolves background, surface, secondary surface and
page to `#000000`; accents, borders, semantic colors and light palettes remain.
Legacy opaque neutral background classes resolve to the semantic surface in
dark mode. Glass keeps intentional alpha while its base tint becomes black.
Default neutral profile cards also receive a dark-only black base; custom
profile gradients, imagery and effects retain their product behavior.
The existing UI policy that forces dark appearance is unchanged. Light palette
resolution is tested programmatically; Light UI visual operation is unverified.

## Stratus architecture and security

Previously `api.js` contained both transport and the provider/session engine.
Now the supplied `api/core.cjs` is adapted into `stratus/core.cjs`; the smaller
same-process adapter delegates provider/session lifecycle to it. No standalone
upstream server or demo UI is installed. Supplied catalogue, embed image and
license are byte-identical to existing files; known-good Synnical embed input,
audio, fullscreen and relative same-origin requests are retained. See
`stratus/UPSTREAM.md` for provenance and configuration.

The following boundaries remain enforced:

- Custom server cookie/session, restriction/ban and origin validation for HTTP
  and WebSocket routes; client identity headers are replaced by server identity.
- Server-only `STRATUS_API_KEY`; no configured key fails closed. No historical
  authorization value is in the current source tree or diff.
- Owner account checks for queue/start/ping/quit, embed/data and signaling,
  including another authenticated account possessing a valid UUID.
- Pinned site cap remains eight sessions and 1140 seconds. Operator limits are
  explicit, bounded and cannot raise that site cap. Pool defaults to zero;
  disable-account-pool suppresses subsequent refills as well as startup.
- Loopback-only malq configuration; invalid/missing service yields a clean error.
  Failed dependency requests are suppressed temporarily to avoid retry storms.
- One mailbox/registration attempt, bounded creation/verification budgets,
  Retry-After/cooldown before further work, and exhausted paid quota fails closed.
- Existing same-account free-slot/provider-wait flow retained; no provider
  rotation or paid-queue bypass. Normal hostname TLS checks remain enabled.
- WebSocket payload and backpressure limits, stale-session cleanup and UUID
  termination. Null/array JSON signaling cannot crash the server.
- Embed postMessage validates parent source and same origin, and sends only to
  the same origin. No arbitrary client URL becomes a provider endpoint.

Provider-issued signaling URLs require WSS and reject obvious loopback and URL
credentials. This is not a complete DNS/private-range SSRF allowlist; endpoints
are provider-issued, not arbitrary client URLs. Further allowlisting would
require an authorized provider's documented production signaling origins.

No real provider calls were made for tests. malq is not provisioned here.
Live provider registration, allocation, video/audio, quota policy and production
malq configuration remain UNVERIFIED. No unauthorized media provider was added.

## Tests and verification

Baseline: clean npm install; schema validation, typecheck, lint, 347 tests and
production build passed; original smoke passed all 32 groups.
New tests: four branding/wallpaper/theme cases, five deterministic Stratus cases.
Coverage includes all accent palettes, default migration/idempotence/custom and
workspace preservation, layered neutral/mask pixels, shared branding/favicon,
missing malq, cooldown before mailbox work, opt-in pool recovery after Retry-After,
limits, stale states, exhausted quota, foreign-account HTTP/embed/WS access,
backpressure, malformed signaling and expired UUID reuse.

Existing source-contract tests now inspect the new core/component locations and
new intentional wallpaper default. Existing behavioral queue assertions remain;
the free-machines-busy wording regression found by the full suite was fixed in
code rather than weakening its assertion. Smoke preserves all 32 original groups
and adds settings migration/ownership and unconfigured cloud dependency checks.
The original concurrent media-feature smoke assertion is unchanged.

| Check | Final result |
|---|---|
| Clean `npm ci` | PASS, 965 packages |
| `npm ls --depth=0` | PASS, no missing/invalid dependencies |
| Prisma schema validation | PASS |
| Typecheck | PASS |
| ESLint | PASS |
| Complete automated tests | PASS, 356 passed / 0 failed / 0 skipped |
| Next.js production build | PASS, 52 pages |
| Proxy runtime assets | PASS, seven verified assets |
| Production smoke | PASS, 34 groups |
| Single-core production smoke | PASS, 34 groups (repeated for final tree) |
| `git diff --check` | PASS |

The
available cloud browser rejected the isolated local URL with
`net::ERR_BLOCKED_BY_CLIENT`; visual checks are UNVERIFIED. The preliminary local
browser fixture also failed database creation before startup; smoke separately
verified successful startup using its proper disposable-file initialization.
No browser results are inferred from source inspection or mocked provider tests.

Security scan: zero tracked secret environment files, zero private-key files,
zero recognized live token patterns, and zero occurrences of the historically
exposed authorization value in the current tree. This targeted scan is not proof
that every possible secret format is absent. No secret values are logged.

## Deployment prerequisites and remaining verification

Review this branch before approving any merge/deployment. Configure a newly
rotated, server-only Stratus key and a legitimate loopback malq dependency where
live Games are required; retain pool target zero unless explicitly approved and
permitted. Verify provider policy, concurrency and session limits. Actual
production environment/key rotation is not inspected in this feature task.
TMDB credentials and authorized playback configuration are not changed; missing
metadata/playback continues to show the existing unavailable states.

Required visual checks: initial boot/poster/loop seam, reload/navigation timing,
Blood/Ocean/Forest/additional theme logo colors, small Start readability,
authentication/power branding, desktop/lock custom fitting, reduced motion,
hidden-tab and battery behavior, responsive layouts, OLED/profile cards,
and live Games fullscreen/input release/audio. Production PM2/runtime and ARM64
performance require an approved deployment environment. Temporary SSH key removal
from the preceding deployment task remains unverified; this feature task does
not change authorized_keys or other production configuration.

## Exact files changed

- `.env.example`
- `docs/brand-games-upgrade.md`
- `public/brand/synnical/synnical-logo-accent-mask.png`
- `public/brand/synnical/synnical-logo-base.webp`
- `public/brand/synnical/synnical-logo-source.png`
- `public/brand/synnical/synnical-mark-accent-mask.png`
- `public/brand/synnical/synnical-mark-base.webp`
- `public/brand/synnical/synnical-mark-small-accent-mask.png`
- `public/brand/synnical/synnical-mark-small-base.webp`
- `public/brand/synnical/synnical-mark.png`
- `public/brand/wallpapers/synnical-default-wallpaper-poster.webp`
- `public/brand/wallpapers/synnical-default-wallpaper.webm`
- `scripts/prepare-logo-assets.py`
- `scripts/prepare-wallpaper-assets.sh`
- `scripts/smoke-recovery.mjs`
- `src/app/api/features/os/route.ts`
- `src/app/boot.css`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/manifest.ts`
- `src/app/page.tsx`
- `src/components/animated-brand-mark.tsx`
- `src/components/desktop-shell.tsx`
- `src/components/profile-card-preview.tsx`
- `src/components/synnical-logo.tsx`
- `src/components/wallpaper-video.tsx`
- `src/lib/os-settings.ts`
- `src/lib/themes.ts`
- `stratus/UPSTREAM.md`
- `stratus/api.js`
- `stratus/core.cjs`
- `stratus/public/e.html`
- `tests/brand-wallpaper-20261006.test.ts`
- `tests/cloud-free-flow.test.cjs`
- `tests/regressions-20260817.test.mjs`
- `tests/regressions-20260818-r11-6.test.mjs`
- `tests/regressions-20260818-r12-final.test.mjs`
- `tests/regressions-20260821-experience-batch.test.mjs`
- `tests/stratus-core-20261006.test.cjs`
- `tests/upgrade-20260917.test.ts`
