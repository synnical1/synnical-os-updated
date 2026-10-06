# Stratus upstream and Synnical adapter

The supplied `stratus-api-main(6).zip` identifies upstream commit
`8783524043ac214c0f6a64d4fa0ae94360200d7c` in its archive comment.
Archive SHA-256: `e54efe45726337703cdb76e35ab5013d60418412760d1fe4685a5543af5bac64`.
Repository: https://github.com/x8rr/stratus-api.

`stratus/core.cjs` adapts the supplied `api/core.cjs`. The same-process
`stratus/api.js` adapter is mounted by `server.ts` under `/api/games`.
The standalone upstream server/demo is deliberately not installed. The supplied
catalogue and embed image are identical to the previously bundled files;
the existing Stratus Public License remains in `LICENSE-STRATUS.txt`.

The core owns provider requests, account pooling, session state, signaling and
cleanup. The adapter owns routes, rate/usage controls and account ownership.
The custom server retains cookie, origin and restriction checks and replaces
client identity headers with the authenticated account. UUID possession never
authorizes HTTP, embed or WebSocket access.

Synnical preserves its known-good free-slot/provider-wait transition on the same
account. It does not rotate mailboxes after rejection, bypass paid quotas, retry
through a literal CDN address, or ignore Retry-After. Provider errors are sanitized.
Signaling has bounded payloads/backpressure and stale sessions are reaped.

## Operator configuration

- `STRATUS_API_KEY`: newly generated server-only key; missing configuration fails closed.
- `STRATUS_MALQ_URL`: loopback HTTP origin only, default `http://127.0.0.1:4400`.
  malq must be separately provisioned and policy compliant. It is not installed
  or contacted during builds. The old `GAME_MAIL_API_BASE` setting is unused.
- `STRATUS_ACCOUNT_POOL_TARGET`: default `0` (disabled); bounded by the configured
  concurrency limit. Enable only where the provider permits this usage.
- `STRATUS_DISABLE_ACCOUNT_POOL=true`: disables initial and subsequent refills.
- `STRATUS_MAX_CONCURRENT_SESSIONS`: default `8`; valid range `1..25`. The pinned
  Synnical site still caps its own sessions at eight. No silent capacity increase.
- `STRATUS_MAX_SESSION_SECONDS`: default `1140`; range `60..1200`. The pinned
  site retains its 1140-second ceiling.
- `RACCOON_BROWSER_MODEL` and `SYNNICAL_PROVIDER_WAIT_MAX_MS`: existing settings retained.

Health distinguishes a mounted service from provider readiness. A missing,
invalid or unavailable malq service returns a safe unavailable state. Tests use
fake services; real provider registration, allocation, audio and video are
unverified until tested with an authorized provider in its intended environment.
