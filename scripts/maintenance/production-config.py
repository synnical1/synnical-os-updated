"""Root-only, fixed-scope configuration. All failure messages deliberately redact details."""
import fcntl
import hashlib
import http.client
import json
import os
import pathlib
import pwd
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

APP = pathlib.Path('/var/www/synnical')
STATE = pathlib.Path('/var/lib/synnical-maintenance')
MALQ = pathlib.Path('/opt/synnical-malq/e3a85150b6113f555b1d3a2c2148f45b3d768460')
UNIT = pathlib.Path('/etc/systemd/system/synnical-malq.service')
STAGE = 'preflight'
KEYS = ('TMDB_API_READ_TOKEN', 'STRATUS_API_KEY', 'STRATUS_MALQ_URL')


def merge_env(text, updates):
    """Retain unrelated lines verbatim, remove duplicates only for the three owned keys."""
    if set(updates) != set(KEYS) or any(not re.fullmatch(r'[A-Za-z0-9._:/-]+', v) for v in updates.values()):
        raise ValueError('Invalid maintenance values')
    lines = [line for line in text.splitlines(keepends=True)
             if not re.match(r'^\s*(?:export\s+)?(?:' + '|'.join(KEYS) + r')\s*=', line)]
    retained = ''.join(lines)
    return retained + ('' if not retained or retained.endswith('\n') else '\n') + ''.join(f'{k}={updates[k]}\n' for k in KEYS)


def run(args, *, user=None, cwd=None, capture=False):
    if user:
        args = ['runuser', '-u', user, '--'] + args
    return subprocess.run(args, cwd=cwd, check=True, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=360).stdout


def http(url, token=None, method='GET'):
    # Fixed destinations only. No URL supplied by a workflow input; do not follow redirects.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token} if token else {}, method=method)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            return response.status, response.read(2 * 1024 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, b''


def write_private(path, data, uid=0, gid=0):
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        os.chown(temporary, uid, gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    global STAGE
    if os.geteuid() != 0 or len(sys.argv) != 2 or os.uname().machine != 'aarch64':
        raise ValueError('Root and a staging directory required')
    staging = pathlib.Path(sys.argv[1])
    payload = json.loads(sys.stdin.read(32768))
    token = payload['tmdb']
    proxy = payload.get('proxy', '')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{30,8192}', token):
        raise ValueError('Invalid TMDB input')
    if proxy:
        from urllib.parse import urlsplit
        parsed = urlsplit(proxy)
        if parsed.scheme != 'https' or not parsed.hostname or any(c in proxy for c in '\r\n\x00'):
            raise ValueError('Invalid proxy input')
    account = pwd.getpwnam('synnical')
    envfile = APP / '.env'
    if envfile.is_symlink() or not envfile.is_file() or envfile.stat().st_uid != account.pw_uid:
        raise ValueError('Unexpected environment file')
    # Share the exact lock path and owner with normal deployment.
    lockfd = os.open('/tmp/synnical-deploy.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    os.fchown(lockfd, account.pw_uid, account.pw_gid)
    fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    STATE.mkdir(mode=0o700, exist_ok=True)
    if STATE.is_symlink() or STATE.stat().st_uid != 0:
        raise ValueError('Unexpected maintenance directory')
    os.chmod(STATE, 0o700)
    marker = STATE / 'configuration-attempted'
    if marker.exists():
        raise ValueError('One-time attempt already recorded; operator review required')
    # Reject persisted PM2 overrides rather than copying secrets into its process dump.
    apps = json.loads(run(['pm2', 'jlist'], user='synnical', cwd=APP, capture=True))
    app = next(row for row in apps if row['name'] == 'synnical')
    if app['pm2_env']['status'] != 'online' or pathlib.Path(app['pm2_env']['pm_cwd']).resolve() != APP or any(app['pm2_env'].get(k) or app['pm2_env'].get('env', {}).get(k) for k in KEYS):
        raise ValueError('PM2 is offline or has conflicting environment overrides')
    commit = run(['git', 'rev-parse', 'HEAD'], user='synnical', cwd=APP, capture=True).strip()
    # Validate the private credential before any production mutation.
    if http('https://api.themoviedb.org/3/configuration', token)[0] != 200:
        raise ValueError('TMDB validation failed')
    if UNIT.exists() or MALQ.parent.exists() or run(['ss', '-H', '-ltn', 'sport = :4400'], capture=True).strip():
        raise ValueError('Existing malq installation or listener requires operator review')
    try:
        pwd.getpwnam('synnical-malq')
        raise ValueError('Existing service identity requires operator review')
    except KeyError:
        pass
    old_env = envfile.read_text()
    # Existing owned keys must be single-line, so removing them cannot orphan a multiline secret.
    for line in old_env.splitlines():
        if re.match(r'^\s*(?:export\s+)?(?:' + '|'.join(KEYS) + r')\s*=', line):
            value = line.split('=', 1)[1].strip()
            if value.startswith(('"', "'")) and (len(value) < 2 or not value.endswith(value[0])):
                raise ValueError('Multiline owned environment value requires operator review')
    write_private(STATE / 'synnical.env.before', old_env)
    STAGE = 'pinned malq provisioning'
    write_private(marker, 'Started; do not rerun automatically.\n')
    MALQ.mkdir(parents=True, mode=0o755)
    run(['tar', '--extract', '--gzip', '--file', str(staging / 'malq.tar.gz'), '--directory', str(MALQ)])
    with zipfile.ZipFile(staging / 'bun.zip') as archive:
        binary = archive.read('bun-linux-aarch64/bun')
    if hashlib.sha256((staging / 'bun.zip').read_bytes()).hexdigest() != 'd13944da12a53ecc74bf6a720bd1d04c4555c038dfe422365356a7be47691fdf':
        raise ValueError('Bun checksum mismatch')
    (MALQ / 'bun').write_bytes(binary)
    (MALQ / 'bun').chmod(0o755)
    # Dedicated identity has no access to Synnical's .env, database or uploads.
    run(['useradd', '--system', '--home-dir', '/nonexistent', '--no-create-home', '--shell', '/usr/sbin/nologin', 'synnical-malq'])
    run(['chown', '-R', 'synnical-malq:synnical-malq', str(MALQ)])
    run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(MALQ / '.npm-cache')], user='synnical-malq', cwd=MALQ)
    # Install scripts are never executed; dependencies are locked in the PR.
    shutil.rmtree(MALQ / '.npm-cache', ignore_errors=True)
    run(['chown', '-R', 'root:root', str(MALQ)])
    proxy_env = 'PROXY="' + proxy.replace('\\', '\\\\').replace('"', '\\"') + '"\n' if proxy else 'PROXY=\n'
    write_private(STATE / 'malq.env', proxy_env + 'DEMO_ENABLED=\nALLOW_PROVIDER_SPECIFY=0\nDEBUG=\n')
    UNIT.write_text(f'''[Unit]
Description=Synnical pinned loopback malq
After=network-online.target
Wants=network-online.target
[Service]
User=synnical-malq
Group=synnical-malq
WorkingDirectory={MALQ}
ExecStart={MALQ}/bun src/main.ts
EnvironmentFile={STATE}/malq.env
Environment=HOME=/nonexistent
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
InaccessiblePaths=/var/www/synnical /var/lib/synnical /var/log/synnical
# Upstream exceptions may contain proxy credentials/mail session data. Do not journal them.
StandardOutput=null
StandardError=null
Restart=no
[Install]
WantedBy=multi-user.target
''')
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', 'synnical-malq.service'])
    STAGE = 'loopback malq readiness'
    for _ in range(90):
        try:
            status, body = http('http://127.0.0.1:4400/')
            listeners = run(['ss', '-H', '-ltn', 'sport = :4400'], capture=True).decode().splitlines()
            if status == 200 and re.search(rb'<title>\s*malq\b', body, re.I) and len(listeners) == 1 and listeners[0].split()[3] == '127.0.0.1:4400':
                break
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(2)
    else:
        raise ValueError('malq readiness failed before Synnical environment update')
    STAGE = 'private environment update'
    key = secrets.token_hex(32)
    updated = merge_env(old_env, dict(zip(KEYS, (token, key, 'http://127.0.0.1:4400'))))
    # Use the application's parser to protect unrelated multiline values.
    def parse_env(text):
        result = subprocess.run(['node', '-e', 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.stringify(require("dotenv").parse(s))))'], cwd=APP, input=text.encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=True)
        return json.loads(result.stdout)
    before, after = parse_env(old_env), parse_env(updated)
    if {k:v for k,v in before.items() if k not in KEYS} != {k:v for k,v in after.items() if k not in KEYS}:
        raise ValueError('Unrelated parsed environment changed')
    if any(after.get(k) != v for k,v in zip(KEYS, (token,key,'http://127.0.0.1:4400'))):
        raise ValueError('Owned environment parse mismatch')
    write_private(envfile, updated, account.pw_uid, account.pw_gid)
    STAGE = 'PM2 reload and runtime verification'
    reload_started = time.time() * 1000
    run(['pm2', 'reload', 'synnical', '--update-env'], user='synnical', cwd=APP)
    run(['pm2', 'save'], user='synnical', cwd=APP)
    # Probe the actual application; no test account, inbox, or game session is created.
    probe = '''import dotenv from "dotenv"; dotenv.config({override:true});
import {inspectRuntimeReadiness} from "./scripts/runtime-preflight.mjs";
const r=await inspectRuntimeReadiness({runtimeBase:"http://127.0.0.1:"+(process.env.PORT||"3000")});
if(r.stratus.key!=="PRESENT"||r.stratus.readiness!=="ready"||r.tmdb.credential!=="VALID"||r.tmdb.catalogue!=="DATA"||r.tmdb.animeCatalogue!=="DATA") process.exit(1);
console.log(JSON.stringify(r));'''
    for _ in range(15):
        try:
            report = run(['node', '--input-type=module', '-e', probe], user='synnical', cwd=APP, capture=True)
            break
        except subprocess.CalledProcessError:
            time.sleep(2)
    else:
        raise ValueError('Post-reload readiness failed')
    if http('http://127.0.0.1:3000/api/games/cloud/v1/createSession', method='POST')[0] != 401:
        raise ValueError('Anonymous Games authentication check failed')
    if run(['git', 'rev-parse', 'HEAD'], user='synnical', cwd=APP, capture=True).strip() != commit:
        raise ValueError('Production checkout changed during maintenance')
    apps = json.loads(run(['pm2', 'jlist'], user='synnical', cwd=APP, capture=True))
    restarted = next(row for row in apps if row['name'] == 'synnical')
    if restarted['pm2_env']['status'] != 'online' or restarted['pm2_env']['pm_uptime'] < reload_started:
        raise ValueError('PM2 runtime is not online')
    # Check generated browser assets for literal private credentials without printing matches.
    for file in (APP / '.next/static').rglob('*'):
        if file.is_file() and any(v.encode() in file.read_bytes() for v in (token, key)):
            raise ValueError('Private value found in browser asset')
    write_private(marker, 'Completed. Remove the maintenance workflow and temporary GitHub secrets.\n')
    print('STRATUS_API_KEY: PRESENT; malq: loopback READY; TMDB credential: VALID')
    print('SynnFlix: DATA; Synnime: DATA; Games readiness: READY; anonymous access: DENIED')
    print('Authenticated gameplay: UNVERIFIED; browser UI: UNVERIFIED; checkout unchanged; PM2 online')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Maintenance failed at ' + STAGE + '. Stop and review; no automatic rollback or retry.', file=sys.stderr)
        sys.exit(1)
