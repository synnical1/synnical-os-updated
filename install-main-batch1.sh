#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_ID="synnical-main-batch1-full-validated-20260821"
MODE="${1:-}"

case "$MODE" in
  --preflight|--install) ;;
  *)
    printf 'Usage: bash ./install-main-batch1.sh --preflight|--install\n' >&2
    exit 2
    ;;
esac

APP_DIR_INPUT="${SYNNICAL_APP_DIR:-/var/www/synnical}"
PM2_APP_NAME="${SYNNICAL_PM2_APP_NAME:-synnical}"
READY_URL="${SYNNICAL_READY_URL:-http://127.0.0.1:3000}"
READY_URL="${READY_URL%/}"
PREFLIGHT_PORT="${SYNNICAL_PREFLIGHT_PORT:-3317}"
BACKUP_ROOT="${SYNNICAL_BACKUP_ROOT:-/var/backups/synnical}"
READINESS_ATTEMPTS="${SYNNICAL_READINESS_ATTEMPTS:-60}"
RELEASE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

APP_DIR=""
APP_PARENT=""
STAGE_ROOT=""
STAGE_APP=""
PREFLIGHT_SERVER_PID=""
PREFLIGHT_SERVER_LOG=""
PM2_STOPPED=0
OLD_MOVED=0
SWAPPED=0
OLD_APP=""
FAILED_APP=""
BACKUP_DIR=""
INSTALL_STAGE="bootstrap"

log() { printf '[main-batch1] %s\n' "$*"; }
die() { printf 'MAIN_BATCH1_ERROR: stage=%s %s\n' "$INSTALL_STAGE" "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command missing: $1"
}

pm2_status() {
  pm2 jlist | node -e '
    let raw="";
    process.stdin.on("data", chunk => raw += chunk);
    process.stdin.on("end", () => {
      const rows = JSON.parse(raw || "[]");
      const match = rows.find(row => row.name === process.argv[1]);
      process.stdout.write(match?.pm2_env?.status || "missing");
    });
  ' "$PM2_APP_NAME"
}

read_env_value() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
if not path.is_file():
    raise SystemExit(0)

for line in path.read_text(errors="replace").splitlines():
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        continue
    name, value = stripped.split("=", 1)
    if name.strip() != key:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    print(value)
    break
PY
}

sqlite_path_for_app() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import sys

app = Path(sys.argv[1]).resolve()
url = sys.argv[2]
if not url.startswith("file:"):
    raise SystemExit("DATABASE_URL is not a local SQLite file URL")
raw = url[5:]
if raw.startswith("//"):
    raw = raw[2:]
path = Path(raw)
if path.is_absolute():
    print(path.resolve())
else:
    print((app / "prisma" / path).resolve())
PY
}

stop_preflight_server() {
  if [[ -n "$PREFLIGHT_SERVER_PID" ]] && kill -0 "$PREFLIGHT_SERVER_PID" >/dev/null 2>&1; then
    kill -TERM "$PREFLIGHT_SERVER_PID" >/dev/null 2>&1 || true
    wait "$PREFLIGHT_SERVER_PID" >/dev/null 2>&1 || true
  fi
  PREFLIGHT_SERVER_PID=""
}

cleanup_stage() {
  stop_preflight_server
  if [[ -n "$STAGE_ROOT" && -d "$STAGE_ROOT" ]]; then
    case "$STAGE_ROOT" in
      "$APP_PARENT"/.synnical-main-batch1-stage.*) rm -rf -- "$STAGE_ROOT" ;;
      *) printf 'REFUSED_UNSAFE_STAGE_CLEANUP: %s\n' "$STAGE_ROOT" >&2 ;;
    esac
  fi
  STAGE_ROOT=""
}

rollback() {
  local code="$1"
  trap - EXIT INT TERM ERR
  set +e
  printf 'ROLLBACK_START: restoring the pre-%s application\n' "$RELEASE_ID" >&2
  pm2 stop "$PM2_APP_NAME" >/dev/null 2>&1 || true

  if [[ "$SWAPPED" -eq 1 && -d "$APP_DIR" ]]; then
    FAILED_APP="$APP_PARENT/.synnical-main-batch1-failed.$(date +%s).$$"
    mv -- "$APP_DIR" "$FAILED_APP" || true
  fi

  if [[ "$OLD_MOVED" -eq 1 && -d "$OLD_APP" && ! -e "$APP_DIR" ]]; then
    mv -- "$OLD_APP" "$APP_DIR" || true
  fi

  pm2 restart "$PM2_APP_NAME" --update-env >/dev/null 2>&1 || \
    pm2 start "$APP_DIR/ecosystem.config.cjs" --update-env >/dev/null 2>&1 || true
  PM2_STOPPED=0
  cleanup_stage
  printf 'ROLLBACK_COMPLETE: previous application restored. Failed candidate: %s\n' "${FAILED_APP:-not retained}" >&2
  exit "$code"
}

on_exit() {
  local code="$?"
  trap - EXIT
  stop_preflight_server
  if [[ "$code" -ne 0 && "$MODE" == "--install" && ( "$PM2_STOPPED" -eq 1 || "$OLD_MOVED" -eq 1 || "$SWAPPED" -eq 1 ) ]]; then
    rollback "$code"
  fi
  cleanup_stage
  exit "$code"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

verify_release() {
  INSTALL_STAGE="release-integrity"
  [[ -f "$RELEASE_DIR/MAIN-BATCH1-SOURCE-MANIFEST.sha256" ]] || die "checksum manifest is missing"
  (cd "$RELEASE_DIR" && sha256sum -c MAIN-BATCH1-SOURCE-MANIFEST.sha256 >/dev/null) || die "release checksum manifest failed"
  bash -n "$RELEASE_DIR/install-main-batch1.sh"
  bash -n "$RELEASE_DIR/install-full.sh"
  node --check "$RELEASE_DIR/stratus/api.js"
  node - "$RELEASE_DIR/package.json" "$RELEASE_DIR/package-lock.json" <<'NODE'
const fs = require("fs")
const pkg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const lock = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
const wanted = { ...pkg.dependencies, ...pkg.devDependencies }
const locked = { ...(lock.packages?.[""]?.dependencies || {}), ...(lock.packages?.[""]?.devDependencies || {}) }
const mismatches = Object.entries(wanted).filter(([name, range]) => locked[name] !== range)
if (mismatches.length) {
  console.error(mismatches)
  process.exit(1)
}
if (pkg.scripts?.start !== "NODE_ENV=production tsx server.ts") process.exit(1)
if (pkg.dependencies?.tsx !== "^4.23.11") process.exit(1)
console.log("RELEASE_PACKAGE_LOCK_OK")
NODE
}

copy_release_source() {
  local destination="$1"
  mkdir -p "$destination"
  rsync -a \
    --exclude node_modules \
    --exclude .next \
    --exclude .git \
    --exclude .env \
    --exclude 'prisma/db/*.db*' \
    --exclude public/uploads \
    --exclude stratus/sites.json \
    "$RELEASE_DIR/" "$destination/"
}

check_disk_space() {
  INSTALL_STAGE="disk-safety"
  local dependency_kb source_kb available_kb required_kb
  dependency_kb="$(du -sk -- "$APP_DIR/node_modules" | awk '{print $1}')"
  source_kb="$(du -sk --exclude=node_modules --exclude=.next -- "$RELEASE_DIR" | awk '{print $1}')"
  available_kb="$(df -Pk -- "$APP_PARENT" | awk 'NR==2 {print $4}')"
  required_kb=$((dependency_kb + source_kb + 1048576))
  (( available_kb >= required_kb )) || die "insufficient free disk: free=${available_kb}KiB required=${required_kb}KiB"
  log "disk safety passed: free=${available_kb}KiB required=${required_kb}KiB"
}

prepare_stage() {
  INSTALL_STAGE="stage-source"
  STAGE_ROOT="$(mktemp -d "$APP_PARENT/.synnical-main-batch1-stage.XXXXXX")"
  chmod 0700 "$STAGE_ROOT"
  STAGE_APP="$STAGE_ROOT/app"
  PREFLIGHT_SERVER_LOG="$STAGE_ROOT/preflight-server.log"
  copy_release_source "$STAGE_APP"
  cp -- "$APP_DIR/.env" "$STAGE_APP/.env"
  chmod 0600 "$STAGE_APP/.env"
  if [[ -f "$APP_DIR/stratus/sites.json" ]]; then
    mkdir -p "$STAGE_APP/stratus"
    cp -- "$APP_DIR/stratus/sites.json" "$STAGE_APP/stratus/sites.json"
  fi
}

assert_preflight_port_free() {
  python3 - "$PREFLIGHT_PORT" <<'PY'
import socket, sys
port = int(sys.argv[1])
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    sock.bind(("127.0.0.1", port))
finally:
    sock.close()
PY
}

run_server_smoke() {
  INSTALL_STAGE="preflight-server-smoke"
  local healthy=0 root_status="000" auth_status="000"
  assert_preflight_port_free || die "preflight port $PREFLIGHT_PORT is unavailable"

  PORT="$PREFLIGHT_PORT" \
  HOSTNAME="127.0.0.1" \
  STRATUS_ENABLED=false \
  WISP_ENABLED=false \
  npm start >"$PREFLIGHT_SERVER_LOG" 2>&1 &
  PREFLIGHT_SERVER_PID="$!"

  for _attempt in $(seq 1 "$READINESS_ATTEMPTS"); do
    if ! kill -0 "$PREFLIGHT_SERVER_PID" >/dev/null 2>&1; then break; fi
    root_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PREFLIGHT_PORT/" || true)"
    auth_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PREFLIGHT_PORT/api/auth/me" || true)"
    if [[ "$root_status" =~ ^[23][0-9][0-9]$ && "$auth_status" == "200" ]]; then
      healthy=1
      break
    fi
    sleep 0.5
  done

  if [[ "$healthy" -ne 1 ]]; then
    tail -n 120 "$PREFLIGHT_SERVER_LOG" >&2 || true
    stop_preflight_server
    die "custom server smoke failed: root=$root_status auth=$auth_status"
  fi

  stop_preflight_server
  printf 'PREFLIGHT_CUSTOM_SERVER_OK: root=%s auth=%s port=%s\n' "$root_status" "$auth_status" "$PREFLIGHT_PORT"
}

run_stage_preflight() {
  INSTALL_STAGE="clean-dependency-install"
  cd "$STAGE_APP"
  npm ci --no-audit --no-fund

  mkdir -p prisma/db "$STAGE_ROOT/uploads"
  export DATABASE_URL='file:./db/main-batch1-preflight.db'
  export UPLOAD_DIR="$STAGE_ROOT/uploads"
  export NODE_ENV=production
  export NEXT_TELEMETRY_DISABLED=1
  export STRATUS_ENABLED=false
  export WISP_ENABLED=false

  INSTALL_STAGE="main-batch-preflight"
  npm run preflight:main-batch
  node node_modules/prisma/build/index.js db push --skip-generate
  run_server_smoke
  rm -f -- prisma/db/main-batch1-preflight.db prisma/db/main-batch1-preflight.db-shm prisma/db/main-batch1-preflight.db-wal
  unset DATABASE_URL UPLOAD_DIR STRATUS_ENABLED WISP_ENABLED
  printf 'PREFLIGHT_STAGE_OK: clean npm install, Prisma, TypeScript, 13 focused tests, Next build and custom-server HTTP smoke passed\n'
}

snapshot_database() {
  local live_db="$1" snapshot="$2" invariants="$3"
  python3 - "$live_db" "$snapshot" "$invariants" <<'PY'
from pathlib import Path
import json, sqlite3, sys

live = Path(sys.argv[1]).resolve()
snapshot = Path(sys.argv[2]).resolve()
invariants = Path(sys.argv[3]).resolve()
if not live.is_file():
    raise SystemExit(f"production SQLite database not found: {live}")

snapshot.parent.mkdir(parents=True, exist_ok=True)
src = sqlite3.connect(f"file:{live}?mode=ro", uri=True)
dst = sqlite3.connect(str(snapshot))
try:
    src.backup(dst)
    tables = [row[0] for row in src.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
    counts = {}
    for table in tables:
        quoted = '"' + table.replace('"', '""') + '"'
        counts[table] = src.execute(f"select count(*) from {quoted}").fetchone()[0]
    owners = []
    if "User" in tables:
        owners = [list(row) for row in src.execute('select id, username, role from "User" where role = ? order by id', ("OWNER",))]
finally:
    dst.close()
    src.close()

invariants.write_text(json.dumps({"counts": counts, "owners": owners}, indent=2))
print(f"SQLITE_SNAPSHOT_OK: {len(counts)} tables; {len(owners)} owner account(s)")
PY
}

copy_database_to_stage() {
  local snapshot="$1" stage_db="$2"
  mkdir -p "$(dirname -- "$stage_db")"
  rm -f -- "$stage_db" "$stage_db-shm" "$stage_db-wal"
  cp -- "$snapshot" "$stage_db"
}

check_database_invariants() {
  local db_path="$1" invariants="$2"
  python3 - "$db_path" "$invariants" <<'PY'
from pathlib import Path
import json, sqlite3, sys

db = Path(sys.argv[1]).resolve()
before = json.loads(Path(sys.argv[2]).read_text())
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
try:
    tables = {row[0] for row in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")}
    for table, expected in before["counts"].items():
        if table not in tables:
            raise SystemExit(f"table disappeared: {table}")
        quoted = '"' + table.replace('"', '""') + '"'
        actual = con.execute(f"select count(*) from {quoted}").fetchone()[0]
        if actual != expected:
            raise SystemExit(f"row count changed for {table}: before={expected} after={actual}")
    owners = [list(row) for row in con.execute('select id, username, role from "User" where role = ? order by id', ("OWNER",))] if "User" in tables else []
finally:
    con.close()

if owners != before["owners"]:
    raise SystemExit(f"OWNER identities changed: before={before['owners']!r} after={owners!r}")
print(f"DATA_PRESERVATION_OK: {len(before['counts'])} tables and {len(owners)} owner account(s) unchanged")
PY
}

create_persistent_backup() {
  local snapshot="$1"
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  BACKUP_DIR="$BACKUP_ROOT/pre-${RELEASE_ID}-${stamp}"
  mkdir -p "$BACKUP_DIR"
  chmod 0700 "$BACKUP_DIR"
  cp -- "$snapshot" "$BACKUP_DIR/database.sqlite"
  cp -- "$APP_DIR/.env" "$BACKUP_DIR/.env"
  chmod 0600 "$BACKUP_DIR/.env"
  if [[ -f "$APP_DIR/stratus/sites.json" ]]; then cp -- "$APP_DIR/stratus/sites.json" "$BACKUP_DIR/sites.json"; fi
  (
    cd "$APP_DIR"
    tar \
      --exclude='./node_modules' \
      --exclude='./.next' \
      --exclude='./prisma/db' \
      --exclude='./public/uploads' \
      --exclude='./.git' \
      -czf "$BACKUP_DIR/source.tar.gz" .
  )
  printf '%s\n' "$RELEASE_ID" > "$BACKUP_DIR/upgrading-to.txt"
  log "persistent backup created: $BACKUP_DIR"
}

readiness_check() {
  INSTALL_STAGE="post-install-readiness"
  local root_status="000" auth_status="000" socket_status="000" games_status="000" connections_status="000"
  local games_type="" connections_type="" online="missing"
  local games_headers="$APP_PARENT/.synnical-main-batch1-games-headers.$$"
  local connections_headers="$APP_PARENT/.synnical-main-batch1-connections-headers.$$"

  for _attempt in $(seq 1 "$READINESS_ATTEMPTS"); do
    online="$(pm2_status 2>/dev/null || true)"
    root_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$READY_URL/" || true)"
    auth_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$READY_URL/api/auth/me" || true)"
    socket_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$READY_URL/socket.io/?EIO=4&transport=polling" || true)"
    games_status="$(curl -sS -D "$games_headers" -o /dev/null -w '%{http_code}' --max-time 3 "$READY_URL/api/features/games" || true)"
    connections_status="$(curl -sS -D "$connections_headers" -o /dev/null -w '%{http_code}' --max-time 3 "$READY_URL/api/profile/connections" || true)"
    games_type="$(awk 'tolower($1) == "content-type:" {sub(/\r$/, "", $2); print $2}' "$games_headers" 2>/dev/null | tail -n 1)"
    connections_type="$(awk 'tolower($1) == "content-type:" {sub(/\r$/, "", $2); print $2}' "$connections_headers" 2>/dev/null | tail -n 1)"

    if [[ "$online" == "online" \
      && "$root_status" =~ ^[23][0-9][0-9]$ \
      && "$auth_status" == "200" \
      && "$socket_status" == "200" \
      && "$games_status" =~ ^(200|401)$ \
      && "$connections_status" =~ ^(200|401)$ \
      && "$games_type" == application/json* \
      && "$connections_type" == application/json* ]]; then
      rm -f -- "$games_headers" "$connections_headers"
      printf 'HTTP_READINESS_OK: pm2=%s root=%s auth=%s socket=%s games=%s/%s connections=%s/%s\n' \
        "$online" "$root_status" "$auth_status" "$socket_status" "$games_status" "$games_type" "$connections_status" "$connections_type"
      return 0
    fi
    sleep 1
  done

  rm -f -- "$games_headers" "$connections_headers"
  pm2 logs "$PM2_APP_NAME" --lines 120 --nostream >&2 || true
  die "readiness failed: pm2=$online root=$root_status auth=$auth_status socket=$socket_status games=$games_status/$games_type connections=$connections_status/$connections_type"
}

INSTALL_STAGE="tool-check"
for command_name in bash node npm python3 rsync tar sha256sum cp mv rm mkdir mktemp df du awk curl pm2 flock realpath seq cmp tail; do
  require_command "$command_name"
done

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 22 )) || die "Node.js 22 or newer is required; found $(node --version)"
[[ "$READINESS_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die "SYNNICAL_READINESS_ATTEMPTS must be a positive integer"
[[ "$APP_DIR_INPUT" == /* && "$APP_DIR_INPUT" != "/" ]] || die "unsafe SYNNICAL_APP_DIR: $APP_DIR_INPUT"
[[ "$BACKUP_ROOT" == /* && "$BACKUP_ROOT" != "/" ]] || die "unsafe SYNNICAL_BACKUP_ROOT: $BACKUP_ROOT"
APP_DIR="$(realpath -e -- "$APP_DIR_INPUT")"
APP_PARENT="$(dirname -- "$APP_DIR")"
[[ "$APP_DIR" != "$RELEASE_DIR" ]] || die "release directory cannot be the live app directory"
[[ -f "$APP_DIR/package.json" && -f "$APP_DIR/.env" && -f "$APP_DIR/prisma/schema.prisma" && -d "$APP_DIR/node_modules" ]] || die "existing Synnical deployment is incomplete at $APP_DIR"
[[ "$(pm2_status)" == "online" ]] || die "PM2 app $PM2_APP_NAME is not online before preflight"

LOCK_FILE="$APP_PARENT/.synnical-main-batch1-install.lock"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another Synnical installer is already running"

verify_release
cmp -s "$RELEASE_DIR/prisma/schema.prisma" "$APP_DIR/prisma/schema.prisma" || \
  die "Prisma schema differs from production; this no-migration batch refuses to touch the database"
check_disk_space
prepare_stage
run_stage_preflight

if [[ "$MODE" == "--preflight" ]]; then
  [[ "$(pm2_status)" == "online" ]] || die "preflight changed the live PM2 state"
  printf 'PREFLIGHT_OK: %s\n' "$RELEASE_ID"
  printf 'LIVE_UNCHANGED: source, .env, SQLite, uploads, Stratus config, PM2 and SVG publication were not modified\n'
  exit 0
fi

INSTALL_STAGE="database-location"
PROD_DB_URL="$(read_env_value "$APP_DIR/.env" DATABASE_URL)"
[[ "$PROD_DB_URL" == file:* ]] || die "this installer supports the existing local SQLite deployment only"
LIVE_DB="$(sqlite_path_for_app "$APP_DIR" "$PROD_DB_URL")"
[[ -f "$LIVE_DB" ]] || die "production SQLite database not found: $LIVE_DB"

case "$LIVE_DB" in
  "$APP_DIR"/*)
    LIVE_DB_RELATIVE="${LIVE_DB#"$APP_DIR"/}"
    STAGE_DB="$STAGE_APP/$LIVE_DB_RELATIVE"
    ;;
  *)
    STAGE_DB="$LIVE_DB"
    ;;
esac

INSTALL_STAGE="production-stop-and-snapshot"
SNAPSHOT_DIR="$STAGE_ROOT/production-snapshot"
mkdir -p "$SNAPSHOT_DIR"
pm2 stop "$PM2_APP_NAME"
PM2_STOPPED=1
snapshot_database "$LIVE_DB" "$SNAPSHOT_DIR/database.sqlite" "$SNAPSHOT_DIR/invariants.json"

if [[ "$STAGE_DB" != "$LIVE_DB" ]]; then
  copy_database_to_stage "$SNAPSHOT_DIR/database.sqlite" "$STAGE_DB"
fi
check_database_invariants "$STAGE_DB" "$SNAPSHOT_DIR/invariants.json"
create_persistent_backup "$SNAPSHOT_DIR/database.sqlite"

INSTALL_STAGE="atomic-directory-swap"
OLD_APP="$APP_PARENT/.synnical-main-batch1-old.$(date +%s).$$"
mv -- "$APP_DIR" "$OLD_APP"
OLD_MOVED=1
mv -- "$STAGE_APP" "$APP_DIR"
STAGE_APP=""
SWAPPED=1

INSTALL_STAGE="pm2-restart"
pm2 restart "$PM2_APP_NAME" --update-env || pm2 start "$APP_DIR/ecosystem.config.cjs" --update-env
PM2_STOPPED=0
readiness_check
pm2 save --force

rm -rf -- "$STAGE_ROOT"
STAGE_ROOT=""
trap - EXIT INT TERM

printf 'INSTALL_COMPLETE: %s\n' "$RELEASE_ID"
printf 'LIVE_APP: %s\n' "$APP_DIR"
printf 'ROLLBACK_APP: %s\n' "$OLD_APP"
printf 'PERSISTENT_BACKUP: %s\n' "$BACKUP_DIR"
printf 'DATA_PRESERVED: .env, SQLite rows/OWNER identities, uploads, Stratus config and credit balances were not changed\n'
printf 'SVG_UNCHANGED: SVG retirement/rebuild remains a separate Batch 2\n'
