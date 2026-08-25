/**
 * Stratus cloud-gaming API — Synnical integration.
 *
 * This is a refactor of the original standalone `api/api.js` from the
 * `stratus-api-main` package. The original file called `httpServer.listen(PORT)`
 * and bound everything to a fixed port. Synnical already runs a custom HTTP
 * server (`server.ts`) that hosts Next.js + Socket.IO, so we cannot let stratus
 * own a port. Instead we expose:
 *
 *   createStratusApp({ basePath, sitesPath, publicDir }) -> {
 *     app,                 // express sub-app — mount under the synnical server
 *     handleUpgrade(req),  // call from the synnical HTTP server 'upgrade' event
 *                          // returns true if the upgrade was handled (stratus WS)
 *     shutdown(),          // clears intervals (called on synnical shutdown)
 *   }
 *
 * All paths inside stratus are relative to `basePath`. Defaults to `/api/games`
 * so the public surface becomes:
 *
 *   POST /api/games/cloud/v1/createSession
 *   GET  /api/games/cloud/v1/getQueue
 *   POST /api/games/cloud/v1/startGame
 *   POST /api/games/cloud/v1/pingSession
 *   POST /api/games/cloud/v1/quitSession
 *   GET  /api/games/cloud/v1/embed
 *   GET  /api/games/cloud/v1/embed-data
 *   WS   /api/games/cloud/v1/signal/:uuid
 *
 * NOTE: This file is intentionally CommonJS so it can require() chalk / ws /
 * express without ESM interop headaches. Synnical's server.ts loads it via
 * createRequire(import.meta.url).
 */

const express = require("express");
const { randomUUID, createDecipheriv, webcrypto } = require("crypto");
const { readFileSync, existsSync } = require("fs");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");
const chalk = require("chalk");

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STRATUS_BASE_PATH = "/api/games"; // Mount point inside synnical
const RACCOON_HOST = "www.raccoongame.com";
const RACCOON_TIMEOUT_MS = 20_000;
const RACCOON_BROWSER_MODEL = process.env.RACCOON_BROWSER_MODEL || "Chrome/150.0.0.0";
const RACCOON_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${RACCOON_BROWSER_MODEL} Safari/537.36`;
const GAME_MAIL_API_BASE = ["https://api.mail.gw", "https://api.mail.tm"].includes(process.env.GAME_MAIL_API_BASE)
  ? process.env.GAME_MAIL_API_BASE
  : "https://api.mail.gw";
// Restore the original advertised session duration.
const MAX_SESSION_SECONDS = 19 * 60;
// Do not pre-create accounts to skip the provider's normal queue/setup flow.
// A value of zero keeps the pool disabled; sessions use the on-demand path.
const POOL_TARGET = 0;

class GameProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameProviderError";
    this.code = code;
  }
}

function providerName(url) {
  try {
    const host = new URL(url).hostname;
    if (host === "api.mail.tm" || host === "api.mail.gw") return "Mailbox provider";
    if (host === RACCOON_HOST) return "Cloud-game provider";
    return host;
  } catch {
    return "Upstream provider";
  }
}

function providerCode(url, cause) {
  const service = /api\.mail\.(?:tm|gw)/.test(String(url)) ? "GAME_MAIL" : "GAME_PROVIDER";
  const causeCode = cause?.cause?.code || cause?.code || "";
  if (cause?.name === "AbortError") return `${service}_TIMEOUT`;
  if (causeCode === "ENOTFOUND" || causeCode === "EAI_AGAIN") return `${service}_DNS`;
  if (causeCode === "ECONNREFUSED") return `${service}_REFUSED`;
  if (causeCode === "ECONNRESET") return `${service}_RESET`;
  if (causeCode === "ETIMEDOUT") return `${service}_TIMEOUT`;
  if (causeCode === "CERT_HAS_EXPIRED" || causeCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") return `${service}_TLS`;
  return `${service}_NETWORK`;
}

async function fetchWithTimeout(url, opts = {}, ms = RACCOON_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (cause) {
    const code = providerCode(url, cause);
    const detail = cause?.cause?.code || cause?.code || cause?.name || "unknown";
    throw new GameProviderError(code, `${providerName(url)} request failed (${detail}).`);
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(response, fallbackMs) {
  const raw = response.headers.get("retry-after");
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallbackMs;
}

/**
 * Mail.tm sometimes returns a short-lived 429/5xx. Retry those responses only,
 * honouring a reasonable Retry-After. Do not rotate addresses or hammer 4xx
 * responses: those are persistent rejection/rate-policy signals that must be
 * surfaced to the operator instead of being evaded.
 */
async function mailTmRequest(pathname, options, operation) {
  const url = `${GAME_MAIL_API_BASE}${pathname}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await fetchWithTimeout(url, options);
    if (response.ok) return response;

    const transient = response.status === 429 || response.status >= 500;
    const waitMs = retryAfterMs(response, attempt * 1000);
    await response.arrayBuffer().catch(() => {});
    if (transient && attempt < 2 && waitMs <= 15_000) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const suffix = response.status === 429 && waitMs > 0
      ? ` Retry after ${Math.ceil(waitMs / 1000)} second(s).`
      : "";
    throw new GameProviderError(
      `GAME_MAIL_${operation}_HTTP_${response.status}`,
      `Mailbox provider ${operation.toLowerCase()} failed (HTTP ${response.status}).${suffix}`,
    );
  }
  throw new GameProviderError(`GAME_MAIL_${operation}_FAILED`, `Mailbox provider ${operation.toLowerCase()} failed.`);
}

// raccoonFetch: always use the hostname directly.
// The previous IP-bypass approach (resolving DNS → connecting to raw IP with
// Host header) caused TypeError: fetch failed because www.raccoongame.com is
// behind Cloudflare — TLS certs are issued to the hostname, not the CDN IP,
// so Node's fetch rejects the connection with a cert mismatch before a byte
// of HTTP is sent. Hostname-based HTTPS lets TLS complete normally.
async function raccoonFetch(pathAndQuery, opts = {}) {
  return fetchWithTimeout(`https://${RACCOON_HOST}${pathAndQuery}`, opts);
}

// ---------------------------------------------------------------------------
// In-memory state (per synnical process)
// ---------------------------------------------------------------------------

const sessions = new Map();
const siteUsage = new Map();
const ipLimits = new Map();
const embedIpLimits = new Map();
const accountCreating = new Map();
let providerVerificationCooldownUntil = 0;

const pool = [];
let poolFilling = false;

// ---------------------------------------------------------------------------
// Crypto / Mail.tm helpers
// ---------------------------------------------------------------------------

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

async function getVerificationCode(mailJwt, maxRetries = 40) {
  const headers = {
    Authorization: `Bearer ${mailJwt}`,
    "Content-Type": "application/json",
  };
  let lastProviderError = null;
  for (let i = 0; i < maxRetries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await mailTmRequest("/messages?page=1", {
        headers,
      }, "MESSAGES");
      const data = await res.json().catch(() => null);
      if (data?.["hydra:member"]?.length > 0) {
        // The newest item is not always the provider verification email. Scan
        // several messages, and handle Mail.tm's documented `html: string[]`
        // shape instead of calling .replace() on an array and swallowing it.
        for (const message of data["hydra:member"].slice(0, 5)) {
          if (!message?.id) continue;
          const fullRes = await mailTmRequest(`/messages/${encodeURIComponent(message.id)}`, { headers }, "MESSAGE");
          const full = await fullRes.json().catch(() => null);
          if (!full) continue;
          const html = Array.isArray(full.html) ? full.html.join(" ") : full.html;
          const body = [full.subject, full.intro, full.text, html]
            .filter((value) => typeof value === "string")
            .join(" ")
            .replace(/<[^>]*>/g, " ");
          const compactBody = body.replace(/(\d)\s+(?=\d)/g, "$1");
          const match = compactBody.match(/(?:^|\D)(\d{6})(?!\d)/);
          if (match) return match[1];
        }
      }
    } catch (error) {
      if (error?.code) lastProviderError = error;
    }
  }
  if (lastProviderError) throw lastProviderError;
  throw new GameProviderError("GAME_MAIL_VERIFICATION_TIMEOUT", "The verification email did not arrive before the provider timeout.");
}

// ---------------------------------------------------------------------------
// Raccoon account pool
// ---------------------------------------------------------------------------

async function fillPool() {
  if (poolFilling) return;
  const needed = POOL_TARGET - pool.length;
  if (needed <= 0) return;
  poolFilling = true;
  try {
    for (let i = 0; i < needed; i++) {
      try {
        const acc = await createAccountRaw();
        pool.push(acc);
        logSys(chalk.gray(`pool: ready (${pool.length}/${POOL_TARGET})`));
      } catch (e) {
        logSys(chalk.red(`pool: fill error — ${e.message}`));
        break;
      }
    }
  } finally {
    poolFilling = false;
  }
}

async function createAccount() {
  if (pool.length > 0) {
    const acc = pool.shift();
    logSys(chalk.gray(`pool: served account (${pool.length} remaining)`));
    fillPool().catch(() => {});
    return acc;
  }
  logSys(chalk.gray("pool: miss — creating account on demand"));
  const acc = await createAccountRaw();
  fillPool().catch(() => {});
  return acc;
}

async function sendProviderVerification(email, headers, base) {
  const now = Date.now();
  if (providerVerificationCooldownUntil > now) {
    const seconds = Math.max(1, Math.ceil((providerVerificationCooldownUntil - now) / 1000));
    throw new GameProviderError("GAME_PROVIDER_VERIFICATION_COOLDOWN", `Verification provider is cooling down. Retry in ${seconds} second(s).`);
  }
  const sendEmailRes = await raccoonFetch("/users/sendEmail", {
    method: "POST",
    headers,
    body: new URLSearchParams({ email, type: "register", ...base }),
  });
  const sendEmailData = await sendEmailRes.json().catch(() => null);
  if (!sendEmailRes.ok || sendEmailData?.status !== 200) {
    const providerMessage = String(sendEmailData?.msg || sendEmailData?.message || "Cloud-game provider rejected the verification request.");
    if (/too frequently|try again in\s*1\s*minute|minute/i.test(providerMessage)) {
      providerVerificationCooldownUntil = Date.now() + 65_000;
      throw new GameProviderError("GAME_PROVIDER_VERIFICATION_COOLDOWN", "Verification provider asked us to wait one minute before sending another code.");
    }
    throw new GameProviderError(`GAME_PROVIDER_SEND_EMAIL_${sendEmailRes.status}`, providerMessage);
  }
  // A successful send should not globally cool down every later launch. The
  // mailbox polling path owns this account's verification flow; only an actual
  // provider "wait" response should trip the shared cooldown above.
}

async function createAccountRaw() {
  const domainData = await (
    await mailTmRequest("/domains", {}, "DOMAINS")
  ).json().catch(() => null);
  if (!domainData?.["hydra:member"]?.length)
    throw new GameProviderError("GAME_MAIL_NO_DOMAINS", "Mailbox provider returned no usable domains.");
  const domain = domainData["hydra:member"].find((item) => item?.isActive !== false)?.domain;
  if (!domain) throw new GameProviderError("GAME_MAIL_NO_ACTIVE_DOMAIN", "Mailbox provider returned no active domain.");

  const mailUser = `rcn_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const email = `${mailUser}@${domain}`;
  const mailPassword = generatePassword();
  const raccoonPassword = generatePassword();
  const sn = generateSN();

  await mailTmRequest("/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPassword }),
  }, "ACCOUNT_CREATE");

  const tokenRes = await mailTmRequest("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: email, password: mailPassword }),
  }, "TOKEN");
  const { token: mailJwt } = await tokenRes.json().catch(() => ({}));
  if (!mailJwt) throw new GameProviderError("GAME_MAIL_TOKEN_INVALID", "Mailbox provider returned an invalid access token.");

  const h = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": RACCOON_USER_AGENT,
  };
  const base = {
    sn,
    model: RACCOON_BROWSER_MODEL,
    version_code: "1",
    version_name: "1.0.0",
    device_name: "我的设备",
    os: "web",
  };

  await sendProviderVerification(email, h, base);

  // One send, then patient polling. Resending while delivery is merely slow is
  // what triggered the provider's "sent too frequently" response and can also
  // invalidate the first code before it reaches Mail.tm.
  const code = await getVerificationCode(mailJwt, 40);

  const registerRes = await raccoonFetch("/users/emailRegister", {
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
  });
  const registerData = await registerRes.json().catch(() => null);
  if (!registerRes.ok || registerData?.status !== 200) {
    throw new GameProviderError(
      `GAME_PROVIDER_REGISTER_${registerRes.status}`,
      registerData?.msg || registerData?.message || "Cloud-game provider rejected account setup.",
    );
  }

  const loginRes = await raccoonFetch("/users/emailLogin", {
    method: "POST",
    headers: h,
    body: new URLSearchParams({ email, password: raccoonPassword, ...base }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok || loginData.status !== 200) {
    throw new GameProviderError(
      `GAME_PROVIDER_LOGIN_${loginRes.status}`,
      loginData?.msg || loginData?.message || "Cloud-game provider login failed.",
    );
  }

  let userToken = loginData.data?.user_token || "";
  const cookie = loginRes.headers.get("set-cookie");
  if (cookie) {
    const m = cookie.match(/as_user_token=([^;]+)/);
    if (m) userToken = m[1];
  }

  return { sn, token: userToken };
}

// ---------------------------------------------------------------------------
// Raccoon game-flow helpers
// ---------------------------------------------------------------------------

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
  session.last_provider_message = payload?.msg || payload?.message || "";
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
    throw new Error(`Queue poll rejected: ${JSON.stringify(d)}`);
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
        model: RACCOON_BROWSER_MODEL,
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        manufacturer: "",
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
        model: RACCOON_BROWSER_MODEL,
        version_code: "1",
        version_name: "1.0.0",
        device_name: "我的设备",
        os: "web",
        manufacturer: "",
        sc_id: String(session.sc_id),
        game_type: "1",
        user_token: session.token,
      }),
    });
    const body = await res.json().catch(() => null);
    logApi(
      session.api_key,
      chalk.gray(`doCost → ${res.status} ${JSON.stringify(body)}`),
    );
    if (body?.status === 3013) {
      killSession(session.uuid, "upstream_terminated");
    }
  } catch (e) {
    logApi(session.api_key, chalk.red(`doCost error: ${e.message}`));
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function timestamp() {
  const now = new Date();
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const date = now.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
  return chalk.blackBright(`[${time} ${date}]`);
}

function logApi(apiKey, message) {
  const name = getSiteName(apiKey) || "unknown";
  console.log(`${timestamp()} ${chalk.cyan(name)} ${message}`);
}

function logSys(message) {
  console.log(`${timestamp()} ${chalk.magenta("stratus")} ${message}`);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function getClientIp(req) {
  const caddy = req.headers["x-caddy-real-ip-is-here1357908642"];
  if (caddy) return caddy;
  const xf = req.headers["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function checkIpLimit(store, ip, windowMs, max) {
  const now = Date.now();
  const hits = (store.get(ip) || []).filter((t) => t > now - windowMs);
  if (hits.length >= max) return false;
  hits.push(now);
  store.set(ip, hits);
  return true;
}

function loadSitesConfig(sitesPath) {
  if (!existsSync(sitesPath)) {
    throw new Error(
      `stratus: sites.json not found at ${sitesPath}. Copy stratus/sites.json.example and configure it.`,
    );
  }
  const raw = readFileSync(sitesPath, "utf-8");
  // Strip JSONC-style // comments so users can annotate sites.json.
  // Handles URLs (https://...) by skipping // that follow a colon.
  const stripped = raw.replace(
    /(^|[^:])\/\/.*$/gm,
    (_, p) => p,
  );
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    throw new Error(`stratus: failed to parse sites.json: ${e.message}`);
  }
  if (!parsed?.sites || typeof parsed.sites !== "object") {
    throw new Error(
      "stratus: sites.json must have a top-level `sites` object.",
    );
  }
  return parsed;
}

function getSiteName(apiKey) {
  return (
    Object.keys(sites.sites).find((k) => sites.sites[k].api_key === apiKey) ||
    null
  );
}

function getSite(apiKey) {
  const name = getSiteName(apiKey);
  return name ? { name, ...sites.sites[name] } : null;
}

function checkRateLimit(apiKey, site) {
  const now = Date.now();
  const calls = siteUsage.get(apiKey) || [];

  const perMin = calls.filter((t) => t > now - 60_000).length;
  const perHour = calls.filter((t) => t > now - 3_600_000).length;
  const perDay = calls.filter((t) => t > now - 86_400_000).length;
  const perMonth = calls.filter((t) => t > now - 30 * 86_400_000).length;

  if (perMin >= site.limits.per_minute)
    return {
      allowed: false,
      reason: `per-minute limit (${site.limits.per_minute}/min)`,
    };
  if (perHour >= site.limits.per_hour)
    return {
      allowed: false,
      reason: `per-hour limit (${site.limits.per_hour}/hr)`,
    };
  if (perDay >= site.limits.per_day)
    return {
      allowed: false,
      reason: `per-day limit (${site.limits.per_day}/day)`,
    };
  if (perMonth >= site.limits.per_month)
    return {
      allowed: false,
      reason: `per-month limit (${site.limits.per_month}/month)`,
    };

  return { allowed: true };
}

function recordUsage(apiKey) {
  const now = Date.now();
  const calls = (siteUsage.get(apiKey) || []).filter(
    (t) => t > now - 30 * 86_400_000,
  );
  calls.push(now);
  siteUsage.set(apiKey, calls);
}

function getUsageStats(apiKey) {
  const now = Date.now();
  const calls = siteUsage.get(apiKey) || [];
  return {
    perMin: calls.filter((t) => t > now - 60_000).length,
    perHour: calls.filter((t) => t > now - 3_600_000).length,
    perDay: calls.filter((t) => t > now - 86_400_000).length,
    perMonth: calls.filter((t) => t > now - 30 * 86_400_000).length,
  };
}

function countActiveSessions(apiKey) {
  return [...sessions.values()].filter((s) => s.api_key === apiKey).length;
}

function acquireAccountSlot(apiKey, site) {
  const cap = (site.max_concurrent_sessions ?? 5) * 2;
  const current = accountCreating.get(apiKey) ?? 0;
  if (current >= cap) return false;
  accountCreating.set(apiKey, current + 1);
  return true;
}

function releaseAccountSlot(apiKey) {
  const current = accountCreating.get(apiKey) ?? 1;
  const next = current - 1;
  if (next <= 0) accountCreating.delete(apiKey);
  else accountCreating.set(apiKey, next);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function applyServerData(session, sd) {
  session.sc_id = sd.sc_id || sd.play_id;
  session.bs_sc_id = sd.bs_sc_id || session.sc_id;
  session.bs_host = sd.bs_host;
  session.bs_token = sd.token;
  session.channel_id = sd.channel_id;
  session.gl_key = sd.gl_key;
  session.play_config = sd.play_config;
  session.turns = sd.turns || [];
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

  try {
    session.clientWs?.close(1000, reason);
  } catch {}

  doStopGame(session).catch(() => {});
  sessions.delete(uuid);

  logApi(
    session.api_key,
    chalk.gray(`session ${chalk.white(uuid.slice(0, 8))} killed — ${reason}`),
  );
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

let reaperTimer = null;
function startReaper() {
  if (reaperTimer) return;
  reaperTimer = setInterval(() => {
    const now = Date.now();
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
      if (session.state === "provider_wait") {
        if (providerWaitElapsedMs(session, now) > PROVIDER_WAIT_REAPER_AGE) {
          killSession(uuid, "reaper:provider_wait_deadline");
        }
        continue;
      }
      const deadline = REAPER_DEADLINES[session.state];
      if (deadline !== undefined && now - session.created_at > deadline) {
        killSession(uuid, `reaper:${session.state}_deadline`);
        continue;
      }
      if (session.state === "active" && !session.session_timeout) {
        killSession(uuid, "reaper:active_no_timeout");
      }
    }
  }, 2 * 60_000);
  reaperTimer.unref?.();
}

let ipGcTimer = null;
function startIpGc() {
  if (ipGcTimer) return;
  ipGcTimer = setInterval(() => {
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
  }, 60_000);
  ipGcTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Raccoon signaling WS bridge
// ---------------------------------------------------------------------------

function connectRaccoonSignaling(session) {
  const { sn, gl_key, play_config, uuid } = session;

  const raccoonWs = new WebSocket(session.message_server.url);
  session.raccoonWs = raccoonWs;

  const rSend = (p) => {
    if (raccoonWs.readyState === WebSocket.OPEN)
      raccoonWs.send(JSON.stringify(p));
  };
  const toClient = (data) => {
    const cws = session.clientWs;
    if (cws?.readyState === WebSocket.OPEN) cws.send(JSON.stringify(data));
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
  raccoonWs.on("error", () =>
    logApi(session.api_key, chalk.red(`signal error on ${uuid.slice(0, 8)}`)),
  );
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function auth(req, res, next) {
  const apiKey =
    req.headers["x-api-key"] || req.body?.api_key || req.query?.api_key;
  if (!apiKey) return res.status(401).json({ error: "Missing API key." });
  const site = getSite(apiKey);
  if (!site) return res.status(401).json({ error: "Invalid API key." });
  if (!site.enabled)
    return res.status(403).json({ error: "API Key has been disabled." });
  req.site = site;
  req.apiKey = apiKey;
  next();
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

let sites = null; // populated by createStratusApp
let wss = null;
let signalPathRegex = null;

function createStratusApp(options = {}) {
  const basePath = (options.basePath || STRATUS_BASE_PATH).replace(/\/+$/, "");
  const sitesPath =
    options.sitesPath || path.join(__dirname, "sites.json");
  const publicDir =
    options.publicDir || path.join(__dirname, "public");

  // Load sites.json — required. Tolerates JSONC-style // comments so users
  // can annotate the file.
  sites = loadSitesConfig(sitesPath);

  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    const ip = getClientIp(req);
    if (!checkIpLimit(ipLimits, ip, 60_000, 100)) {
      return res.status(429).json({
        error: "Too many requests from this IP. Try again in a minute.",
      });
    }
    req.setTimeout(120_000, () => {
      res.status(408).json({ error: "Request timeout." });
    });
    next();
  });

  app.use(express.static(publicDir));

  // Routes — all paths are relative to basePath. The synnical server.ts strips
  // the basePath before dispatching, so stratus sees them as /cloud/v1/...

  app.get("/cloud/v1/embed", (req, res) => {
    if (!req.query.id) {
      return res
        .status(400)
        .type("text")
        .send("[GAME_EMBED_MISSING_ID] Missing `id` parameter");
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.sendFile(path.join(publicDir, "e.html"));
  });

  app.get("/cloud/v1/embed-data", (req, res) => {
    const ip = getClientIp(req);
    if (!checkIpLimit(embedIpLimits, ip, 60_000, 30)) {
      return res.status(429).json({ code: "GAME_EMBED_RATE_LIMIT", error: "Too many requests. Slow down." });
    }
    const { id } = req.query;
    if (!id) return res.status(400).json({ code: "GAME_EMBED_MISSING_ID", error: "Missing id." });
    const session = sessions.get(id);
    if (!session)
      return res.status(404).json({ code: "GAME_SESSION_NOT_FOUND", error: "Session not found or expired." });
    if (session.state !== "active")
      return res.status(409).json({ code: "GAME_SESSION_NOT_ACTIVE", error: `Session is '${session.state}', not active.` });
    res.json({
      code: "GAME_EMBED_READY",
      ice_servers: session.embed_ice_servers,
      signaling_ws: session.embed_signaling_ws,
      max_seconds: session.max_session_seconds,
    });
  });

  // Serve the full cloud games catalogue from cloud.json
  let cloudGamesCache = null;
  app.get("/cloud/v1/games", (req, res) => {
    if (!cloudGamesCache) {
      try {
        const cloudJsonPath = path.join(__dirname, "cloud.json");
        cloudGamesCache = JSON.parse(readFileSync(cloudJsonPath, "utf-8"));
      } catch (e) {
        return res.status(500).json({ error: "cloud.json not found" });
      }
    }
    res.json(cloudGamesCache);
  });

  app.post("/cloud/v1/createSession", auth, async (req, res) => {
    const { game_key } = req.body;
    if (!game_key || typeof game_key !== "string" || game_key.length > 256) {
      return res.status(400).json({ error: "Invalid game_key." });
    }

    const { site, apiKey } = req;

    if (countActiveSessions(apiKey) >= site.max_concurrent_sessions) {
      return res.status(429).json({
        error: `Concurrent session limit reached (max ${site.max_concurrent_sessions}).`,
      });
    }

    const rl = checkRateLimit(apiKey, site);
    if (!rl.allowed)
      return res
        .status(429)
        .json({ error: `Rate limit exceeded: ${rl.reason}.` });

    if (!acquireAccountSlot(apiKey, site)) {
      return res
        .status(429)
        .json({ error: "Too many sessions being created. Try again shortly." });
    }

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const push = (obj) => res.write(JSON.stringify(obj) + "\n");
    const uuid = randomUUID();

    const rawLimit = site.max_session_seconds ?? MAX_SESSION_SECONDS;
    const sessionLimit = Math.min(rawLimit, MAX_SESSION_SECONDS);

    const session = {
      uuid,
      api_key: apiKey,
      state: "creating",
      game_key,
      sn: "",
      token: "",
      providerPlayData: {},
      created_at: Date.now(),
      max_session_seconds: sessionLimit,
      last_queue_poll_at: null,
      last_ping_at: null,
      startgame_timeout: null,
      queue_abandon_timeout: null,
      ping_timeout: null,
      session_timeout: null,
      raccoonWs: null,
      raccoonPingInterval: null,
      clientWs: null,
      costInterval: null,
    };
    sessions.set(uuid, session);
    logApi(
      apiKey,
      `${chalk.gray("createSession")} ${chalk.white(game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
    );

    try {
      push({ status: "creating_account" });
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) push({ status: "creating_account" });
      }, 10_000);
      res.once("close", () => clearInterval(heartbeat));
      const acc = await createAccount();
      clearInterval(heartbeat);

      releaseAccountSlot(apiKey);

      if (!sessions.has(uuid)) return res.end();

      session.sn = acc.sn;
      session.token = acc.token;
      recordUsage(apiKey);

      push({ status: "account_ready" });
      push({ status: "requesting_game" });

      const init = await doInitGame(session);

      if (!sessions.has(uuid)) return res.end();

      if (init.state === "queued") {
        session.state = "queued";
        session.queue_id = init.queue_id;
        session.last_queue_pos = init.initial_pos ?? 1;
        session.queue_abandon_timeout = setTimeout(
          () => killSession(uuid, "queue_abandoned"),
          QUEUE_ABANDON_MS,
        );
        push({ status: "queue", uuid, queue_pos: session.last_queue_pos });
      } else if (init.state === "provider_wait") {
        // 4623 is a provider-side transitional state on the free web path. Keep
        // the session/account alive and retry through getQueue instead of
        // throwing GAME_FREE_SESSION_UNAVAILABLE after one retry.
        session.state = "provider_wait";
        session.provider_wait_started_at = Date.now();
        session.provider_wait_attempts = 1;
        session.last_queue_pos = 0;
        session.queue_abandon_timeout = setTimeout(
          () => killSession(uuid, "provider_wait_abandoned"),
          QUEUE_ABANDON_MS,
        );
        push({
          status: "provider_wait",
          uuid,
          queue_pos: 0,
          retry_after_ms: providerWaitRetryMs(session.provider_wait_attempts),
          waited_seconds: 0,
          wait_limit_seconds: Math.ceil(PROVIDER_WAIT_MAX_AGE / 1000),
          provider_status: session.last_provider_status,
          provider_message: session.last_provider_message || "",
        });
      } else {
        applyServerData(session, init.server_data);
        session.state = "finished_queue";
        session.finished_queue_at = Date.now();
        session.startgame_timeout = setTimeout(
          () => killSession(uuid, "startgame_timeout"),
          START_GAME_GRACE_MS,
        );
        push({
          status: "finished_queue",
          uuid,
          fetch_this_within_60s_or_terminate: `${basePath}/cloud/v1/startGame`,
        });
      }
    } catch (e) {
      releaseAccountSlot(apiKey);
      logApi(
        apiKey,
        chalk.red(
          `createSession ${chalk.white(uuid.slice(0, 8))} failed — ${String(e?.code || "GAME_SESSION_CREATE_FAILED")}: ${String(e?.message || "unknown error")}`,
        ),
      );
      push({ status: "error", code: e?.code || "GAME_SESSION_CREATE_FAILED", error: e?.message || "Game session creation failed." });
      killSession(uuid, "creation_error");
    }

    res.end();
  });

  app.get("/cloud/v1/getQueue", auth, async (req, res) => {
    const { uuid } = req.query;
    if (!uuid) return res.status(400).json({ error: "Missing uuid." });

    const session = sessions.get(uuid);
    if (!session)
      return res.status(404).json({ code: "GAME_SESSION_NOT_FOUND", error: "Session not found or expired." });
    if (session.api_key !== req.apiKey)
      return res.status(403).json({ error: "Forbidden." });

    // Queue requests can race the transition performed by startGame. Treat an
    // already-active session as a successful terminal state instead of an HTTP
    // 400 that makes the browser replace a working embed with an error.
    if (session.state === "active") {
      return res.json({ status: "active", uuid, queue_pos: 0 });
    }

    if (session.state !== "queued" && session.state !== "provider_wait" && session.state !== "finished_queue") {
      return res
        .status(409)
        .json({ code: "GAME_QUEUE_STATE_INVALID", error: `Session is '${session.state}', not pollable.` });
    }

    const now = Date.now();
    if (session.state === "provider_wait") {
      const waitedMs = providerWaitElapsedMs(session, now);
      if (waitedMs >= PROVIDER_WAIT_MAX_AGE) {
        const providerStatus = session.last_provider_status;
        const providerMessage = session.last_provider_message || "";
        killSession(uuid, "provider_wait_timeout");
        return res.status(503).json({
          code: "GAME_FREE_SLOT_TIMEOUT",
          error: `No free cloud slot became available within ${providerWaitLimitLabel()}. The upstream provider is at capacity; try this game again later.`,
          waited_seconds: Math.floor(waitedMs / 1000),
          provider_status: providerStatus,
          provider_message: providerMessage,
          retry_after_seconds: 60,
        });
      }
    }
    if (session.last_queue_poll_at && now - session.last_queue_poll_at < 3_000) {
      // Instead of returning a hard 429 (which the previous client treated as
      // a fatal error and tore down the session), return the LAST known queue
      // position. This is the correct behaviour for a "slow down" response —
      // the client gets useful data and continues polling at its own cadence.
      // We still record the poll attempt so repeated fast polls don't trip
      // the upstream raccoon API.
      const lastPos = session.last_queue_pos ?? 1;
      return res.json({
        status: session.state === "finished_queue"
          ? "finished_queue"
          : session.state === "provider_wait"
            ? "provider_wait"
            : "queue",
        queue_pos: lastPos,
        uuid,
        retry_after_ms: session.state === "provider_wait" ? providerWaitRetryMs(session.provider_wait_attempts) : 3_250,
        waited_seconds: session.state === "provider_wait" ? Math.floor(providerWaitElapsedMs(session, now) / 1000) : undefined,
        wait_limit_seconds: session.state === "provider_wait" ? Math.ceil(PROVIDER_WAIT_MAX_AGE / 1000) : undefined,
        provider_status: session.state === "provider_wait" ? session.last_provider_status : undefined,
        provider_message: session.state === "provider_wait" ? (session.last_provider_message || "") : undefined,
        fetch_this_within_60s_or_terminate:
          session.state === "finished_queue"
            ? `${basePath}/cloud/v1/startGame`
            : undefined,
      });
    }
    session.last_queue_poll_at = now;

    clearTimeout(session.queue_abandon_timeout);
    session.queue_abandon_timeout = setTimeout(
      () => killSession(uuid, "queue_abandoned"),
      QUEUE_ABANDON_MS,
    );

    if (session.state === "finished_queue") {
      return res.json({
        status: "finished_queue",
        uuid,
        fetch_this_within_60s_or_terminate: `${basePath}/cloud/v1/startGame`,
      });
    }

    if (session.state === "provider_wait") {
      try {
        const init = await doInitGame(session);
        if (init.state === "provider_wait") {
          session.provider_wait_attempts = (session.provider_wait_attempts || 1) + 1;
          const waitedSeconds = Math.floor(providerWaitElapsedMs(session) / 1000);
          return res.json({
            status: "provider_wait",
            uuid,
            queue_pos: 0,
            retry_after_ms: providerWaitRetryMs(session.provider_wait_attempts),
            waited_seconds: waitedSeconds,
            wait_limit_seconds: Math.ceil(PROVIDER_WAIT_MAX_AGE / 1000),
            provider_status: session.last_provider_status,
            provider_message: session.last_provider_message || "",
          });
        }
        if (init.state === "queued") {
          session.state = "queued";
          session.queue_id = init.queue_id;
          session.last_queue_pos = init.initial_pos ?? 1;
          return res.json({
            status: "queue",
            uuid,
            queue_pos: session.last_queue_pos,
            retry_after_ms: 3_250,
          });
        }
        applyServerData(session, init.server_data);
        session.state = "finished_queue";
        session.finished_queue_at = Date.now();
        clearTimeout(session.queue_abandon_timeout);
        session.startgame_timeout = setTimeout(
          () => killSession(uuid, "startgame_timeout"),
          START_GAME_GRACE_MS,
        );
        return res.json({
          status: "finished_queue",
          uuid,
          queue_pos: 0,
          fetch_this_within_60s_or_terminate: `${basePath}/cloud/v1/startGame`,
        });
      } catch (e) {
        return res.status(500).json({
          code: e?.code || "GAME_PROVIDER_WAIT_ERROR",
          error: e?.message || "Cloud-game provider wait failed.",
        });
      }
    }

    try {
      const pos = await doPollQueue(session, session.queue_id);
      // Cache the last known queue position so the "Too fast" path can return
      // something useful instead of erroring out.
      session.last_queue_pos = pos;

      if (pos === 0) {
        session.allocation_started_at ||= Date.now();
        const claim = await tryClaimGame(session, session.queue_id);
        if (!claim.ready) {
          // Position zero means the provider is allocating the streaming host.
          // 201/4623 here are transitional, not fatal. Keep polling the same
          // queue/session rather than destroying it after a fixed 15 seconds.
          session.last_queue_pos = 0;
          return res.json({
            status: "allocating",
            uuid,
            queue_pos: 0,
            retry_after_ms: 4_000,
            provider_status: claim.provider_status,
          });
        }
        applyServerData(session, claim.server_data);
        session.state = "finished_queue";
        session.finished_queue_at = Date.now();
        clearTimeout(session.queue_abandon_timeout);
        session.startgame_timeout = setTimeout(
          () => killSession(uuid, "startgame_timeout"),
          START_GAME_GRACE_MS,
        );
        return res.json({
          status: "finished_queue",
          uuid,
          queue_pos: 0,
          fetch_this_within_60s_or_terminate: `${basePath}/cloud/v1/startGame`,
        });
      }

      return res.json({ status: "queue", queue_pos: pos, retry_after_ms: 3_250 });
    } catch (e) {
      return res.status(500).json({ code: e?.code || "GAME_QUEUE_PROVIDER_ERROR", error: e?.message || "Queue provider request failed." });
    }
  });

  app.post("/cloud/v1/startGame", auth, (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).json({ error: "Missing uuid." });

    const session = sessions.get(uuid);
    if (!session)
      return res.status(404).json({ code: "GAME_SESSION_NOT_FOUND", error: "Session not found or expired." });
    if (session.api_key !== req.apiKey)
      return res.status(403).json({ error: "Forbidden." });
    if (session.state === "active") {
      // Idempotent success: a duplicate transition request can happen when a
      // slow HTTP response overlaps a queue tick. Do not tear down the session.
      return res.json({
        status: "active",
        already_started: true,
        ice_servers: session.embed_ice_servers,
        signaling_ws: session.embed_signaling_ws,
        max_seconds: session.max_session_seconds,
      });
    }
    if (session.state !== "finished_queue") {
      return res
        .status(409)
        .json({ code: "GAME_SESSION_NOT_READY", error: `Session is '${session.state}', not ready to start.` });
    }

    clearTimeout(session.startgame_timeout);
    clearTimeout(session.queue_abandon_timeout);

    session.state = "active";
    session.game_started_at = Date.now();

    resetPingTimeout(uuid);

    session.session_timeout = setTimeout(
      () => killSession(uuid, "max_session_length"),
      session.max_session_seconds * 1000,
    );

    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      ...(session.turns || []).map((t) => ({
        urls: t.turn_url,
        username: t.turn_user,
        credential: t.turn_password,
      })),
    ];

    // The signaling WS path is resolved relative to the request host. We
    // synthesize it from the incoming Host + X-Forwarded-Proto headers so it
    // works behind nginx/Caddy too. The path is always under the synnical
    // mount point.
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const signalingWs = `${proto === "https" ? "wss" : "ws"}://${host}${basePath}/cloud/v1/signal/${uuid}`;

    session.embed_ice_servers = iceServers;
    session.embed_signaling_ws = signalingWs;

    session.costInterval = setInterval(() => doCost(session), 25_000);

    res.json({
      status: "active",
      ice_servers: iceServers,
      signaling_ws: signalingWs,
      max_seconds: session.max_session_seconds,
    });

    logApi(
      req.apiKey,
      `${chalk.gray("startGame")} ${chalk.white(session.game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
    );

    connectRaccoonSignaling(session);
  });

  app.post("/cloud/v1/pingSession", auth, (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).json({ error: "Missing uuid." });

    const session = sessions.get(uuid);
    if (!session)
      return res.status(404).json({ error: "Session not found or expired." });
    if (session.api_key !== req.apiKey)
      return res.status(403).json({ error: "Forbidden." });
    if (session.state !== "active")
      return res.status(400).json({ error: "Session is not active." });

    const now = Date.now();
    if (session.last_ping_at && now - session.last_ping_at < 3_000) {
      return res
        .status(429)
        .json({ error: "Too fast. Ping at most once every 3 seconds." });
    }

    session.last_ping_at = now;
    resetPingTimeout(uuid);

    const { site } = req;
    const usage = getUsageStats(req.apiKey);
    const timeUsed = Math.floor((now - session.game_started_at) / 1000);

    res.json({
      session_time_used_seconds: timeUsed,
      session_time_limit_seconds: session.max_session_seconds,
      quota: {
        minute: { used: usage.perMin, limit: site.limits.per_minute },
        hour: { used: usage.perHour, limit: site.limits.per_hour },
        day: { used: usage.perDay, limit: site.limits.per_day },
        month: { used: usage.perMonth, limit: site.limits.per_month },
      },
    });
  });

  app.post("/cloud/v1/quitSession", auth, (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).json({ error: "Missing uuid." });

    const session = sessions.get(uuid);
    if (!session)
      return res.status(404).json({ error: "Session not found or expired." });
    if (session.api_key !== req.apiKey)
      return res.status(403).json({ error: "Forbidden." });

    logApi(
      req.apiKey,
      `${chalk.gray("quitSession")} ${chalk.white(uuid.slice(0, 8))}`,
    );
    killSession(uuid, "quit_requested");
    res.json({ status: "ok" });
  });

  // WebSocket server (for /cloud/v1/signal/:uuid) — handleUpgrade is invoked
  // by the synnical server.ts 'upgrade' event.
  wss = new WebSocketServer({ noServer: true });
  signalPathRegex = new RegExp(
    `^${basePath.replace(/\//g, "\\/")}\\/cloud\\/v1\\/signal\\/([0-9a-f-]{36})$`,
    "i",
  );

  // Start background timers.
  startReaper();
  startIpGc();

  // Begin filling the account pool.
  fillPool().catch(() => {});

  logSys(
    chalk.green(
      `mounted at ${chalk.white(basePath)} — ${Object.keys(sites.sites).length} site(s)`,
    ),
  );

  return {
    app,
    basePath,

    /**
     * Called from synnical's HTTP server 'upgrade' event. Returns true if the
     * upgrade was for a stratus signaling socket (and therefore handled);
     * false otherwise (so synnical can hand it to Socket.IO or destroy it).
     */
    handleUpgrade(req, socket, head) {
      const url = req.url || "";
      const m = url.match(signalPathRegex);
      if (!m) return false;
      const uuid = m[1];
      const session = sessions.get(uuid);
      if (!session || session.state !== "active") {
        socket.destroy();
        return true;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        session.clientWs = ws;

        ws.on("message", (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }

          const rws = session.raccoonWs;
          if (!rws || rws.readyState !== WebSocket.OPEN) return;

          if (msg.type === "rtc_offer" && msg.sdp) {
            rws.send(
              JSON.stringify({
                id: "rtc_sdp",
                from: session.sn,
                to: session.gl_key,
                body: { sdp: msg.sdp, type: "offer" },
              }),
            );
          } else if (msg.type === "rtc_candidate" && msg.candidate) {
            rws.send(
              JSON.stringify({
                id: "rtc_sdp",
                from: session.sn,
                to: session.gl_key,
                body: { type: "candidate", sdp: msg.candidate },
              }),
            );
          }
        });

        ws.on("close", () => {
          session.clientWs = undefined;
        });
        ws.on("error", () => {});
      });
      return true;
    },

    /**
     * Tear down all background timers. Called on synnical shutdown.
     */
    shutdown() {
      if (reaperTimer) clearInterval(reaperTimer);
      if (ipGcTimer) clearInterval(ipGcTimer);
      reaperTimer = null;
      ipGcTimer = null;
      for (const uuid of sessions.keys()) killSession(uuid, "shutdown");
      try { wss?.close(); } catch {}
    },
  };
}

module.exports = {
  createStratusApp,
  STRATUS_BASE_PATH,
};
