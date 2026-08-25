# Synnical Main-Site Batch 1 — Preflight and Installation

Release: `synnical-main-batch1-full-validated-20260821`

This installer is only for the existing production deployment at
`/var/www/synnical`, managed by PM2 as `synnical`.

It does not reset credits, rewrite `.env`, change the Prisma schema, modify
uploads, modify `stratus/sites.json`, or touch the `synnical-svg` repository.

## What the installer preserves

- `/var/www/synnical/.env`
- the production SQLite database and every existing table row
- OWNER identities
- current credit balances
- `/var/lib/synnical/uploads`
- `/var/www/synnical/stratus/sites.json`
- PM2 application name and process identity
- Caddy configuration

## 1. Upload from the Chromebook

Run this in the Chromebook Linux terminal, not inside the VPS SSH session:

```bash
scp ~/Downloads/synnical-main-batch1-full-validated-20260821.zip root@92.38.177.23:/root/
ssh root@92.38.177.23
```

## 2. Install/check the required VPS tools

Run this after SSH login as `root`:

```bash
apt-get update
apt-get install -y unzip rsync curl ca-certificates python3

node --version
npm --version
pm2 --version
```

Node.js must be version 22 or newer. If `pm2 --version` says the command is
missing, install it and check again:

```bash
npm install -g pm2
pm2 --version
```

## 3. Verify and extract the ZIP

Compare the `sha256sum` result with the SHA-256 supplied alongside the final
download. The extraction command refuses to overwrite an earlier directory.

```bash
cd /root

sha256sum synnical-main-batch1-full-validated-20260821.zip
unzip -t synnical-main-batch1-full-validated-20260821.zip

test ! -e /root/synnical-main-batch1-full-validated-20260821 || {
  echo 'STOP: extraction directory already exists; nothing was overwritten.'
  exit 1
}

unzip -q synnical-main-batch1-full-validated-20260821.zip -d /root
cd /root/synnical-main-batch1-full-validated-20260821

sha256sum -c MAIN-BATCH1-SOURCE-MANIFEST.sha256
bash -n install-main-batch1.sh
```

## 4. Isolated no-mutation preflight

```bash
cd /root/synnical-main-batch1-full-validated-20260821

bash ./install-main-batch1.sh --preflight \
  2>&1 | tee /root/synnical-main-batch1-preflight-20260821.log
```

The successful ending is:

```text
PREFLIGHT_CUSTOM_SERVER_OK: ...
PREFLIGHT_STAGE_OK: ...
PREFLIGHT_OK: synnical-main-batch1-full-validated-20260821
LIVE_UNCHANGED: ...
```

Preflight creates a disposable sibling tree, performs a clean locked `npm ci`,
uses a disposable SQLite database, validates/generates Prisma, runs semantic
TypeScript, all 13 Batch-1 tests, the real Next.js build, boots the custom
`server.ts`, checks `/` and `/api/auth/me`, shuts it down, and verifies the live
PM2 app remained online. Production is not stopped or changed.

## 5. Install only after preflight succeeds

```bash
cd /root/synnical-main-batch1-full-validated-20260821

bash ./install-main-batch1.sh --install \
  2>&1 | tee /root/synnical-main-batch1-install-20260821.log
```

The installer repeats the isolated preflight before touching production. Only
after all gates pass does it stop PM2, take a consistent SQLite snapshot, check
every existing table count and OWNER identity, create a persistent backup,
swap the application directory, restart PM2, and verify root, auth, Socket.IO,
Games JSON handling, and account-scoped connections.

The successful ending is:

```text
HTTP_READINESS_OK: ...
INSTALL_COMPLETE: synnical-main-batch1-full-validated-20260821
LIVE_APP: /var/www/synnical
ROLLBACK_APP: ...
PERSISTENT_BACKUP: ...
DATA_PRESERVED: ...
SVG_UNCHANGED: ...
```

Any failure after PM2 is stopped triggers automatic rollback to the untouched
old application directory. On success, the script prints the retained rollback
directory and compact persistent backup path.

## 6. Independent final checks

```bash
pm2 status
pm2 logs synnical --lines 120 --nostream

curl -sS -o /dev/null -w 'ROOT=%{http_code}\n' https://synnical.co.uk/
curl -sS -o /dev/null -w 'AUTH=%{http_code}\n' https://synnical.co.uk/api/auth/me
curl -sS -o /dev/null -w 'SOCKET=%{http_code}\n' \
  'https://synnical.co.uk/socket.io/?EIO=4&transport=polling'
```

Expected values are `ROOT=200`, `AUTH=200`, and `SOCKET=200`.
