const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { createCipheriv } = require('crypto')

process.env.NODE_PATH = path.join(process.cwd(), 'node_modules')
process.env.SYNNICAL_PROVIDER_WAIT_MAX_MS = '1200'
Module._initPaths()

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function encryptedServerData() {
  const key = Buffer.from('fd39e724f7c1e4b3d34bc7c72b5349c3', 'utf8')
  const iv = Buffer.from('dd39e4a3337fe25a', 'utf8')
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const payload = JSON.stringify({
    sc_id: 'sc-test-1',
    bs_sc_id: 'bs-sc-test-1',
    bs_host: 'stream.test',
    token: 'stream-token',
    channel_id: 'channel-1',
    gl_key: 'game-node-1',
    play_config: '{}',
    turns: [],
    message_server: { url: 'wss://signal.test/ws', token: 'signal-token' },
  })
  return cipher.update(payload, 'utf8', 'base64') + cipher.final('base64')
}

async function sleep(ms) { await new Promise((resolve) => setTimeout(resolve, ms)) }

// This is deliberately an end-to-end state-machine test. 4623 appears both
// before the queue and after queue position zero, exactly where the old code
// emitted GAME_FREE_SESSION_UNAVAILABLE. The same session must survive both.
test('4623 remains a live free-session state through provider wait and machine allocation', { timeout: 30_000 }, async () => {
  const realFetch = global.fetch
  const playBodies = []
  let checkCostCount = 0
  let playCount = 0
  let queuePollCount = 0

  global.fetch = async (url, opts = {}) => {
    const value = String(url)
    if (value.startsWith('http://127.0.0.1:')) return realFetch(url, opts)
    if (value === 'https://api.mail.gw/domains') return json({ 'hydra:member': [{ domain: 'mail.test', isActive: true }] })
    if (value === 'https://api.mail.gw/accounts') return json({}, 201)
    if (value === 'https://api.mail.gw/token') return json({ token: 'mail-jwt' })
    if (value === 'https://api.mail.gw/messages?page=1') return json({ 'hydra:member': [{ id: 'm1' }] })
    if (value === 'https://api.mail.gw/messages/m1') return json({ subject: 'Verification 123456', text: 'Your code is 123456' })
    if (value.endsWith('/users/sendEmail')) return json({ status: 200, msg: 'success' })
    if (value.endsWith('/users/emailRegister')) return json({ status: 200, msg: 'success' })
    if (value.endsWith('/users/emailLogin')) return json({ status: 200, msg: 'success', data: { user_token: 'free-token' } })
    if (value.endsWith('/userGame/checkCost')) {
      checkCostCount += 1
      return json({
        status: 200,
        msg: 'success',
        data: {
          remain_times: 1140,
          play_data: {
            free_ticket: `ticket-${checkCostCount}`,
            nested: { drop: true },
            huge: 'x'.repeat(2500),
          },
        },
      })
    }
    if (value.endsWith('/jyapi/playQueue')) {
      queuePollCount += 1
      return json({ status: 200, msg: 'success', data: { queue_pos: 0 } })
    }
    if (value.endsWith('/jyapi/playGame')) {
      playCount += 1
      const body = opts.body instanceof URLSearchParams ? opts.body.toString() : String(opts.body || '')
      playBodies.push(body)
      // Initial current-shape + legacy-shape request both say "not ready".
      if (playCount <= 2) return json({ status: 4623, msg: 'free host preparing', data: {} })
      // First getQueue provider-wait retry now obtains a real queue.
      if (playCount === 3) return json({ status: 201, msg: 'queued', data: { play_queue_id: 'queue-free-1', queue_pos: 1 } })
      // First position-zero claim uses legacy shape and still sees 4623.
      if (playCount === 4) return json({ status: 4623, msg: 'allocating machine', data: {} })
      // Refreshed current-shape claim is still allocating.
      if (playCount === 5) return json({ status: 201, msg: 'allocating', data: { play_queue_id: 'queue-free-1', queue_pos: 0 } })
      // Next poll/claim finally receives the encrypted streaming host.
      if (playCount === 6) return json({ status: 200, msg: 'success', data: { result: encryptedServerData() } })
      throw new Error(`Unexpected playGame attempt ${playCount}`)
    }
    if (value.endsWith('/jyapi/stopGame') || value.endsWith('/userGame/cost')) return json({ status: 200, data: {} })
    throw new Error(`Unexpected external fetch: ${value}`)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix16-stratus-r11-'))
  const sitesPath = path.join(tmp, 'sites.json')
  fs.writeFileSync(sitesPath, JSON.stringify({
    sites: {
      test: {
        api_key: 'test-key', enabled: true, max_concurrent_sessions: 2, max_session_seconds: 1140,
        limits: { per_minute: 60, per_hour: 1000, per_day: 10000, per_month: 100000 },
      },
    },
  }))

  const { createStratusApp } = require('../stratus/api.js')
  const stratus = createStratusApp({ sitesPath, publicDir: path.resolve(__dirname, '../stratus/public'), basePath: '/api/games' })
  const server = http.createServer(stratus.app)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })

  try {
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    const created = await realFetch(`${base}/cloud/v1/createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({ game_key: 'bs0049' }),
    })
    const createBody = await created.text()
    const createRows = createBody.trim().split(/\n+/).map((line) => JSON.parse(line))
    const first = createRows.at(-1)

    assert.equal(created.status, 200)
    assert.equal(createRows.some((row) => row.status === 'error'), false, createBody)
    assert.equal(first.status, 'provider_wait')
    assert.equal(first.queue_pos, 0)
    assert.ok(first.uuid)
    assert.doesNotMatch(createBody, /GAME_FREE_SESSION_UNAVAILABLE/)

    const headers = { 'x-api-key': 'test-key' }
    const q1 = await (await realFetch(`${base}/cloud/v1/getQueue?uuid=${first.uuid}`, { headers })).json()
    assert.equal(q1.status, 'queue')
    assert.equal(q1.queue_pos, 1)

    await sleep(3_100)
    const q2res = await realFetch(`${base}/cloud/v1/getQueue?uuid=${first.uuid}`, { headers })
    const q2 = await q2res.json()
    assert.equal(q2res.status, 200, JSON.stringify(q2))
    assert.equal(q2.status, 'allocating')
    assert.equal(q2.queue_pos, 0)
    assert.equal(q2.provider_status, 201)

    await sleep(3_100)
    const q3res = await realFetch(`${base}/cloud/v1/getQueue?uuid=${first.uuid}`, { headers })
    const q3 = await q3res.json()
    assert.equal(q3res.status, 200, JSON.stringify(q3))
    assert.equal(q3.status, 'finished_queue')

    assert.equal(checkCostCount, 3)
    assert.equal(queuePollCount, 2)
    assert.equal(playCount, 6)
    assert.match(playBodies[0], /free_ticket=ticket-1/)
    assert.doesNotMatch(playBodies[1], /free_ticket=/, 'legacy init attempt should omit checkCost play_data')
    assert.doesNotMatch(playBodies[3], /free_ticket=/, 'first queue claim should use the original legacy claim shape')
    assert.match(playBodies[4], /free_ticket=ticket-3/, 'refreshed claim should have current first-party play_data')
    assert.equal(playBodies.some((entry) => /(?:nested|huge)=/.test(entry)), false)
    assert.doesNotMatch(createBody, /membership/i)
  } finally {
    stratus.shutdown()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tmp, { recursive: true, force: true })
    global.fetch = realFetch
  }
})


test('provider wait is bounded when the upstream never exposes a free slot', { timeout: 15_000 }, async () => {
  const realFetch = global.fetch
  let playCount = 0

  global.fetch = async (url, opts = {}) => {
    const value = String(url)
    if (value.startsWith('http://127.0.0.1:')) return realFetch(url, opts)
    if (value === 'https://api.mail.gw/domains') return json({ 'hydra:member': [{ domain: 'mail.test', isActive: true }] })
    if (value === 'https://api.mail.gw/accounts') return json({}, 201)
    if (value === 'https://api.mail.gw/token') return json({ token: 'mail-jwt' })
    if (value === 'https://api.mail.gw/messages?page=1') return json({ 'hydra:member': [{ id: 'm1' }] })
    if (value === 'https://api.mail.gw/messages/m1') return json({ subject: 'Verification 123456', text: 'Your code is 123456' })
    if (value.endsWith('/users/sendEmail')) return json({ status: 200, msg: 'success' })
    if (value.endsWith('/users/emailRegister')) return json({ status: 200, msg: 'success' })
    if (value.endsWith('/users/emailLogin')) return json({ status: 200, msg: 'success', data: { user_token: 'free-token' } })
    if (value.endsWith('/userGame/checkCost')) return json({ status: 200, msg: 'success', data: { remain_times: 1140, play_data: { free_ticket: 'ticket-timeout' } } })
    if (value.endsWith('/jyapi/playGame')) {
      playCount += 1
      return json({ status: 4623, msg: 'all free machines busy', data: {} })
    }
    if (value.endsWith('/jyapi/stopGame') || value.endsWith('/userGame/cost')) return json({ status: 200, data: {} })
    throw new Error(`Unexpected external fetch: ${value}`)
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix16-stratus-r14-timeout-'))
  const sitesPath = path.join(tmp, 'sites.json')
  fs.writeFileSync(sitesPath, JSON.stringify({
    sites: {
      test: {
        api_key: 'test-key', enabled: true, max_concurrent_sessions: 2, max_session_seconds: 1140,
        limits: { per_minute: 60, per_hour: 1000, per_day: 10000, per_month: 100000 },
      },
    },
  }))

  delete require.cache[require.resolve('../stratus/api.js')]
  const { createStratusApp } = require('../stratus/api.js')
  const stratus = createStratusApp({ sitesPath, publicDir: path.resolve(__dirname, '../stratus/public'), basePath: '/api/games' })
  const server = http.createServer(stratus.app)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })

  try {
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`
    const created = await realFetch(`${base}/cloud/v1/createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
      body: JSON.stringify({ game_key: 'bs0049' }),
    })
    const rows = (await created.text()).trim().split(/\n+/).map((line) => JSON.parse(line))
    const first = rows.at(-1)
    assert.equal(first.status, 'provider_wait')
    assert.ok(first.uuid)
    assert.ok(first.retry_after_ms >= 5_000)

    await sleep(1_300)
    const timedOut = await realFetch(`${base}/cloud/v1/getQueue?uuid=${first.uuid}`, { headers: { 'x-api-key': 'test-key' } })
    const body = await timedOut.json()
    assert.equal(timedOut.status, 503, JSON.stringify(body))
    assert.equal(body.code, 'GAME_FREE_SLOT_TIMEOUT')
    assert.match(body.error, /upstream provider is at capacity/i)
    assert.ok(body.waited_seconds >= 1)
    assert.equal(body.provider_status, 4623)
    assert.match(body.provider_message, /free machines busy/i)
    assert.equal(body.retry_after_seconds, 60)
    assert.ok(playCount >= 2, 'initial current + legacy provider attempts should have occurred')

    const after = await realFetch(`${base}/cloud/v1/getQueue?uuid=${first.uuid}`, { headers: { 'x-api-key': 'test-key' } })
    assert.equal(after.status, 404, 'timed-out provider wait must be destroyed, not left polling forever')
  } finally {
    stratus.shutdown()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(tmp, { recursive: true, force: true })
    global.fetch = realFetch
  }
})
