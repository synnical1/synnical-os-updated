// Transport-agnostic stratus cloud-gaming core (ported from the standalone
// api.js). Synnical mounts its HTTP/WebSocket adapter in server.ts;
// this module owns provider transport, sessions and lifecycle only.
//
// Synnical adaptation: the HTTP adapter binds every session to an authenticated
// account; UUID possession is never authorization. See UPSTREAM.md for differences.
const { randomUUID, createDecipheriv } = require("crypto");
const { WebSocket: ProviderWebSocket } = require("ws");


if (!globalThis.crypto) globalThis.crypto = require("crypto").webcrypto;

function createStratusCore(options = {}) {
const WebSocket = options.WebSocket || ProviderWebSocket;
const RACCOON_HOST = "www.raccoongame.com";
const RACCOON_TIMEOUT_MS = 20_000;
const RACCOON_BROWSER_MODEL = process.env.RACCOON_BROWSER_MODEL || "Chrome/150.0.0.0";
const RACCOON_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${RACCOON_BROWSER_MODEL} Safari/537.36`;
class GameProviderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
let providerCooldownUntil = 0;
let mailUnavailableUntil = 0;
let mailState = "unknown";
let disposed = false;
const timers = new Set();
function retryAfterMs(response, fallback = 60_000) {
  const value = response.headers.get("retry-after");
  if (!value) return fallback;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(value) - Date.now()) || fallback;
}
async function fetchWithTimeout(url, opts = {}, ms = RACCOON_TIMEOUT_MS) {
  if (disposed && !String(url).endsWith("/jyapi/stopGame")) throw new GameProviderError("GAME_SHUTDOWN", "Cloud Games is restarting.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await (options.fetch || globalThis.fetch)(url, { ...opts, signal: ctrl.signal }); }
  catch (cause) {
    const mail = String(url).startsWith(MAIL_HOST);
    const code = mail ? "GAME_MAIL_UNAVAILABLE" : cause?.name === "AbortError" ? "GAME_PROVIDER_TIMEOUT" : "GAME_PROVIDER_NETWORK";
    if (mail) { mailState = "unavailable"; mailUnavailableUntil = Date.now() + 60_000; }
    throw new GameProviderError(code, mail ? "Cloud Games mailbox service is unavailable. Try again later." : "Cloud-game provider could not be reached.");
  } finally { clearTimeout(timer); }
}
// Preserve hostname TLS verification; never retry with a literal CDN address.
async function raccoonFetch(pathAndQuery, opts = {}) {
  const { timeoutMs = RACCOON_TIMEOUT_MS, ...rest } = opts;
  if (providerCooldownUntil > Date.now()) throw new GameProviderError("GAME_PROVIDER_VERIFICATION_COOLDOWN", "Cloud-game provider is cooling down. Try again later.");
  const response = await fetchWithTimeout(`https://${RACCOON_HOST}${pathAndQuery}`, rest, timeoutMs);
  if (!response.ok) {
    if (response.status === 429) providerCooldownUntil = Date.now() + retryAfterMs(response);
    throw new GameProviderError(`GAME_PROVIDER_HTTP_${response.status}`, `Cloud-game provider request failed (HTTP ${response.status}).`);
  }
  return response;
}
function bounded(value, fallback, min, max) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}
// ── malq (self-hosted temp mail, see services/malq) ────────────────────────
const MAIL_HOST = options.malqUrl || process.env.STRATUS_MALQ_URL || "http://127.0.0.1:4400";
let mailConfigured = false;
try {
  const mailUrl = new URL(MAIL_HOST);
  mailConfigured = mailUrl.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(mailUrl.hostname) && !mailUrl.username && !mailUrl.password && mailUrl.pathname === "/" && !mailUrl.search && !mailUrl.hash;
} catch {}
const MAIL_TIMEOUT_MS = 10_000;

// malq answers non-2xx as a JSON `{ error }` body rather than mail.tm's
// text/html, but still 429s if the underlying provider it picked is rate
// limited, so the shape of this wrapper (status + retryAfterMs surfaced to
// callers) carries over unchanged.
async function mailFetch(pathAndQuery, opts = {}, ms = MAIL_TIMEOUT_MS) {
  if (!mailConfigured) throw new GameProviderError("GAME_MAIL_CONFIG_INVALID", "Cloud Games mailbox service is not configured safely.");
  if (mailUnavailableUntil > Date.now()) throw new GameProviderError("GAME_MAIL_UNAVAILABLE", "Cloud Games mailbox service is unavailable. Try again later.");
  const res = await fetchWithTimeout(`${MAIL_HOST}${pathAndQuery}`, opts, ms);
  if (!res.ok) {
    if (res.status === 429) {
      providerCooldownUntil = Date.now() + retryAfterMs(res);
      throw new GameProviderError("GAME_MAIL_COOLDOWN", "Mailbox provider asked us to wait. Try again later.");
    }
    mailState = "unavailable"; mailUnavailableUntil = Date.now() + 60_000;
    throw new GameProviderError(`GAME_MAIL_HTTP_${res.status}`, `Cloud Games mailbox service failed (HTTP ${res.status}).`);
  }
  mailState = "available";
  try { return await res.json(); }
  catch { throw new GameProviderError("GAME_MAIL_INVALID_RESPONSE", "Cloud Games mailbox service returned an invalid response."); }
}

const MAX_SESSION_SECONDS = bounded(process.env.STRATUS_MAX_SESSION_SECONDS, 1140, 60, 1200);
const MAX_CONCURRENT_SESSIONS = bounded(process.env.STRATUS_MAX_CONCURRENT_SESSIONS, 8, 1, 25);
// Native websocket send queues are not represented by Bun's JS heap. Cloud
// signaling messages are small (SDP/candidates), so a peer with more than
// this much unread data is stalled, not merely slow.
const MAX_SIGNAL_BUFFERED_BYTES = 1 * 1024 * 1024;

const sessions = new Map(); // uuid → session
const ipLimits = new Map(); // ip → timestamp[]
const embedIpLimits = new Map(); // ip → timestamp[]
let creatingCount = 0; // in-flight account creations (throttles malq/raccoon)

function decryptPayload(result) {
  const key = Buffer.from("fd39e724f7c1e4b3d34bc7c72b5349c3", "utf8");
  const iv = Buffer.from("dd39e4a3337fe25a", "utf8");
  const d = createDecipheriv("aes-256-cbc", key, iv);
  const raw = d.update(result, "base64", "utf8") + d.final("utf8");
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object")
    throw new Error("decryptPayload: unexpected shape");
  return parsed;
}

function generateSN() {
  return randomUUID().replace(/-/g, "").toLowerCase();
}

function generatePassword() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
  let p = "";
  for (let i = 0; i < 12; i++)
    p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

// The old loop was "30 attempts, sleep 3s each". Attempt count is not a time
// budget: each attempt also carried the 20s fetch timeout, so a mail.tm that
// accepted connections and then stalled stretched this to ~11 minutes with the
// user's session pinned in `creating` the whole time. Bound it by the clock
// instead, poll immediately rather than sleeping first, and report what
// actually went wrong.
const VERIFY_TIMEOUT_MS = 60_000;
const VERIFY_POLL_MIN_MS = 1_000;
const VERIFY_POLL_MAX_MS = 3_000;
const VERIFY_MAX_MESSAGES = 5;

async function getVerificationCode(mailToken, deadline) {
  const until = Math.min(
    deadline ?? Date.now() + VERIFY_TIMEOUT_MS,
    Date.now() + VERIFY_TIMEOUT_MS,
  );
  const startedAt = Date.now();
  let attempts = 0;
  let lastError = null;
  let wait = VERIFY_POLL_MIN_MS;

  // Always check at least once, even if the steps before this already ate the
  // budget — otherwise a slow registration reports "the mailbox stayed empty"
  // having never actually looked at it.
  for (;;) {
    attempts++;
    try {
      // malq's inbox endpoint returns full message bodies up front, unlike
      // mail.tm's summary-then-fetch shape, so there's no second request
      // per message here.
      const { mail } = await mailFetch(
        `/api/v1/inbox/${encodeURIComponent(mailToken)}`, {}, Math.max(1, Math.min(MAIL_TIMEOUT_MS, until - Date.now())),
      );
      for (const msg of (mail || []).slice(0, VERIFY_MAX_MESSAGES)) {
        const text = [msg?.subject, msg?.body].flat().filter(v => typeof v === "string").join(" ").replace(/<[^>]*>/g, " ");
        const compactBody = text.replace(/(\d)\s+(?=\d)/g, "$1");
        const match = compactBody.match(/\b\d{6}\b/);
        if (match) return match[0];
      }
    } catch (e) {
      lastError = e;
      if (e.code) throw e;
      logApi(`verify: check ${attempts} failed — ${e.message}`);
    }
    const remaining = until - Date.now();
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(wait, remaining)));
    wait = Math.min(Math.round(wait * 1.5), VERIFY_POLL_MAX_MS);
  }

  const secs = Math.round((Date.now() - startedAt) / 1000);
  const err = new GameProviderError("GAME_MAIL_VERIFICATION_TIMEOUT",
    lastError
      ? `Verification code never arrived after ${secs}s (${attempts} checks) — mailbox errors, last: ${lastError.message}`
      : `Verification code never arrived after ${secs}s (${attempts} checks) — mailbox stayed empty, so the upstream never sent it`,
  );
  if (lastError?.service) err.service = lastError.service;
  throw err;
}

// ── Account pool ────────────────────────────────────────────────────────────
// Pre-creates accounts in the background so the first user doesn't wait for
// malq email verification (5-7 s). fillPool() is called at startup and
// each time an account is consumed from the pool.
const POOL_TARGET = options.accountPoolAllowed === false || !mailConfigured || process.env.STRATUS_DISABLE_ACCOUNT_POOL === "true" ? 0 : bounded(process.env.STRATUS_ACCOUNT_POOL_TARGET, 0, 0, MAX_CONCURRENT_SESSIONS);
// A pooled account is only useful while its login cookie is still good, and an
// account that has sat unused for half an hour is more likely to fail at
// playGame than to save anyone time.
const POOL_MAX_AGE_MS = 30 * 60_000;
const POOL_RETRY_MIN_MS = 15_000;
const POOL_RETRY_MAX_MS = 5 * 60_000;
const POOL_LOCAL_MAIL_RETRY_MS = 60_000;
// Keep a small gap between successful registrations so pool refill does not
// burst requests at Raccoon, while still taking advantage of self-hosted malq.
const POOL_SPACING_MS = 250;

const pool = []; // { sn, token, createdAt }[]
let poolFilling = false;
let poolRetryMs = POOL_RETRY_MIN_MS;
let poolRetryTimer = null;
let poolRetryAt = 0;
let lastPoolError = null;

// The old fillPool() `break`s out on the first error and is only ever called
// again when an account is consumed — so if upstream was down at startup the
// pool stayed empty for the life of the process and every single user paid the
// full on-demand account creation. Retry on a backoff instead.
function scheduleRefill(delayMs) {
  if (disposed || POOL_TARGET === 0) return;
  delayMs = Math.max(delayMs, providerCooldownUntil - Date.now(), mailUnavailableUntil - Date.now());
  const retryAt = Date.now() + delayMs;
  if (poolRetryTimer && poolRetryAt <= retryAt) return;
  if (poolRetryTimer) clearTimeout(poolRetryTimer);
  poolRetryAt = retryAt;
  poolRetryTimer = setTimeout(() => {
    poolRetryTimer = null;
    poolRetryAt = 0;
    fillPool().catch(() => {});
  }, delayMs);
  poolRetryTimer.unref?.();
}

async function fillPool() {
  if (disposed || poolFilling || poolRetryAt > Date.now() || providerCooldownUntil > Date.now() || pool.length >= POOL_TARGET) return;
  poolFilling = true;
  try {
    while (!disposed && pool.length < POOL_TARGET) {
      try {
        const acc = await createAccountRaw();
        if (disposed) return;
        pool.push({ ...acc, createdAt: Date.now() });
        lastPoolError = null;
        poolRetryMs = POOL_RETRY_MIN_MS;
        logApi(`pool: ready (${pool.length}/${POOL_TARGET})`);
      } catch (e) {
        lastPoolError = e.message;
        const retryMs = e.service === "malq" ? POOL_LOCAL_MAIL_RETRY_MS : poolRetryMs;
        logApi(
          `pool: fill error — ${e.message}; retrying in ${Math.round(retryMs / 1000)}s`,
        );
        scheduleRefill(retryMs);
        if (e.service !== "malq")
          poolRetryMs = Math.min(poolRetryMs * 2, POOL_RETRY_MAX_MS);
        return;
      }
      if (pool.length < POOL_TARGET)
        await new Promise((r) => setTimeout(r, POOL_SPACING_MS));
    }
  } finally {
    poolFilling = false;
  }
}

function takeFromPool() {
  while (pool.length) {
    const acc = pool.shift();
    if (Date.now() - acc.createdAt < POOL_MAX_AGE_MS) return acc;
    logApi("pool: discarded stale account");
  }
  return null;
}

async function createAccount() {
  if (providerCooldownUntil > Date.now()) throw new GameProviderError("GAME_PROVIDER_VERIFICATION_COOLDOWN", "Cloud-game provider is cooling down. Try again later.");
  const pooled = takeFromPool();
  if (pooled) {
    logApi(`pool: served account (${pool.length} remaining)`);
    fillPool().catch(() => {});
    return { sn: pooled.sn, token: pooled.token, pooled: true };
  }
  logApi(
    `pool: miss — creating account on demand${lastPoolError ? ` (last pool error: ${lastPoolError})` : ""}`,
  );
  try {
    const acc = await createAccountRaw();
    fillPool().catch(() => {});
    return acc;
  } catch (e) {
    // Don't immediately re-attempt a fill through the same failing upstream —
    // that just burns the rate limit the next user needs.
    lastPoolError = e.message;
    scheduleRefill(e.service === "malq" ? POOL_LOCAL_MAIL_RETRY_MS : poolRetryMs);
    throw e;
  }
}

// Keep the pool warm even with no traffic; no-ops when it is already full or a
// fill is in flight.
const warmTimer = setInterval(() => { if (POOL_TARGET > 0) fillPool().catch(() => {}); }, 60_000);
timers.add(warmTimer); warmTimer.unref?.();

// Account creation touches two upstreams and used to have no overall ceiling
// at all, so a single slow step could hold a session in `creating` far past
// anything a waiting user would sit through.
const ACCOUNT_CREATE_TIMEOUT_MS = 90_000;

// Raccoon replies with a JSON envelope carrying its own `status`. The register
// path ignored both the HTTP status and that envelope, so a refused
// sendEmail — blocked disposable domain, rate limit, upstream 5xx — looked
// exactly like success and the failure only surfaced a minute later as a
// verification-code timeout, pointing at the wrong service entirely.
async function raccoonStep(label, pathAndQuery, opts, deadline) {
  const budget = deadline ? deadline - Date.now() : Infinity;
  if (budget <= 0)
    throw new Error(`${label} skipped — account creation budget exhausted`);
  const res = await raccoonFetch(pathAndQuery, {
    ...opts,
    ...(Number.isFinite(budget)
      ? { timeoutMs: Math.min(RACCOON_TIMEOUT_MS, budget) }
      : {}),
  });
  const body = await res.text();
  if (!res.ok) throw new GameProviderError("GAME_PROVIDER_REQUEST_FAILED", "Cloud-game provider request failed.");
  let data = null;
  try {
    data = JSON.parse(body);
  } catch {
    // Not every endpoint is guaranteed to answer JSON; a 2xx is enough.
    logApi(`${label}: invalid provider response`);
    return null;
  }
  if (typeof data?.status === "number" && ![200, 201].includes(data.status)) {
    if (/too frequently|minute|cooldown/i.test(String(data.msg || "")) || data.status === 429) {
      providerCooldownUntil = Date.now() + retryAfterMs(res, 65_000);
      throw new GameProviderError("GAME_PROVIDER_VERIFICATION_COOLDOWN", "Cloud-game provider asked us to wait. Try again later.");
    }
    throw new GameProviderError("GAME_PROVIDER_REQUEST_REJECTED", "Cloud-game provider rejected account setup.");
  }
  return data;
}

// One mailbox and one registration attempt. Never rotate mailboxes to evade
// a rejection, exhausted quota or provider cooldown.
const MAX_MAIL_ATTEMPTS = 1;

async function createAccountRaw() {
  const startedAt = Date.now();
  const deadline = startedAt + ACCOUNT_CREATE_TIMEOUT_MS;

  const raccoonPassword = generatePassword();
  const sn = generateSN();

  const h = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/147.0.0.0 Safari/537.36",
  };
  const base = {
    sn,
    model: "Chrome/147.0.0.0",
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
  };

  let email, code, lastVerifyError;
  for (let attempt = 1; attempt <= MAX_MAIL_ATTEMPTS; attempt++) {
    // malq picks the domain/provider and creates the inbox itself; no
    // separate account+password step like mail.tm required.
    const session = await mailFetch("/api/v1/session");
    email = session?.address;
    const mailToken = session?.token;
    if (!email || !mailToken) throw new Error("malq returned no session");

    await raccoonStep(
      "sendEmail",
      "/users/sendEmail",
      {
        method: "POST",
        headers: h,
        body: new URLSearchParams({ email, type: "register", ...base }),
      },
      deadline,
    );

    // Keep verification within the overall account-creation deadline.
    const attemptsLeft = MAX_MAIL_ATTEMPTS - attempt + 1;
    const attemptDeadline = Math.min(
      deadline,
      Date.now() + Math.floor((deadline - Date.now()) / attemptsLeft),
    );

    try {
      code = await getVerificationCode(mailToken, attemptDeadline);
      lastVerifyError = null;
      break;
    } catch (e) {
      lastVerifyError = e;
    }
  }
  if (lastVerifyError) throw lastVerifyError;

  await raccoonStep(
    "emailRegister",
    "/users/emailRegister",
    {
      method: "POST",
      headers: h,
      body: new URLSearchParams({
        email,
        code,
        password: raccoonPassword,
        phone: "1",
        country: "Brazil",
        ...base,
      }),
    },
    deadline,
  );

  const loginBudget = deadline - Date.now();
  if (loginBudget <= 0) throw new GameProviderError("GAME_PROVIDER_TIMEOUT", "Cloud-game account creation timed out.");
  const loginRes = await raccoonFetch("/users/emailLogin", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, password: raccoonPassword, ...base }),
    timeoutMs: Math.min(RACCOON_TIMEOUT_MS, loginBudget),
  });
  const loginBody = await loginRes.text();
  let loginData = null;
  try {
    loginData = JSON.parse(loginBody);
  } catch {}
  if (!loginRes.ok || loginData?.status !== 200) throw new GameProviderError("GAME_PROVIDER_LOGIN_FAILED", "Cloud-game provider login failed.");

  let userToken = loginData.data?.user_token || "";
  const cookie = loginRes.headers.get("set-cookie");
  if (cookie) {
    const m = cookie.match(/as_user_token=([^;]+)/);
    if (m) userToken = m[1];
  }
  // A blank token gets past every check here and only fails later at
  // checkCost/playGame, where it reads as a game problem rather than a
  // registration one.
  if (!userToken) throw new Error("emailLogin returned no user token");

  logApi(`account created in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  return { sn, token: userToken };
}

function gameHeaders(token) {
  return {
    accept: "*/*",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie: `as_user_token=${token}`,
    origin: "https://www.raccoongame.com",
    referer: "https://www.raccoongame.com/",
    "user-agent": RACCOON_USER_AGENT,
    "x-requested-with": "XMLHttpRequest",
  };
}

// checkCost can return first-party launch parameters that Raccoon's web client
// forwards to playGame. Keep only bounded scalar values so provider data cannot
// inject arbitrary nested structures or unbounded request bodies.
function providerPlayParams(value) {
  const output = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_;-]{1,64}$/.test(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof raw)) continue;
    const scalar = String(raw);
    if (scalar.length <= 2048) output[key] = scalar;
  }
  return output;
}

function gameCommon(session) {
  return {
    sn: session.sn,
    model: RACCOON_BROWSER_MODEL,
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
    manufacturer: "",
    user_token: session.token,
  };
}

async function refreshFreePlayData(session) {
  const response = await raccoonFetch("/userGame/checkCost", {
    method: "POST",
    headers: gameHeaders(session.token),
    body: new URLSearchParams({ ...gameCommon(session), game_key: session.game_key }),
  });
  const data = await response.json().catch(() => null);
  // checkCost is advisory for the web launch path. A non-200 provider status
  // must not be re-labelled as a paid-product requirement. We still let the
  // first-party playGame endpoint decide whether a free session can start.
  if (data?.status === 200 && typeof data.data?.remain_times === "number" && data.data.remain_times <= 0) throw new GameProviderError("GAME_PROVIDER_QUOTA_EXHAUSTED", "Cloud-game provider quota has been exhausted.");
  session.providerPlayData = data?.status === 200
    ? providerPlayParams(data.data?.play_data)
    : {};
  return data;
}

async function requestFreeGame(session, extra = {}, options = {}) {
  const includePlayData = options.includePlayData !== false;
  const response = await raccoonFetch("/jyapi/playGame", {
    method: "POST",
    headers: gameHeaders(session.token),
    body: new URLSearchParams({
      ...(includePlayData ? providerPlayParams(session.providerPlayData) : {}),
      ...gameCommon(session),
      game_key: session.game_key,
      model_name: RACCOON_BROWSER_MODEL,
      ...extra,
    }),
  });
  const payload = await response.json().catch(() => null);
  session.last_provider_status = payload?.status ?? null;
  session.last_provider_message = payload?.status === 4623 ? "Free machines busy; waiting for an available cloud-game host." : "Waiting for cloud-game provider.";
  return payload;
}

function parseGameLaunch(playData) {
  if (
    playData?.status === 201 ||
    (playData?.status === 200 && playData.data?.play_queue_id)
  ) {
    const qid = playData.data?.play_queue_id;
    if (!qid) throw new GameProviderError("GAME_PROVIDER_QUEUE_ID_MISSING", "Cloud-game provider returned a queue response without a queue id.");
    return {
      state: "queued",
      queue_id: qid,
      initial_pos: Number.isFinite(Number(playData.data?.queue_pos)) ? Number(playData.data.queue_pos) : 1,
    };
  }
  if (playData?.status === 200 && playData.data?.result) {
    return { state: "ready", server_data: decryptPayload(playData.data.result) };
  }
  if (playData?.status === 4623) {
    return { state: "provider_wait", provider_status: 4623 };
  }
  return null;
}

async function doInitGame(session) {
  // Keep checkCost's current first-party launch data, because the provider can
  // rotate those fields between attempts. A 4623 response is not terminal: the
  // provider can return it while a free web slot is being prepared.
  await refreshFreePlayData(session);
  let playData = await requestFreeGame(session);
  let parsed = parseGameLaunch(playData);
  if (parsed && parsed.state !== "provider_wait") return parsed;

  if (!parsed) throw new GameProviderError("GAME_PROVIDER_PLAY_REJECTED", "Cloud-game provider rejected the launch.");

  // The original Stratus web flow did not forward checkCost play_data to
  // playGame. Some provider/game combinations still expect that request shape,
  // so on 4623 (or an otherwise unknown response) make one compatibility
  // attempt before entering the provider-wait state. This is NOT account
  // rotation or queue bypassing; it is the original request shape on the same
  // account/session.
  playData = await requestFreeGame(session, {}, { includePlayData: false });
  const legacyParsed = parseGameLaunch(playData);
  if (legacyParsed) return legacyParsed;

  throw new GameProviderError(
    "GAME_PROVIDER_PLAY_REJECTED",
    `Cloud-game provider rejected the free-session launch (status ${String(playData?.status ?? "unknown")}).`,
  );
}

async function doPollQueue(session, queue_id) {
  const { sn, token } = session;
  const d = await (
    await raccoonFetch("/jyapi/playQueue", {
      method: "POST",
      headers: gameHeaders(token),
      body: new URLSearchParams({
        sn,
        model: RACCOON_BROWSER_MODEL,
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        manufacturer: "",
        play_queue_id: queue_id,
        user_token: token,
      }),
    })
  ).json();
  if (d.status !== 200 && d.status !== 201)
    throw new GameProviderError("GAME_QUEUE_PROVIDER_ERROR", "Cloud-game provider rejected the queue request.");
  return d.data?.queue_pos ?? 1;
}

async function tryClaimGame(session, queue_id) {
  // Queue position 0 means the user reached the front, not necessarily that the
  // streaming machine has finished provisioning. The original Stratus claim
  // request omitted checkCost play_data, so try that exact shape first.
  let d = await requestFreeGame(
    session,
    { play_queue_id: queue_id },
    { includePlayData: false },
  );

  if (d?.status === 200 && d.data?.result) {
    return { ready: true, server_data: decryptPayload(d.data.result) };
  }
  if (d?.status === 201) return { ready: false, provider_status: 201 };

  if (d?.status === 4623) {
    // Refresh provider-issued launch state and try the current web request shape
    // once. If it is still 4623, keep the SAME session alive and let getQueue
    // retry on its next poll instead of throwing GAME_FREE_SESSION_UNAVAILABLE.
    await refreshFreePlayData(session);
    d = await requestFreeGame(session, { play_queue_id: queue_id });
    if (d?.status === 200 && d.data?.result) {
      return { ready: true, server_data: decryptPayload(d.data.result) };
    }
    if (d?.status === 201 || d?.status === 4623) {
      return { ready: false, provider_status: d.status };
    }
  }

  throw new GameProviderError(
    "GAME_PROVIDER_CLAIM_REJECTED",
    `Cloud-game provider rejected the free-session claim (status ${String(d?.status ?? "unknown")}).`,
  );
}

async function doStopGame(session) {
  clearInterval(session.raccoonPingInterval);
  session.raccoonWs?.close();
  if (!session.sc_id) return;
  try {
    await raccoonFetch("/jyapi/stopGame", {
      method: "POST",
      headers: gameHeaders(session.token),
      body: new URLSearchParams({
        sn: session.sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
  } catch {}
}

async function doCost(session) {
  if (!session.sc_id) return;
  try {
    const res = await raccoonFetch("/userGame/cost", {
      method: "POST",
      headers: gameHeaders(session.token),
      body: new URLSearchParams({
        sn: session.sn,
        model: "Chrome/147.0.0.0",
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        "manufacturer;": "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
    const body = await res.json().catch(() => null);
    logApi(`doCost HTTP ${res.status}`);
    if (body?.status === 3013) {
      killSession(session.uuid, "upstream_terminated");
    }
  } catch (e) {
    logApi(`doCost error: ${e.message}`);
  }
}

function logApi(message) {
  (options.log || console.log)(`[stratus] ${message}`);
}

function checkIpLimit(store, ip, windowMs, max) {
  const now = Date.now();
  const hits = (store.get(ip) || []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  store.set(ip, hits);
  return true;
}

function countActiveSessions() {
  return sessions.size;
}

function acquireAccountSlot() {
  if (creatingCount >= MAX_CONCURRENT_SESSIONS * 2) return false;
  creatingCount++;
  return true;
}

function releaseAccountSlot() {
  creatingCount = Math.max(0, creatingCount - 1);
}

function applyServerData(session, sd) {
  session.sc_id = sd.sc_id || sd.play_id;
  session.bs_sc_id = sd.bs_sc_id || session.sc_id;
  session.bs_host = sd.bs_host;
  session.bs_token = sd.token;
  session.channel_id = sd.channel_id;
  session.gl_key = sd.gl_key;
  session.play_config = sd.play_config;
  session.turns = sd.turns || [];
  try {
    const signal = new URL(sd.message_server?.url);
    if (signal.protocol !== "wss:" || signal.username || signal.password || ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(signal.hostname)) throw new Error();
  } catch { throw new GameProviderError("GAME_SIGNAL_INVALID", "Cloud-game provider returned an invalid signaling endpoint."); }
  session.message_server = sd.message_server;
}

function killSession(uuid, reason = "unknown") {
  const session = sessions.get(uuid);
  if (!session) return;

  clearTimeout(session.startgame_timeout);
  clearTimeout(session.queue_abandon_timeout);
  clearTimeout(session.ping_timeout);
  clearTimeout(session.session_timeout);
  clearInterval(session.costInterval);
  // The signaling socket and its keepalive were never cleaned up, so every
  // ended session left an open outbound websocket and a 30s timer holding a
  // reference to it for the life of the process.
  clearInterval(session.raccoonPingInterval);

  try {
    session.clientWs?.close(1000, reason);
  } catch {}
  try {
    session.raccoonWs?.close(1000, reason);
  } catch {}

  doStopGame(session).catch(() => {});
  sessions.delete(uuid);

  logApi(`session ${uuid.slice(0, 8)} killed — ${reason}`);
}

function resetPingTimeout(uuid) {
  const session = sessions.get(uuid);
  if (!session) return;
  clearTimeout(session.ping_timeout);
  session.ping_timeout = setTimeout(
    () => killSession(uuid, "ping_timeout"),
    30_000,
  );
}

const providerWaitEnvMs = Number(process.env.SYNNICAL_PROVIDER_WAIT_MAX_MS || 5 * 60_000);
const PROVIDER_WAIT_MAX_AGE = Number.isFinite(providerWaitEnvMs)
  ? Math.max(1_000, Math.min(30 * 60_000, Math.floor(providerWaitEnvMs)))
  : 5 * 60_000;
const PROVIDER_WAIT_REAPER_AGE = PROVIDER_WAIT_MAX_AGE + 2 * 60_000;
const REAPER_DEADLINES = {
  creating: 5 * 60_000,
  finished_queue: 2 * 60_000,
};
const QUEUED_MAX_AGE = 30 * 60_000;
const QUEUED_POLL_STALE_AFTER = 90_000;
const QUEUE_ABANDON_MS = 2 * 60_000;
const START_GAME_GRACE_MS = 60_000;

function providerWaitRetryMs(attempts) {
  const attempt = Math.max(1, Number(attempts) || 1);
  return Math.min(15_000, 5_000 + Math.floor((attempt - 1) / 2) * 2_500);
}

function providerWaitElapsedMs(session, now = Date.now()) {
  return Math.max(0, now - (session.provider_wait_started_at || session.created_at || now));
}

function providerWaitLimitLabel() {
  if (PROVIDER_WAIT_MAX_AGE < 60_000) {
    const seconds = Math.max(1, Math.ceil(PROVIDER_WAIT_MAX_AGE / 1000));
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.max(1, Math.ceil(PROVIDER_WAIT_MAX_AGE / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}


function reapSessions(now = Date.now()) {
  for (const [uuid, session] of sessions) {
    if (session.state === "queued") {
      const lastSeen = session.last_queue_poll_at ?? session.created_at;
      if (
        now - lastSeen > QUEUED_POLL_STALE_AFTER ||
        now - session.created_at > QUEUED_MAX_AGE
      ) {
        killSession(uuid, "reaper:queued_stale");
      }
      continue;
    }
    if (session.state === "provider_wait" && providerWaitElapsedMs(session, now) > PROVIDER_WAIT_REAPER_AGE) { killSession(uuid, "reaper:provider_wait_deadline"); continue; }
    const deadline = REAPER_DEADLINES[session.state];
    if (deadline !== undefined && now - (session.finished_queue_at ?? session.created_at) > deadline) {
      killSession(uuid, `reaper:${session.state}_deadline`);
      continue;
    }
    if (session.state === "active" && !session.session_timeout) {
      killSession(uuid, "reaper:active_no_timeout");
    }
  }
}
const reaperTimer = setInterval(reapSessions, 2 * 60_000); timers.add(reaperTimer); reaperTimer.unref?.();

// Periodically prune the per-IP rate-limit windows.
const ipGcTimer = setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, timestamps] of ipLimits.entries()) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) ipLimits.delete(ip);
    else ipLimits.set(ip, recent);
  }
  for (const [ip, timestamps] of embedIpLimits.entries()) {
    const recent = timestamps.filter((t) => t > cutoff);
    if (recent.length === 0) embedIpLimits.delete(ip);
    else embedIpLimits.set(ip, recent);
  }
}, 60_000); timers.add(ipGcTimer); ipGcTimer.unref?.();

// ── Raccoon signaling proxy (per session) ───────────────────────────────────
function connectRaccoonSignaling(session) {
  const { sn, gl_key, play_config, uuid } = session;

  const raccoonWs = new WebSocket(session.message_server.url, {
    perMessageDeflate: false,
    maxPayload: MAX_SIGNAL_BUFFERED_BYTES,
  });
  session.raccoonWs = raccoonWs;

  const endStalledSession = () => {
    // terminate() discards queued native buffers immediately; close() waits
    // for those buffers to drain and is therefore the wrong operation here.
    try { session.clientWs?.terminate(); } catch {}
    try { raccoonWs.terminate(); } catch {}
    killSession(uuid, "signal_backpressure");
  };
  const rSend = (p) => {
    if (raccoonWs.readyState !== WebSocket.OPEN) return;
    if (raccoonWs.bufferedAmount > MAX_SIGNAL_BUFFERED_BYTES)
      return endStalledSession();
    raccoonWs.send(JSON.stringify(p));
  };
  const toClient = (data) => {
    const cws = session.clientWs;
    if (cws?.readyState !== WebSocket.OPEN) return;
    if (cws.bufferedAmount > MAX_SIGNAL_BUFFERED_BYTES)
      return endStalledSession();
    cws.send(JSON.stringify(data));
  };

  raccoonWs.on("open", () => {
    rSend({
      id: "register",
      type: "webUA",
      uid: sn,
      token: decodeURIComponent(session.message_server.token),
    });
    session.raccoonPingInterval = setInterval(() => {
      rSend({
        id: "ping",
        uid: sn,
        type: "webUA",
        status: "gaming",
        sc_id: session.bs_sc_id,
      });
    }, 30_000);
  });

  raccoonWs.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) return;

    switch (data.id) {
      case "register_ack":
        if (data.code === 200) {
          rSend({
            id: "start_game",
            from: sn,
            to: gl_key,
            game_args: "",
            gp_num: 0,
            play_config,
            simpleHandler: null,
            body: {
              force_soft_dec: 0,
              session_id: session.bs_sc_id,
              sn_user_id: sn,
              game_name: null,
              joystick_num: 2,
            },
          });
        }
        break;

      case "start_game":
        if (data.from === gl_key && data.body?.code === 200) {
          toClient({ type: "game_ready" });
        }
        break;

      case "rtc_sdp": {
        const b = data.body;
        if (!b) break;
        try {
          if (b.type === "answer") {
            toClient({ type: "rtc_answer", sdp: b });
          } else if (b.type === "candidate" && b.sdp) {
            toClient({ type: "rtc_candidate", candidate: b.sdp });
          }
        } catch {}
        break;
      }
    }
  });

  raccoonWs.on("close", () => clearInterval(session.raccoonPingInterval));
  raccoonWs.on("error", () => logApi(`signal error on ${uuid.slice(0, 8)}`));
}


if (POOL_TARGET > 0 && process.env.STRATUS_DISABLE_ACCOUNT_POOL !== "true") fillPool().catch(() => {});
function shutdown() {
  disposed = true;
  clearTimeout(poolRetryTimer);
  for (const timer of timers) clearInterval(timer);
  timers.clear();
  for (const uuid of sessions.keys()) killSession(uuid, "shutdown");
  pool.length = 0;
}
return { WebSocket, MAX_SESSION_SECONDS, MAX_CONCURRENT_SESSIONS, MAX_SIGNAL_BUFFERED_BYTES,
  sessions, ipLimits, embedIpLimits, checkIpLimit, countActiveSessions, acquireAccountSlot,
  releaseAccountSlot, createAccount, doInitGame, doPollQueue, tryClaimGame, doCost,
  applyServerData, killSession, resetPingTimeout, connectRaccoonSignaling, reapSessions,
  PROVIDER_WAIT_MAX_AGE, QUEUE_ABANDON_MS, START_GAME_GRACE_MS,
  providerWaitRetryMs, providerWaitElapsedMs, providerWaitLimitLabel, shutdown,
  dependencyStatus: () => ({ mail: mailConfigured ? mailState : "invalid", pool_target: POOL_TARGET, cooldown: providerCooldownUntil > Date.now() }) };
}
module.exports = { createStratusCore };
