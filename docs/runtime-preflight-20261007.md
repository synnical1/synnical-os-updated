# Wallpaper playback and runtime readiness

The default WebM plays independently of automatic performance scaling and low-battery hints.
Explicit accessibility Reduce Motion selects the poster. Hidden tabs and the user's Battery
saver toggle pause playback; clearing those settings resumes it. Custom wallpapers retain
the same controls. CI's production smoke suite launches its installed Chrome and asserts
actual `currentTime` advancement under normal, automatic-performance and low-battery classes.
The browser test fails if Chrome is absent; it is enabled explicitly in CI. Local invocation:

```sh
SYNNICAL_WALLPAPER_BROWSER_TEST=true npm run test:smoke
```

`SYNNICAL_BROWSER_EXECUTABLE` optionally selects an installed local Chrome/Chromium executable.
No browser dependency is added to the production application.

## Deployment reports

After dependency installation and before build/reload, deployment runs
`node scripts/runtime-preflight.mjs`. After PM2 reload, it runs the same script with
`--runtime`, alongside the existing exact-commit/PM2-online checks.

- Stratus key: `PRESENT` or `MISSING`, never its value. Presence does not prove rotation.
- malq: `ready`, `unavailable`, `invalid`, or `unexpected_service`. A bounded, cached,
  loopback-only root request identifies malq's HTML; it never creates an inbox/account/game
  or follows redirects. This proves service reachability/identity, not mailbox delivery.
- Games readiness: `ready` only when a server key and identified malq are present and the
  provider is not cooling down. Live gameplay remains `UNVERIFIED`.
- TMDB credential: `VALID`, `REJECTED`, `MISSING`, or `UNVERIFIED`. A bounded server-side
  `/configuration` request checks authentication when a usable credential exists. Network
  errors and rate limiting remain unverified; response bodies and raw errors are not logged.
- After reload, both SynnFlix and anime catalogue endpoints must actually return populated
  arrays to be reported as `DATA`. Missing credentials are explicitly `UNAVAILABLE`.

Application liveness/route-contract failures still fail deployment. Optional Games/TMDB
configuration failures produce explicit warnings and degraded feature reports, allowing
unrelated application/security updates while credentials are deferred. A successful app
deployment is not a claim that Games, TMDB, mailbox delivery or playback is functioning.
The public Stratus health route preserves liveness `status: ok` and separately exposes
`readiness` and safe provider booleans/states. It never exposes keys, mailbox tokens or URLs.

This patch does not change production `.env`, install malq, rotate keys, configure a proxy,
add playback providers, or change per-user HTTP/embed/WebSocket ownership enforcement.
