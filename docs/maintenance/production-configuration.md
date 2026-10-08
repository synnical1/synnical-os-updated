# One-time production configuration — approval required

This PR adds an operational tool; it does not configure production, merge itself, dispatch itself, change the deployed checkout, build the application, or modify its authentication. Do not run until the owner approves the workflow. Normal PR verification still runs without production secrets.

## Required setup

In GitHub Settings → Environments, create **production-maintenance**. Restrict deployment branches to **main**, configure required reviewers and prevent self-review where your plan supports it, and disable administrator bypass where supported. A YAML environment reference alone does not create required reviewers; an administrator must configure them. If your plan does not support reviewers, the owner's explicit approval and authorized manual dispatch are the approval gate. This connection cannot inspect or configure environment protection rules.

Configure these Actions secrets (prefer this environment's secrets):

| Secret | Purpose |
| --- | --- |
| `SYNNICAL_DEPLOY_SSH_KEY` | Reuse the existing deployment private key; the existing repository secret is sufficient. Never paste it into workflow inputs. |
| `SYNNICAL_DEPLOY_KNOWN_HOSTS` | Independently verified SSH `known_hosts` entry for `140.238.87.247`. Obtain through a trusted existing administrator connection/Oracle console and confirm fingerprint out of band. The workflow deliberately does not trust a fresh `ssh-keyscan` result. |
| `TMDB_API_READ_TOKEN` | The supplied replacement TMDB read-access token. Transmitted over SSH stdin and stored only in production `/var/www/synnical/.env` as the same name. |
| `MALQ_PROXY_URL` (optional) | A legitimate rotating **HTTPS** proxy URI, if available. Upstream recommends a rotating proxy, preferably Americas. TLS validation remains enabled. Absence does not block root/readiness probing, but mailbox-provider success and actual gameplay remain unverified. |

Do **not** create a `STRATUS_API_KEY` GitHub secret. Python `secrets.token_hex(32)` generates 256 bits of entropy directly on Oracle; its value stays in production `.env`. Existing `TMDB_API_KEY`/`TMDB_READ_TOKEN` lines remain untouched; the primary read token takes precedence.

After review/approval, merge the PR. Open Actions → **One-time production configuration** → Run workflow → select **main** → check `approve_production_changes`. This is the sole trigger. A required environment reviewer must then approve the pending job before secrets become accessible. Do not run from a feature branch. Minimum permission is `contents: read`; checkout credentials are not persisted.

## Exactly what is installed

- Source: https://github.com/VillainsRule/malq, revision `e3a85150b6113f555b1d3a2c2148f45b3d768460`.
- Bun official ARM64 release **1.3.11**, SHA-256 `d13944da12a53ecc74bf6a720bd1d04c4555c038dfe422365356a7be47691fdf`.
- Dependencies: committed npm lockfile; `npm ci --omit=dev --ignore-scripts`, with no lifecycle scripts or browser binary installation. The two Puppeteer dependencies are used only by upstream `vectors/` tools, not `src/`; they and development dependencies/scripts are removed from the production package. The reviewed upstream dependency set and absence of runtime Puppeteer imports are asserted before pruning. The resulting locked API dependency audit reports zero known advisories at preparation time.
- Source changes assert exact upstream matches: explicit `127.0.0.1:4400` binding; restore certificate/hostname verification for proxy and target TLS; wait for HTTPS proxy `secureConnect`; centrally force certificate validation in `fish()`, including the upstream provider that requests insecure TLS.
- Dedicated unprivileged **synnical-malq** system identity and hardened **synnical-malq.service**; immutable root-owned source under `/opt/synnical-malq/<revision>`. Systemd is used to isolate the dependency from Synnical's PM2 identity and private `.env`/database/uploads. No nginx, firewall, public port or unrelated service changes. Automatic restart is disabled so a failure does not produce a retry storm.
- Optional proxy configuration resides in root-only `/var/lib/synnical-maintenance/malq.env`, consumed by systemd. Upstream stdout/stderr are discarded because provider exceptions can include private proxy or mailbox data.

Review scope: startup/service interfaces, dynamic provider import path, shared network/TLS helpers, source-wide dangerous execution/TLS patterns, package declarations and locked dependency graph. This is not a claim of a complete audit of every provider or transitive package. Provider integrations contact third-party temporary-mail services and depend on their availability/policies. No upstream demo service is used. No Chromium/Xvfb or browser tooling is installed. Upstream `vectors/` tooling is outside this service scope.

## Safety and verification

The remote command needs existing Ubuntu passwordless **root sudo**, not only `sudo -u synnical`. It checks this before provisioning. It shares the normal deployment flock, rejects conflicting PM2 secret overrides, validates TMDB privately before mutation, and refuses unknown existing malq services/listeners/installations rather than replacing them.

It makes a root-only backup of `.env` at `/var/lib/synnical-maintenance/synnical.env.before`. No database/upload migrations or deletion occur. Only three owned `.env` keys are updated atomically: `TMDB_API_READ_TOKEN`, `STRATUS_API_KEY`, `STRATUS_MALQ_URL`. Unrelated lines remain verbatim. An attempt marker prevents automatic repeat provisioning/key rotation after either success or partial failure. Stop and inspect a failed attempt; do not blindly rerun, roll back or delete the marker.

malq must pass the existing HTML contract and an `ss` check confirming the sole listener is `127.0.0.1:4400` before Synnical's environment is changed. PM2 reload/save uses the existing Synnical identity without putting the private values into PM2's environment/dump.

Strict post-reload checks require: live Stratus key **PRESENT**, malq/readiness **ready**, TMDB credential **VALID**, both catalogue modes returning **DATA**, unauthenticated game creation **401**, PM2 **online**, unchanged checkout, and no literal new private values in `.next/static`. Output contains statuses only. No game, mailbox, test user or privileged session is created.

**Authenticated game creation getting beyond `GAME_CREATE_HTTP_503`, per-user ownership end-to-end, live catalogue UI rendering, and existing server-log leakage remain UNVERIFIED** until genuinely tested. Games readiness alone does not prove a successful cloud session. Existing security tests and runtime preflight remain unchanged.

## Remove after completion

After approved execution and separate live authenticated verification, remove this workflow and `scripts/maintenance/` through a follow-up PR. Delete temporary `TMDB_API_READ_TOKEN`, `MALQ_PROXY_URL` and `SYNNICAL_DEPLOY_KNOWN_HOSTS` Actions secrets if dedicated to this job. Keep the existing deployment SSH secret, production `.env`, installed malq service and private backup/attempt marker. Retain this runbook as evidence or remove it with the operational tooling. Removing the workflow does not uninstall the required service.
