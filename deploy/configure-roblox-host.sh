#!/usr/bin/env bash
set -Eeuo pipefail

# Configure only the dedicated Roblox origin. The Synnical root/www vhost and
# its certificate are deliberately left untouched.
readonly HOST="roblox.synnical.co.uk"
readonly EXPECTED_IPV4="140.238.87.247"
readonly MARKER="# Managed by Synnical: dedicated Roblox player origin."
readonly AVAILABLE="/etc/nginx/sites-available/synnical-roblox"
readonly ENABLED="/etc/nginx/sites-enabled/synnical-roblox"

log() { printf '[roblox-host] %s\n' "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "Run this script as root."
command -v nginx >/dev/null 2>&1 || fail "Nginx is not installed."
command -v getent >/dev/null 2>&1 || fail "getent is unavailable."

resolved_ipv4="$(getent ahostsv4 "$HOST" | awk '{print $1}' | sort -u || true)"
if [[ "$resolved_ipv4" != "$EXPECTED_IPV4" ]]; then
  log "SKIPPED: DNS currently resolves to '${resolved_ipv4:-no IPv4 address}', expected $EXPECTED_IPV4. No Nginx or certificate changes made."
  exit 0
fi
log "$HOST resolves to $EXPECTED_IPV4."

# Ensure the deployed application has the player entry point before exposing
# the dedicated public hostname.
[[ -s /var/www/synnical/public/roblox-player/index.html ]] || fail "Roblox player index.html is missing from the deployed release."

nginx_dump="$(nginx -T 2>&1)" || fail "nginx -T failed; existing configuration has not been changed."

# An exact host may already be configured. Reuse it only if it reaches the
# Synnical application; refuse to hijack an unrelated virtual host.
if printf '%s\n' "$nginx_dump" | grep -Eq '^[[:space:]]*server_name[[:space:]][^;]*([[:space:]]|^)roblox\.synnical\.co\.uk([[:space:]]|;|$)'; then
  if ! printf '%s\n' "$nginx_dump" | grep -Fq 'proxy_pass http://127.0.0.1:3000'; then
    fail "$HOST is already present in Nginx, but the active configuration does not visibly proxy to 127.0.0.1:3000. Manual inspection is required."
  fi
  log "An Nginx host entry for $HOST already exists and proxies to Synnical; preserving it."
else
  if [[ -e "$AVAILABLE" ]] && ! grep -Fq "$MARKER" "$AVAILABLE"; then
    fail "$AVAILABLE already exists and is not managed by this script; refusing to overwrite it."
  fi
  if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then
    if [[ ! -L "$ENABLED" ]] || [[ "$(readlink -f "$ENABLED")" != "$AVAILABLE" ]]; then
      fail "$ENABLED already exists and is not the managed site symlink; refusing to replace it."
    fi
  fi

  install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled
  temp_file="$(mktemp /etc/nginx/sites-available/.synnical-roblox.XXXXXX)"
  cat > "$temp_file" <<'NGINX'
# Managed by Synnical: dedicated Roblox player origin.
server {
    listen 80;
    listen [::]:80;
    server_name roblox.synnical.co.uk;

    client_max_body_size 84m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
NGINX
  chmod 0644 "$temp_file"
  mv -f "$temp_file" "$AVAILABLE"
  ln -s "$AVAILABLE" "$ENABLED"

  if ! nginx -t; then
    rm -f "$ENABLED" "$AVAILABLE"
    fail "The proposed Roblox HTTP virtual host failed nginx -t; it has been removed and the previous Nginx configuration remains in place."
  fi
  systemctl reload nginx
  log "Enabled an isolated HTTP virtual host for $HOST; root/www configuration was not edited."
fi

if ! command -v certbot >/dev/null 2>&1; then
  log "Installing Certbot and its Nginx plugin."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
fi
if ! certbot plugins 2>/dev/null | grep -qi 'nginx'; then
  log "Installing the Certbot Nginx plugin."
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3-certbot-nginx
fi

# Reuse the host's existing Let's Encrypt account contact when available.
certbot_email="$(python3 - <<'PY'
import glob, json
for path in glob.glob("/etc/letsencrypt/accounts/*/*/*/regr.json"):
    try:
        record = json.load(open(path, encoding="utf-8"))
        for contact in record.get("contact", []):
            if contact.startswith("mailto:"):
                print(contact[7:])
                raise SystemExit(0)
    except (OSError, ValueError):
        pass
PY
)"
certbot_args=(--nginx --non-interactive --agree-tos --redirect -d "$HOST")
if [[ -n "$certbot_email" ]]; then
  certbot_args+=(--email "$certbot_email")
else
  certbot_args+=(--register-unsafely-without-email)
fi

log "Obtaining and installing the dedicated HTTPS certificate."
certbot "${certbot_args[@]}"
nginx -t
systemctl reload nginx

# Verify locally through Nginx with the real Host/SNI name. This confirms the
# certificate and the player page without relying on a possibly cached DNS
# resolver on the server itself.
headers="$(curl --fail --silent --show-error --head --max-time 20 \
  --resolve "$HOST:443:127.0.0.1" "https://$HOST/roblox-player/index.html")" \
  || fail "HTTPS verification of /roblox-player/index.html failed."
printf '%s\n' "$headers" | grep -Eiq '^HTTP/[0-9.]+ 200' \
  || fail "Roblox player page did not return HTTP 200."
printf '%s\n' "$headers" | grep -Eiq '^cross-origin-opener-policy:[[:space:]]*same-origin' \
  || fail "Roblox player response is missing Cross-Origin-Opener-Policy: same-origin."
printf '%s\n' "$headers" | grep -Eiq '^cross-origin-embedder-policy:[[:space:]]*require-corp' \
  || fail "Roblox player response is missing Cross-Origin-Embedder-Policy: require-corp."

log "SUCCESS: $HOST has a valid HTTPS route to the deployed Roblox player."
