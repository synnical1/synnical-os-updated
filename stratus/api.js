/** Synnical HTTP/WS adapter for the supplied transport-agnostic core.
 * server.ts owns cookie authentication, origin validation and trusted user IDs.
 * This adapter adds account ownership and the server-only integration key.
 * Provider/account/session lifecycle logic lives only in core.cjs. */
const express = require("express");
const { randomUUID } = require("crypto");
const { readFileSync, existsSync } = require("fs");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");
const chalk = require("chalk");
const { createStratusCore } = require("./core.cjs");
const STRATUS_BASE_PATH = "/api/games";
function createStratusApp(options = {}) {
  const basePath = (options.basePath || STRATUS_BASE_PATH).replace(/\/+$/, "");
  const sitesPath =
    options.sitesPath || path.join(__dirname, "sites.json");
  const publicDir =
    options.publicDir || path.join(__dirname, "public");

  // Load sites.json — required. Tolerates JSONC-style // comments so users
  // can annotate the file.
  const siteUsage = new Map();
  const sites = loadSitesConfig(sitesPath);
  const core = createStratusCore({ ...options.coreOptions, accountPoolAllowed: Boolean(options.apiKey || Object.values(sites.sites).some(site => site.api_key)) });
  const { sessions, ipLimits, embedIpLimits, checkIpLimit, MAX_SESSION_SECONDS, MAX_CONCURRENT_SESSIONS, MAX_SIGNAL_BUFFERED_BYTES,
    countActiveSessions, acquireAccountSlot, releaseAccountSlot, createAccount, doInitGame, doPollQueue, tryClaimGame, doCost,
    applyServerData, killSession, resetPingTimeout, connectRaccoonSignaling, PROVIDER_WAIT_MAX_AGE, QUEUE_ABANDON_MS, START_GAME_GRACE_MS,
    providerWaitRetryMs, providerWaitElapsedMs, providerWaitLimitLabel } = core;
  let wss;
  let signalPathRegex;
  if (options.apiKey !== undefined && sites.sites.synnical) sites.sites.synnical.api_key = options.apiKey;
  const ownsSession = (req, session) => !options.requireUserIdentity || (typeof req.headers["x-synnical-user-id"] === "string" && session.user_id === req.headers["x-synnical-user-id"]);

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
    const session = sessions.get(req.query.id);
    if (!session || !ownsSession(req, session)) return res.status(404).json({ error: "Session not found." });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "no-referrer");
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
    if (!ownsSession(req, session)) return res.status(404).json({ error: "Session not found." });
    if (session.state !== "active")
      return res.status(409).json({ code: "GAME_SESSION_NOT_ACTIVE", error: `Session is '${session.state}', not active.` });
    res.json({
      code: "GAME_EMBED_READY",
      ice_servers: session.embed_ice_servers,
      signaling_ws: session.embed_signaling_ws,
      max_seconds: session.max_session_seconds,
    });
  });

  // Liveness and dependency readiness are separate. No live session is created.
  app.get("/cloud/v1/health", async (_req, res) => {
    const configured = options.apiKey !== undefined ? Boolean(options.apiKey.trim()) : Object.values(sites.sites).some(site => Boolean(site.api_key));
    const malq = await core.checkMalqReadiness();
    const dependency = core.dependencyStatus();
    const ready = configured && malq === "ready" && !dependency.cooldown;
    res.set("Cache-Control", "no-store").json({ status: "ok", service: "stratus", base_path: basePath,
      readiness: ready ? "ready" : "degraded",
      provider: { ...dependency, configured, malq, ready, live_session: "unverified" } });
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

    if (options.requireUserIdentity && typeof req.headers["x-synnical-user-id"] !== "string") return res.status(401).json({ error: "Unauthorized" });
    const { site, apiKey } = req;

    if (countActiveSessions() >= Math.min(site.max_concurrent_sessions, MAX_CONCURRENT_SESSIONS)) {
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

    const push = (obj) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(obj) + "\n"); };
    const uuid = randomUUID();

    const rawLimit = site.max_session_seconds ?? MAX_SESSION_SECONDS;
    const sessionLimit = Math.min(rawLimit, MAX_SESSION_SECONDS);

    const session = {
      uuid,
      api_key: apiKey,
      user_id: options.requireUserIdentity ? req.headers["x-synnical-user-id"] : undefined,
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
    res.once("close", () => { if (!res.writableEnded) killSession(uuid, "client_disconnected"); });
    logApi(
      apiKey,
      `${chalk.gray("createSession")} ${chalk.white(game_key)} → ${chalk.white(uuid.slice(0, 8))}`,
    );

    let slotReleased = false;
    let heartbeat;
    try {
      push({ status: "creating_account" });
      heartbeat = setInterval(() => {
        if (!res.writableEnded) push({ status: "creating_account" });
      }, 10_000);
      res.once("close", () => clearInterval(heartbeat));
      const acc = await createAccount();
      clearInterval(heartbeat);

      releaseAccountSlot(apiKey);
      slotReleased = true;

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
      clearInterval(heartbeat);
      if (!slotReleased) releaseAccountSlot(apiKey);
      logApi(
        apiKey,
        chalk.red(
          `createSession ${chalk.white(uuid.slice(0, 8))} failed — ${String(e?.code || "GAME_SESSION_CREATE_FAILED")}: ${String(e?.code ? e.message : "Provider request failed")}`,
        ),
      );
      push({ status: "error", code: e?.code || "GAME_SESSION_CREATE_FAILED", error: e?.code ? e.message : "Game session creation failed." });
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
    if (session.api_key !== req.apiKey || !ownsSession(req, session))
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
      return res.status(500).json({ code: e?.code || "GAME_QUEUE_PROVIDER_ERROR", error: e?.code ? e.message : "Queue provider request failed." });
    }
  });

  app.post("/cloud/v1/startGame", auth, (req, res) => {
    const { uuid } = req.body;
    if (!uuid) return res.status(400).json({ error: "Missing uuid." });

    const session = sessions.get(uuid);
    if (!session)
      return res.status(404).json({ code: "GAME_SESSION_NOT_FOUND", error: "Session not found or expired." });
    if (session.api_key !== req.apiKey || !ownsSession(req, session))
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
    if (session.api_key !== req.apiKey || !ownsSession(req, session))
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
    if (session.api_key !== req.apiKey || !ownsSession(req, session))
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
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SIGNAL_BUFFERED_BYTES, perMessageDeflate: false });
  signalPathRegex = new RegExp(
    `^${basePath.replace(/\//g, "\\/")}\\/cloud\\/v1\\/signal\\/([0-9a-f-]{36})$`,
    "i",
  );

  logSys(
    chalk.green(
      `mounted at ${chalk.white(basePath)} — ${Object.keys(sites.sites).length} site(s)`,
    ),
  );

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


  return {
    app,
    basePath,

    /**
     * Called from synnical's HTTP server 'upgrade' event. Returns true if the
     * upgrade was for a stratus signaling socket (and therefore handled);
     * false otherwise (so synnical can hand it to Socket.IO or destroy it).
     */
    handleUpgrade(req, socket, head) {
      const url = new URL(req.url || "/", "http://localhost").pathname;
      const m = url.match(signalPathRegex);
      if (!m) return false;
      const uuid = m[1];
      const session = sessions.get(uuid);
      if (!session || session.state !== "active" || !ownsSession(req, session)) {
        socket.destroy();
        return true;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (session.clientWs) { try { session.clientWs.terminate(); } catch {} }
        session.clientWs = ws;

        ws.on("message", (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }

    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

          const rws = session.raccoonWs;
          if (!rws || rws.readyState !== WebSocket.OPEN) return;
          if (rws.bufferedAmount > MAX_SIGNAL_BUFFERED_BYTES || ws.bufferedAmount > MAX_SIGNAL_BUFFERED_BYTES) {
            ws.terminate(); rws.terminate(); killSession(uuid, "signal_backpressure"); return;
          }

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
          if (session.clientWs === ws) session.clientWs = undefined;
        });
        ws.on("error", () => {});
      });
      return true;
    },

    /**
     * Tear down all background timers. Called on synnical shutdown.
     */
    shutdown() {
      core.shutdown();
      try { wss?.close(); } catch {}
    },
  };
}


module.exports = { createStratusApp, STRATUS_BASE_PATH };
