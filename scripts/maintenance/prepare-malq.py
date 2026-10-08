"""Prepare only the reviewed upstream checkout; never execute upstream code."""
import hashlib
import json
import pathlib
import subprocess
import sys

PIN = 'e3a85150b6113f555b1d3a2c2148f45b3d768460'
BUN_SHA256 = 'd13944da12a53ecc74bf6a720bd1d04c4555c038dfe422365356a7be47691fdf'

def patch(root):
    def replace(file, old, new, count):
        path = root / file
        text = path.read_text()
        if text.count(old) != count:
            raise ValueError('Pinned upstream patch no longer matches')
        path.write_text(text.replace(old, new))
    replace('src/main.ts', 'app.listen(4400, () => {', 'app.listen({ hostname: "127.0.0.1", port: 4400 }, () => {', 1)
    replace('src/util/waf/createClient.ts', 'rejectUnauthorized: false,', 'rejectUnauthorized: true,', 2)
    replace('src/util/waf/createClient.ts', 'checkServerIdentity: () => undefined,', 'checkServerIdentity: tls.checkServerIdentity,', 2)
    # Providers can pass tls.rejectUnauthorized=false to fish(). Enforce verification centrally.
    replace('src/util/util.ts', 'return fetch(url, options);', 'return fetch(url, { ...options, tls: { ...options.tls, rejectUnauthorized: true } });', 1)
    # Do not start CONNECT before HTTPS proxy authentication has completed.
    replace('src/util/waf/createClient.ts', "proxySocket.on('connect', () => {", "proxySocket.on(isHttpsProxy ? 'secureConnect' : 'connect', () => {", 1)


def production_package(root):
    path = root / 'package.json'
    package = json.loads(path.read_text())
    expected = {'elysia', 'node-html-parser', 'puppeteer-extra-plugin-stealth', 'puppeteer-real-browser', 'ws'}
    if set(package.get('dependencies', {})) != expected:
        raise ValueError('Unexpected upstream dependency set')
    if any('puppeteer' in p.read_text() for p in (root / 'src').rglob('*.ts')):
        raise ValueError('Runtime unexpectedly requires browser tooling')
    for name in ('puppeteer-extra-plugin-stealth', 'puppeteer-real-browser'):
        del package['dependencies'][name]
    package.pop('devDependencies', None)
    package.pop('scripts', None)
    path.write_text(json.dumps(package, indent=2) + '\n')

if __name__ == '__main__':
    root, archive = map(pathlib.Path, sys.argv[1:])
    if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != PIN:
        raise SystemExit('Unexpected malq revision')
    if any(p.is_symlink() for p in root.rglob('*')):
        raise SystemExit('Unexpected source symlink')
    if hashlib.sha256(archive.read_bytes()).hexdigest() != BUN_SHA256:
        raise SystemExit('Bun checksum mismatch')
    patch(root)
    production_package(root)
