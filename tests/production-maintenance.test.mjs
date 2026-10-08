import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const workflow = readFileSync('.github/workflows/production-maintenance.yml', 'utf8')

test('maintenance is manual, main-only, approval-gated and read-only to GitHub', () => {
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule|workflow_run):/m)
  assert.match(workflow, /github.ref == 'refs\/heads\/main' && inputs.approve_production_changes/)
  assert.match(workflow, /name: production-maintenance/)
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /contents: write|secrets: inherit|type: string/)
  assert.match(workflow, /StrictHostKeyChecking=yes/)
  assert.doesNotMatch(workflow, /ssh-keyscan|set -x|continue-on-error/)
  assert.match(workflow, /secrets.TMDB_API_READ_TOKEN/)
})

test('environment merge preserves unrelated configuration and replaces only owned keys', () => {
  execFileSync('python3', ['-c', `
import importlib.util
spec=importlib.util.spec_from_file_location('maintenance','scripts/maintenance/production-config.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
original='# keep\\nDATABASE_URL="file:private.db"\\nexport STRATUS_API_KEY=old\\nOTHER=unchanged\\nSTRATUS_API_KEY=duplicate\\nTMDB_API_KEY=legacy\\n'
u=dict(zip(m.KEYS, ('synthetic.token.fixture', 'a'*64, 'http://127.0.0.1:4400')))
r=m.merge_env(original,u)
assert r.startswith('# keep\\nDATABASE_URL="file:private.db"\\nOTHER=unchanged\\nTMDB_API_KEY=legacy\\n')
assert r.count('STRATUS_API_KEY=')==1
assert 'old' not in r and 'duplicate' not in r
try: m.merge_env(original,{**u,'UNRELATED':'bad'})
except ValueError: pass
else: raise AssertionError('unknown keys accepted')
try: m.merge_env(original,{**u,'STRATUS_API_KEY':'unsafe\\ninjection'})
except ValueError: pass
else: raise AssertionError('multiline value accepted')
`])
})

test('malq patches fail closed and enforce loopback and TLS validation', () => {
  execFileSync('python3', ['-c', `
import importlib.util,pathlib,tempfile
spec=importlib.util.spec_from_file_location('prepare','scripts/maintenance/prepare-malq.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d);(p/'src/util/waf').mkdir(parents=True)
 (p/'src/main.ts').write_text('app.listen(4400, () => {')
 (p/'src/util/util.ts').write_text('return fetch(url, options);')
 (p/'src/util/waf/createClient.ts').write_text(('rejectUnauthorized: false, checkServerIdentity: () => undefined, '*2)+"proxySocket.on('connect', () => {")
 m.patch(p)
 assert 'hostname: "127.0.0.1"' in (p/'src/main.ts').read_text()
 text=(p/'src/util/waf/createClient.ts').read_text()
 assert 'rejectUnauthorized: false' not in text and text.count('tls.checkServerIdentity')==2
 assert "'secureConnect'" in text
 assert 'rejectUnauthorized: true' in (p/'src/util/util.ts').read_text()
 try: m.patch(p)
 except ValueError: pass
 else: raise AssertionError('changed source accepted')
`])
})

test('only unused upstream browser tooling is excluded from the locked API install', () => {
  execFileSync('python3', ['-c', `
import importlib.util,pathlib,tempfile,json
spec=importlib.util.spec_from_file_location('prepare','scripts/maintenance/prepare-malq.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d);(p/'src').mkdir()
 deps=dict.fromkeys(['elysia','node-html-parser','puppeteer-extra-plugin-stealth','puppeteer-real-browser','ws'],'fixture')
 original={'dependencies':deps,'scripts':{'pull':'unsafe'},'devDependencies':{'typescript':'fixture'}}
 (p/'package.json').write_text(json.dumps(original));m.production_package(p)
 package=json.loads((p/'package.json').read_text())
 assert set(package['dependencies'])=={'elysia','node-html-parser','ws'}
 assert 'scripts' not in package and 'devDependencies' not in package
 (p/'package.json').write_text(json.dumps(original));(p/'src/main.ts').write_text('import x from "puppeteer-real-browser"')
 try: m.production_package(p)
 except ValueError: pass
 else: raise AssertionError('active runtime dependency pruned')
`])
})
