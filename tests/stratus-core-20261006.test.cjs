const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const http = require("node:http");
const path = require("node:path");
const { createCipheriv } = require("node:crypto");
const { WebSocket } = require("ws");
const { createStratusCore } = require("../stratus/core.cjs");
const { createStratusApp } = require("../stratus/api.js");

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
class ProviderSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  static instances = [];
  constructor() { super(); ProviderSocket.instances.push(this); queueMicrotask(() => this.emit("open")); }
  send() {}
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
}
function serverPayload() {
  // Public upstream wire-format constants, not a Synnical authorization key.
  const cipher = createCipheriv("aes-256-cbc", Buffer.from("fd39e724f7c1e4b3d34bc7c72b5349c3"), Buffer.from("dd39e4a3337fe25a"));
  return cipher.update(JSON.stringify({ sc_id: "fixture-stream", gl_key: "fixture-node", turns: [], message_server: { url: "wss://signal.test/ws", token: "fixture-signal" } }), "utf8", "base64") + cipher.final("base64");
}
function fixtureFetch(url) {
  if (String(url).endsWith("/api/v1/session")) return Promise.resolve(json({ address: "fixture@mail.test", token: "fixture-mail" }));
  if (String(url).includes("/api/v1/inbox/")) return Promise.resolve(json({ mail: [{ subject: "Code", body: "<b>1 2 3 4 5 6</b>" }] }));
  if (String(url).endsWith("/users/emailLogin")) return Promise.resolve(json({ status: 200, data: { user_token: "fixture-provider" } }));
  if (String(url).endsWith("/userGame/checkCost")) return Promise.resolve(json({ status: 200, data: { remain_times: 1140 } }));
  if (String(url).endsWith("/jyapi/playGame")) return Promise.resolve(json({ status: 200, data: { result: serverPayload() } }));
  if (/\/(users\/(sendEmail|emailRegister)|jyapi\/stopGame|userGame\/cost)$/.test(String(url))) return Promise.resolve(json({ status: 200 }));
  throw new Error("Unexpected fixture fetch");
}

test("core fails cleanly for missing/unsafe malq and suppresses retry storms without leaking errors", async () => {
  let calls = 0;
  const log = [];
  const core = createStratusCore({ fetch: async () => { calls++; throw new Error("fixture-private-value"); }, log: line => log.push(line) });
  try {
    for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(core.createAccount(), error => error.code === "GAME_MAIL_UNAVAILABLE" && !error.message.includes("fixture-private-value"));
    assert.equal(calls, 1);
    assert.equal(core.dependencyStatus().mail, "unavailable");
    assert.equal(core.dependencyStatus().pool_target, 0);
    assert.doesNotMatch(log.join("\n"), /fixture-private-value/);
  } finally { core.shutdown(); }
  const unsafe = createStratusCore({ malqUrl: "https://external.test/", fetch: () => { throw new Error("must never fetch"); }, log() {} });
  try {
    await assert.rejects(unsafe.createAccount(), error => error.code === "GAME_MAIL_CONFIG_INVALID");
    assert.equal(unsafe.dependencyStatus().mail, "invalid");
  } finally { unsafe.shutdown(); }
});

test("provider cooldown halts account creation without rotating mailbox or resending verification", async () => {
  let mails = 0;
  let sends = 0;
  const core = createStratusCore({ log() {}, fetch: async (url) => {
    if (String(url).endsWith("/api/v1/session")) { mails++; return json({ address: "fixture@mail.test", token: "fixture-mail" }); }
    sends++; return json({ status: 429, msg: "fixture-private-value" }, 429, { "retry-after": "120" });
  } });
  try {
    await assert.rejects(core.createAccount(), error => error.code === "GAME_PROVIDER_HTTP_429" && !error.message.includes("fixture-private-value"));
    await assert.rejects(core.createAccount(), error => error.code === "GAME_PROVIDER_VERIFICATION_COOLDOWN");
    assert.equal(mails, 1); assert.equal(sends, 1);
    assert.equal(core.dependencyStatus().cooldown, true);
  } finally { core.shutdown(); }
});

test("opt-in pool respects Retry-After and resumes the same authorized flow after cooldown", async (t) => {
  const previous = process.env.STRATUS_ACCOUNT_POOL_TARGET;
  process.env.STRATUS_ACCOUNT_POOL_TARGET = "1";
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1_800_000_000_000 });
  let sends = 0;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const drain = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  const core = createStratusCore({ log(line) { if (line.includes("pool: ready")) resolveReady(); }, fetch: async (url) => {
    if (String(url).endsWith("/users/sendEmail") && ++sends === 1) return json({ status: 429 }, 429, { "retry-after": "120" });
    return fixtureFetch(url);
  } });
  try {
    await drain();
    assert.equal(sends, 1);
    t.mock.timers.tick(119_999); await drain();
    assert.equal(sends, 1, "no retry before upstream cooldown expires");
    t.mock.timers.tick(1); await drain();
    assert.equal(sends, 2);
    await ready;
    const account = await core.createAccount();
    assert.equal(account.pooled, true);
    assert.equal(account.token, "fixture-provider");
  } finally {
    core.shutdown(); t.mock.timers.reset();
    if (previous === undefined) delete process.env.STRATUS_ACCOUNT_POOL_TARGET;
    else process.env.STRATUS_ACCOUNT_POOL_TARGET = previous;
  }
});

test("core retains conservative limits, reaps stale sessions and rejects provider quota exhaustion", async () => {
  const core = createStratusCore({ log() {}, fetch: fixtureFetch });
  try {
    assert.equal(core.MAX_CONCURRENT_SESSIONS, 8);
    assert.equal(core.MAX_SESSION_SECONDS, 1140);
    const account = await core.createAccount();
    assert.equal(account.token, "fixture-provider");
    assert.match(account.sn, /^[0-9a-f]{32}$/);
  } finally { core.shutdown(); }
  const reaper = createStratusCore({ log() {}, fetch: fixtureFetch });
  try {
    const now = Date.now();
    for (const state of ["creating", "queued", "finished_queue", "active", "provider_wait"]) reaper.sessions.set(state, { uuid: state, state, created_at: now - 60 * 60_000 });
    reaper.reapSessions(now);
    assert.equal(reaper.sessions.size, 0);
  } finally { reaper.shutdown(); }
  const quota = createStratusCore({ log() {}, fetch: async () => json({ status: 200, data: { remain_times: 0 } }) });
  try { await assert.rejects(quota.doInitGame({}), error => error.code === "GAME_PROVIDER_QUOTA_EXHAUSTED"); }
  finally { quota.shutdown(); }
});

test("adapter binds HTTP and signaling to creator account; terminated UUIDs cannot be reused", { timeout: 15_000 }, async () => {
  ProviderSocket.instances.length = 0;
  const adapter = createStratusApp({ requireUserIdentity: true, apiKey: "fixture-server-only-key", sitesPath: path.resolve("stratus/sites.synnical.json"), publicDir: path.resolve("stratus/public"), coreOptions: { fetch: fixtureFetch, WebSocket: ProviderSocket, log() {} } });
  const server = http.createServer(adapter.app);
  server.on("upgrade", (req, socket, head) => {
    // Test-only trusted identity injector, never accepted from browser headers.
    req.headers["x-synnical-user-id"] = new URL(req.url, "http://fixture").searchParams.get("fixtureAccount");
    adapter.handleUpgrade(req, socket, head);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const own = { "content-type": "application/json", "x-api-key": "fixture-server-only-key", "x-synnical-user-id": "fixture-account-a" };
  const foreign = { ...own, "x-synnical-user-id": "fixture-account-b" };
  let client;
  try {
    const denied = await fetch(`${base}/cloud/v1/createSession`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ game_key: "bs0049" }) });
    assert.equal(denied.status, 401);
    const create = await fetch(`${base}/cloud/v1/createSession`, { method: "POST", headers: own, body: JSON.stringify({ game_key: "bs0049" }) });
    const text = await create.text();
    const final = JSON.parse(text.trim().split("\n").at(-1));
    assert.equal(final.status, "finished_queue");
    assert.doesNotMatch(text, /fixture-server-only-key|fixture-provider|fixture-mail/);
    const uuid = final.uuid;
    assert.equal((await fetch(`${base}/cloud/v1/getQueue?uuid=${uuid}`, { headers: foreign })).status, 403);
    for (const operation of ["startGame", "pingSession", "quitSession"]) assert.equal((await fetch(`${base}/cloud/v1/${operation}`, { method: "POST", headers: foreign, body: JSON.stringify({ uuid }) })).status, 403);
    for (const operation of ["embed", "embed-data"]) assert.equal((await fetch(`${base}/cloud/v1/${operation}?id=${uuid}`, { headers: foreign })).status, 404);
    const started = await fetch(`${base}/cloud/v1/startGame`, { method: "POST", headers: own, body: JSON.stringify({ uuid }) });
    assert.equal(started.status, 200);
    assert.equal((await started.json()).max_seconds, 1140);
    assert.equal((await fetch(`${base}/cloud/v1/embed-data?id=${uuid}`, { headers: own })).status, 200);
    const deniedWs = new WebSocket(base.replace("http:", "ws:") + `/api/games/cloud/v1/signal/${uuid}?fixtureAccount=fixture-account-b`);
    await new Promise(resolve => { deniedWs.on("error", resolve); deniedWs.on("open", () => assert.fail("Foreign signaling accepted")); });
    client = new WebSocket(base.replace("http:", "ws:") + `/api/games/cloud/v1/signal/${uuid}?fixtureAccount=fixture-account-a`);
    await once(client, "open");
    const upstream = ProviderSocket.instances.at(-1);
    upstream.emit("message", Buffer.from("null"));
    client.send("null");
    client.send("[]");
    upstream.bufferedAmount = 2 * 1024 * 1024;
    const closed = once(client, "close");
    client.send(JSON.stringify({ type: "rtc_offer", sdp: "fixture" }));
    await closed;
    assert.equal((await fetch(`${base}/cloud/v1/getQueue?uuid=${uuid}`, { headers: own })).status, 404);
    assert.equal((await fetch(`${base}/cloud/v1/startGame`, { method: "POST", headers: own, body: JSON.stringify({ uuid }) })).status, 404);
  } finally { client?.terminate(); adapter.shutdown(); await new Promise(resolve => server.close(resolve)); }
});
