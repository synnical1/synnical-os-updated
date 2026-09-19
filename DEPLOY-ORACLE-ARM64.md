# Deploy Synnical to Oracle ARM64 — 2026-09-15

These are future deployment instructions. No VPS was deployed during recovery. Use Ubuntu 24.04 **ARM64**, Node.js 22, npm, SQLite, Prisma, one PM2 process and Nginx. Read `RECOVERY-REPORT.md` and `VALIDATION-REPORT.md` first: the 295-test suite, release gate, production build and local smoke checks pass. Live external providers and actual ARM64 deployment still need verification.

## 1. Provision the host and network

Create an Oracle Ampere A1 instance with Ubuntu 24.04 ARM64, an SSH key, a public IP and a boot volume with room for dependencies, builds, uploads and backups. A practical starting allocation is 2–4 ARM cores, 8 GB RAM and 50 GB disk; adjust for real usage. Confirm `uname -m` prints `aarch64` and `/etc/os-release` identifies Ubuntu 24.04.

In the Oracle subnet security list or instance NSG, allow TCP 80/443 from the intended audience and SSH 22 only from your administration IP. Keep TCP 3000 private. Configure the host firewall consistently; Oracle networking rules do not replace the host firewall. Preserve existing SSH access and Oracle image firewall rules. Do not blindly flush iptables. See [Oracle security lists](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm).

Point a domain's A record to the public IP. Add an AAAA record only if IPv6 actually works. HTTPS is necessary for secure login cookies and Scramjet service workers. Bare public-IP HTTP is not a complete production setup.

As the Ubuntu administrator:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl xz-utils unzip git build-essential python3 pkg-config openssl libssl-dev sqlite3 nginx certbot python3-certbot-nginx logrotate
sudo adduser --disabled-password --gecos '' synnical
sudo install -d -o synnical -g synnical -m 0750 /var/www/synnical /var/lib/synnical /var/lib/synnical/database /var/lib/synnical/uploads /var/lib/synnical/media-approvals /var/lib/synnical/games /var/log/synnical
sudo install -d -o root -g root -m 0700 /var/backups/synnical
```

Use an unprivileged `synnical` account for npm, builds and PM2. Do not run the app as root.

## 2. Install Node.js 22 for ARM64

The recovery was checked with Node 22.23.2. Obtain the official ARM64 binary and verify its checksum. The [official Node archive](https://nodejs.org/en/download/archive/v22.23.2) also links signed checksum verification instructions.

```bash
mkdir -p ~/synnical-node-install
cd ~/synnical-node-install
curl -fSLO https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-arm64.tar.xz
curl -fSLO https://nodejs.org/dist/v22.23.2/SHASUMS256.txt
grep ' node-v22.23.2-linux-arm64.tar.xz$' SHASUMS256.txt | sha256sum -c -
sudo tar -xJf node-v22.23.2-linux-arm64.tar.xz -C /opt
sudo ln -s /opt/node-v22.23.2-linux-arm64/bin/node /usr/local/bin/node
sudo ln -s /opt/node-v22.23.2-linux-arm64/bin/npm /usr/local/bin/npm
sudo ln -s /opt/node-v22.23.2-linux-arm64/bin/npx /usr/local/bin/npx
node -v
npm -v
node -p 'process.arch'
sudo npm install -g pm2@6
sudo ln -s /opt/node-v22.23.2-linux-arm64/bin/pm2 /usr/local/bin/pm2
```

These symlink commands assume a fresh machine; investigate an existing installation instead of replacing it blindly. The last architecture command must print `arm64`. Use a supported security-patched Node 22 release if this guide is used later, then repeat validation.

## 3. Verify and extract the recovered source

Copy `SYNNICAL-RECOVERED-LATEST-20260915.zip` and its `.sha256` file to your administration account using SFTP or SCP. Do not download or copy old `node_modules`, `.next`, databases or uploads. This archive has one `synnical/` top-level directory.

```bash
cd ~/recovery-upload
sha256sum -c SYNNICAL-RECOVERED-LATEST-20260915.zip.sha256
unzip SYNNICAL-RECOVERED-LATEST-20260915.zip -d extracted
sudo cp -a extracted/synnical/. /var/www/synnical/
sudo chown -R synnical:synnical /var/www/synnical
sudo -iu synnical
cd /var/www/synnical
```

All commands until the Nginx section run as `synnical`. For an existing installation, use the backup/upgrade section below; do not overlay source on a running release.

The older `install-full.sh`, `install-main-batch1.sh`, `DEPLOY-FULL.md` and August release manifests describe the old VPS and are retained only as history. **Do not use them to deploy this recovery.** In particular, the August manifest is stale and an old installer can reuse dependencies from a different architecture.

## 4. Configure the environment

```bash
cd /var/www/synnical
cp .env.example .env
chmod 600 .env
nano .env
```

Set these required values:

```dotenv
DATABASE_URL=file:/var/lib/synnical/database/synnical.db
OWNER_PASSWORD=replace-with-one-new-random-secret
IDENTITY_HASH_SECRET=replace-with-a-different-new-random-secret
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000
UPLOAD_DIR=/var/lib/synnical/uploads
MEDIA_APPROVALS_DIR=/var/lib/synnical/media-approvals
GAMES_DIR=/var/lib/synnical/games
NEXT_PUBLIC_SOCKET_URL=/socket.io
```

Generate each secret separately with `openssl rand -hex 32` and store it privately. The owner password grants the OWNER role through the existing account settings owner-verification flow. New registrations remain ordinary members; there are no pre-created accounts, old messages, balances or watch history. Keep `IDENTITY_HASH_SECRET` stable across restarts so identity-ban records remain usable.

Review every category in `.env.example`:

- SynnFlix/Synnime catalogues need `TMDB_API_READ_TOKEN` or `TMDB_API_KEY`. External playback availability depends on the provider.
- AI needs an appropriate OpenRouter, Groq or Gemini key/model. Moderation/transcription use OpenAI settings separately. Blank optional credentials do not prevent server startup. Hybrid text moderation can fall back locally; strict mode needs its provider.
- Music supports the existing providers. Audius credentials and Piped/Invidious/Cobalt endpoints are optional and must be verified with their operators.
- Leave `NEXT_PUBLIC_SYNN_VM_URL` empty until an actual VM is available. The `/linux-vm` page then displays its existing configuration message. Configure an HTTPS URL that allows embedding from your Synnical origin. The route does not create or secure a VM by itself.
- Built-in Wisp is enabled by default, requires a signed-in session, allows web ports 80/443, and blocks private/loopback destinations and UDP. Use default `/wisp` paths with the bundled client. A separate `NEXT_PUBLIC_WISP_URL` points at an independently managed Wisp server whose security is your responsibility.
- Netherlands egress needs a real `SYNNICAL_NL_SOCKS5_URL`. It is server-only; do not expose its credentials in public variables.
- Local browser games live in `GAMES_DIR` outside the source checkout. The in-app catalogue includes Synnical's built-in local titles immediately. For third-party mirrors, `npm run games:import -- --dry-run` shows the explicit licence allowlist and `npm run games:import` imports only entries listed in `config/local-games-approved.json`. Do not bulk-copy mirror repositories merely because the files are publicly accessible; each redistributed game needs a verified licence/permission and its required notices.
- Stratus disables itself gracefully when its private sites file is absent. To enable it, copy `stratus/sites.json.example` to `stratus/sites.json`, configure a public site identifier, enabled state and quotas, and set matching `NEXT_PUBLIC_STRATUS_API_KEY`. Check the example's actual fields. Its API key is a browser-visible site identifier, not a provider credential. Protect the file with mode 600. Provider account/mail verification still depends on third-party services.
- A TURN service may be needed for calls across restrictive networks. Any `NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON` TURN credentials are browser-visible: use an appropriate limited credential policy.

`NEXT_PUBLIC_*` values are embedded at **build time**. Rebuild after changing them; a PM2 restart alone is insufficient. `server.ts` reads `.env` through dotenv before validation. Do not commit this file or put live `stratus/sites.json` in a source archive. This guide uses SQLite; the old optional Turso code has missing adapter dependencies and is not a supported recovery target.

## 5. Install, initialize and validate

```bash
cd /var/www/synnical
npm ci --include=dev --include=optional
npm run check:env
npm run check:proxy
npx prisma validate
npm run db:init
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:smoke
```

Run each validation command and inspect its exit status. `npm test` and `npm run release:gate` passed during recovery and must pass again on ARM64. Do not disable failing tests or treat a build pass as proof that external providers are configured. `test:smoke` must pass before launch. It starts a **separate** production server on a temporary port with a disposable database, generated test credentials and uploads, then removes its data. It does not seed your production database or contact paid AI services.

Optional headless UI checks can run using a separate Playwright installation, without adding browser tooling to the application lockfile. Install Chromium and its Ubuntu dependencies according to [Playwright browser setup](https://playwright.dev/docs/browsers). Run dependency installation with the privileges Playwright requests, then run browser checks as `synnical`:

```bash
npm install --prefix /home/synnical/browser-check --no-audit --no-fund playwright
/home/synnical/browser-check/node_modules/.bin/playwright install chromium
cd /var/www/synnical
node scripts/smoke-recovery.mjs --browser-module=/home/synnical/browser-check/node_modules/playwright/index.mjs
```

Without `--browser-module`, the runner executes the 17 API/server groups. With a working Chromium installation it also executes four UI groups (21 total). The browser harness blocks off-origin requests; real external provider checks remain necessary.

`db:init` creates the parent directory and an empty SQLite file only if missing, then runs **`prisma db push` without `--accept-data-loss`** and generates the client. This avoids the opaque missing-file error observed with Prisma 6 in the recovery environment. The repository has no authoritative migration history; `prisma migrate deploy` alone will not create this schema. A newly initialized database contains zero accounts/messages. On later schema changes, back up first, review warnings and stop if Prisma asks for destructive changes. Never use `db:reset` against production.

SQLite must live on a persistent local disk, with its containing directory writable for journals/WAL files. Keep the database and uploads outside `/var/www/synnical`. Missing historical files/accounts cannot be recovered by schema creation.

Native installation notes: keep optional dependencies enabled. Sharp/libvips, Next SWC, esbuild, Tailwind Oxide, Lightning CSS, resolver/watcher bindings and Prisma select the local architecture. `binaryTargets` includes `native`; generate on the ARM host. Ubuntu 24.04's glibc/OpenSSL platform is suitable for the published ARM64 packages. Never copy the recovery machine's x86 installation. If a native module cannot load, check `node -p process.arch`, reinstall using `npm ci`, and inspect the named package/error. Do not delete the lockfile or omit optional packages. [Sharp installation requirements](https://sharp.pixelplumbing.com/install/).

## 6. Start one PM2 process

```bash
cd /var/www/synnical
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs synnical --lines 60 --nostream
curl -fsS http://127.0.0.1:3000/api
pm2 save
pm2 startup systemd -u synnical --hp /home/synnical
```

Run the exact privileged startup command PM2 prints from the administrator account. It must reference the installed Node 22/PM2 path. Then verify `systemctl status pm2-synnical`. Run `pm2 save` again after changing the saved process list. PM2's [startup instructions](https://pm2.keymetrics.io/docs/usage/startup/) explain why its startup entry should be regenerated after a Node upgrade.

The ecosystem file sets `/var/www/synnical`, loopback binding, one forked custom-server process, a 2 GB restart threshold and `/var/log/synnical/{out,error}.log`. It deliberately does not use cluster mode: Socket.IO/presence, Wisp and Stratus keep process-local state. `next start` bypasses those services; use the custom server. If the host cannot support the configured memory threshold, adjust it after measuring normal usage.

## 7. Configure Nginx and TLS

Return to the administrator account. Substitute your actual domain in the new example:

```bash
sudo cp /var/www/synnical/deploy/nginx-http.conf.example /etc/nginx/sites-available/synnical
sudo nano /etc/nginx/sites-available/synnical
sudo ln -s /etc/nginx/sites-available/synnical /etc/nginx/sites-enabled/synnical
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-actual-domain.example --redirect
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Resolve any default-site/domain conflicts before reloading. Certbot needs working DNS and public port 80. The example passes WebSocket upgrade headers for Socket.IO, Wisp and game signaling, supports the existing 80 MB wallpaper limit with multipart overhead, and overwrites incoming client IP headers. If another trusted edge/CDN precedes Nginx, configure its documented real-IP ranges instead of trusting arbitrary forwarded headers. [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html).

Keep service workers and non-hashed Scramjet assets revalidating; do not add blanket one-year cache rules. Do not serve `/var/lib/synnical/uploads` with an Nginx `alias`: the application's serving routes enforce safe media types, ranges and private screenshot authorization.

Install log rotation:

```bash
sudo cp /var/www/synnical/deploy/logrotate-synnical.example /etc/logrotate.d/synnical
sudo logrotate --debug /etc/logrotate.d/synnical
```

## 8. Verify the actual ARM64 deployment

Use HTTPS in a real browser. Register your new account and verify OWNER access with your private owner password. Check login/logout; settings on a second account; two SynnFlix profiles, avatar upload and Continue Watching reset; chat from two browser sessions; Browser navigation, relative links and back/forward; Games Continue Playing and provider/mail errors; Music's generic labels; themes, profile effects and boot behavior; `/linux-vm` fallback or configured VM.

Confirm `/sw.js` activates, the controller/runtime versions match, Wisp connects with status 101 after login, and Socket.IO remains connected. Test playback progress after closing/reopening and after completion against an actual provider. The recovery environment verified code wiring and local APIs but did not reproduce third-party playback, cloud-game sessions, ARM hardware or every browser/provider interaction. The headless UI coverage is listed in `VALIDATION-REPORT.md`.

Reboot once and verify Nginx/PM2 recover automatically. Only after these checks should you treat the VPS as ready for users. Keep port 3000 inaccessible publicly.

## 9. Backups, upgrades and rollback

Back up source release identity, SQLite, uploads, media approvals, `.env` and private Stratus configuration separately. Store private backups outside the public repository and off the VPS. SQLite's `.backup` command produces a consistent database copy; copying only a live `.db` while WAL/journals are active is unsafe.

Example database backup as administrator (use a unique filename):

```bash
sudo sqlite3 /var/lib/synnical/database/synnical.db '.backup /var/backups/synnical/pre-upgrade-20260915.db'
sudo chmod 600 /var/backups/synnical/pre-upgrade-20260915.db
```

For a coordinated upgrade, stop PM2, back up data and configuration, stage the next source in a separate directory, clean-install and validate there, review/apply schema changes, move the old `/var/www/synnical` aside, put the staged source at that path, restore private configuration with mode 600, and restart PM2. Preserve the external data paths. If validation fails before launch, retain the old source and data. If a schema changed, restoring only the old code may be incompatible: use the matching private database backup after stopping the app. Document that restoring a backup loses data written since it was taken.

Never execute the historical coin reset, account deletion or full-unban maintenance scripts as part of this fresh deployment. No recovered production users, uploads or credits exist to restore.
