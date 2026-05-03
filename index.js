const { spawn } = require("child_process");
const axios  = require("axios");
const logger = require("./utils/log");
const config = require("./config.json");

const REMOTE_CONFIG_URL =
  "https://raw.githubusercontent.com/JAHIDUL-ISLAM-SAGOR-0/Mirai-bot/refs/heads/main/config.json";

async function checkUpdate() {
  try {
    const res = await axios.get(REMOTE_CONFIG_URL, { timeout: 10000 });
    const remoteVersion = res.data && res.data.version;
    const localVersion  = config.version;
    if (!remoteVersion) return logger("Remote version not found", "[ UPDATE ]");
    if (remoteVersion !== localVersion)
      logger(`Update available | Current: ${localVersion} → New: ${remoteVersion}`, "[ UPDATE ]");
    else
      logger("Bot is on the latest version", "[ UPDATE ]");
  } catch (_) {
    logger("Update check failed (network issue)", "[ UPDATE ]");
  }
}

/* ═══════════════════════════════════════
   EXPRESS SERVER
═══════════════════════════════════════ */

const express = require("express");
const path    = require("path");
const app     = express();
const port    = process.env.PORT || (config.dashBoard && config.dashBoard.port) || 5000;

app.set("trust proxy", true);
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/includes/index.html"));
});

app.get("/health", (req, res) => {
  const botAlive = global.botProcess && !global.botProcess.killed;
  const lastHB   = global.lastHeartbeat
    ? Math.floor((Date.now() - global.lastHeartbeat) / 1000) + "s ago"
    : "N/A";
  res.json({
    status:        botAlive ? "ok" : "bot_down",
    uptime:        Math.floor(process.uptime()) + "s",
    restarts:      global.countRestart || 0,
    lastHeartbeat: lastHB,
  });
});

/* ═══════════════════════════════════════
   DASHBOARD — verify-code auth
   config: dashBoard.enable, expireVerifyCode
═══════════════════════════════════════ */

const crypto = require("crypto");
const verifyCodeStore = new Map(); // token → { expiresAt }

function isDashboardEnabled() {
  return !config.dashBoard || config.dashBoard.enable !== false;
}

// Generate a one-time verify code (used by bot admins to unlock dashboard)
app.get("/dashboard/gencode", (req, res) => {
  if (!isDashboardEnabled()) return res.status(403).json({ error: "Dashboard disabled" });
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  const expiresAt = Date.now() + ((config.dashBoard && config.dashBoard.expireVerifyCode) || 300000);
  verifyCodeStore.set(code, { expiresAt });
  // Auto-expire cleanup
  setTimeout(() => verifyCodeStore.delete(code), (config.dashBoard && config.dashBoard.expireVerifyCode) || 300000);
  res.json({ code, expiresIn: ((config.dashBoard && config.dashBoard.expireVerifyCode) || 300000) / 1000 + "s" });
});

// Verify code → returns session token
app.get("/dashboard/verify", (req, res) => {
  if (!isDashboardEnabled()) return res.status(403).json({ error: "Dashboard disabled" });
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "Missing code" });
  const entry = verifyCodeStore.get(code.toUpperCase());
  if (!entry) return res.status(401).json({ error: "Invalid or expired code" });
  if (Date.now() > entry.expiresAt) {
    verifyCodeStore.delete(code.toUpperCase());
    return res.status(401).json({ error: "Code expired" });
  }
  verifyCodeStore.delete(code.toUpperCase());
  // Issue a session token (valid 1 hour)
  const sessionToken = crypto.randomBytes(16).toString("hex");
  verifyCodeStore.set("session_" + sessionToken, { expiresAt: Date.now() + 3600000 });
  res.json({ token: sessionToken, expiresIn: "3600s" });
});

// Dashboard stats API (protected)
app.get("/dashboard/stats", (req, res) => {
  if (!isDashboardEnabled()) return res.status(403).json({ error: "Dashboard disabled" });
  const token = req.headers["x-dashboard-token"] || req.query.token;
  const session = token ? verifyCodeStore.get("session_" + token) : null;
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    status:        global.botProcess && !global.botProcess.killed ? "ok" : "bot_down",
    uptime:        Math.floor(process.uptime()) + "s",
    restarts:      global.countRestart || 0,
    lastHeartbeat: global.lastHeartbeat
      ? Math.floor((Date.now() - global.lastHeartbeat) / 1000) + "s ago"
      : "N/A",
  });
});

/* ═══════════════════════════════════════
   SERVER UPTIME — Socket.io broadcast
   config: serverUptime.enable, port, socket.channelName, verifyToken
═══════════════════════════════════════ */

if (config.serverUptime && config.serverUptime.enable) {
  try {
    const http   = require("http");
    const { Server } = require("socket.io");
    const uptimePort = config.serverUptime.port || 3001;
    const socketCfg  = config.serverUptime.socket || {};
    const channel     = socketCfg.channelName || "uptime";
    const verifyToken = socketCfg.verifyToken || "";

    const uptimeServer = http.createServer();
    const io = new Server(uptimeServer, { cors: { origin: "*" } });

    io.on("connection", (socket) => {
      // Optional token verification
      if (verifyToken) {
        const clientToken = socket.handshake.auth && socket.handshake.auth.token;
        if (clientToken !== verifyToken) {
          socket.disconnect(true);
          return;
        }
      }
      // Send current status immediately on connect
      socket.emit(channel, {
        status:   global.botProcess && !global.botProcess.killed ? "online" : "offline",
        uptime:   Math.floor(process.uptime()),
        restarts: global.countRestart || 0,
        ts:       Date.now()
      });
    });

    // Broadcast every 30s
    setInterval(() => {
      io.emit(channel, {
        status:   global.botProcess && !global.botProcess.killed ? "online" : "offline",
        uptime:   Math.floor(process.uptime()),
        restarts: global.countRestart || 0,
        ts:       Date.now()
      });
    }, 30000);

    uptimeServer.listen(uptimePort, "0.0.0.0", () => {
      logger(`ServerUptime socket running on port ${uptimePort} (channel: ${channel})`, "[ SERVER ]");
    });
    uptimeServer.on("error", (e) => logger(`ServerUptime socket error: ${e.message}`, "[ ERROR ]"));
  } catch (e) {
    logger(`serverUptime init failed: ${e.message}`, "[ ERROR ]");
  }
}

// 24/7 Keep-alive self-ping — Render & Railway
const SELF_URL = process.env.RENDER_EXTERNAL_URL
  || process.env.RAILWAY_STATIC_URL
  || process.env.APP_URL
  || null;

if (SELF_URL) {
  const pingUrl = SELF_URL.startsWith("http") ? SELF_URL : `https://${SELF_URL}`;
  setInterval(async () => {
    try {
      await axios.get(`${pingUrl}/health`, { timeout: 8000 });
      logger(`Self-ping OK → ${pingUrl}/health`, "[ UPTIME ]");
    } catch (e) {
      logger(`Self-ping failed: ${e.message}`, "[ UPTIME ]");
    }
  }, 4 * 60 * 1000);
  logger(`24/7 self-ping enabled → ${pingUrl}`, "[ UPTIME ]");
} else {
  logger("Self-ping disabled — RENDER_EXTERNAL_URL বা APP_URL set করো", "[ UPTIME ]");
}

app.listen(port, "0.0.0.0", () => {
  logger(`Dashboard running at http://0.0.0.0:${port}`, "[ SERVER ]");
}).on("error", (err) => {
  logger(`Server error: ${err.message}`, "[ ERROR ]");
});

/* ═══════════════════════════════════════
   GLOBAL STATE
═══════════════════════════════════════ */

global.countRestart  = 0;
global.botProcess    = null;
global.lastHeartbeat = null;
global.isRestarting  = false;

/* ═══════════════════════════════════════
   FREEZE WATCHDOG (10 min silence → restart)
═══════════════════════════════════════ */

const FREEZE_TIMEOUT_MS = 10 * 60 * 1000;

function startWatchdog() {
  setInterval(() => {
    if (!global.botProcess || global.botProcess.killed) return;
    if (!global.lastHeartbeat) return;
    const silent = Date.now() - global.lastHeartbeat;
    if (silent > FREEZE_TIMEOUT_MS) {
      logger(
        `Bot frozen for ${Math.floor(silent / 60000)} min — force restarting...`,
        "[ WATCHDOG ]"
      );
      try { global.botProcess.kill("SIGKILL"); } catch (_) {}
    }
  }, 60 * 1000);
}

function trackHeartbeat(data) {
  if (data.toString().includes("HEARTBEAT")) {
    global.lastHeartbeat = Date.now();
  }
}

/* ═══════════════════════════════════════
   START BOT (unlimited restarts + backoff)
═══════════════════════════════════════ */

function startBot(message) {
  if (global.isRestarting) return;
  global.isRestarting = true;
  if (message) logger(message, "[ BOT ]");

  // Exponential backoff: 0s, 3s, 6s, 12s, 24s, 60s max
  const delay = global.countRestart === 0
    ? 0
    : Math.min(3000 * Math.pow(2, Math.min(global.countRestart - 1, 4)), 60000);

  if (delay > 0) logger(`Waiting ${delay / 1000}s before restart...`, "[ RESTART ]");

  setTimeout(() => {
    global.isRestarting  = false;
    global.lastHeartbeat = Date.now();

    const child = spawn(
      "node",
      ["--trace-warnings", "--async-stack-traces", "--max-old-space-size=512", "SaGor.js"],
      { cwd: __dirname, stdio: ["inherit", "pipe", "pipe"], shell: true }
    );

    global.botProcess = child;

    child.stdout.on("data", (data) => {
      process.stdout.write(data);
      trackHeartbeat(data);
    });

    // FIX: stderr piped separately — errors visible but don't pollute stdout
    child.stderr.on("data", (data) => {
      process.stderr.write(data);
    });

    child.on("close", (codeExit) => {
      const isCrash = codeExit !== 0 && codeExit !== null;
      if (isCrash) global.countRestart++;
      logger(
        `Bot exited (code ${codeExit}) — Restart #${global.countRestart}`,
        "[ RESTART ]"
      );
      startBot();
    });

    child.on("error", (error) => {
      logger(`Spawn error: ${error.message}`, "[ ERROR ]");
      global.countRestart++;
      startBot();
    });

  }, delay);
}

/* ═══════════════════════════════════════
   GRACEFUL SHUTDOWN
═══════════════════════════════════════ */

function gracefulShutdown(signal) {
  logger(`Received ${signal} — shutting down...`, "[ SHUTDOWN ]");
  if (global.botProcess && !global.botProcess.killed) {
    global.botProcess.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGTERM",  () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",   () => gracefulShutdown("SIGINT"));
process.on("uncaughtException",  (err) => {
  logger(`Uncaught exception in index.js: ${err.message}`, "[ ERROR ]");
});
process.on("unhandledRejection", (reason) => {
  logger(`Unhandled rejection in index.js: ${reason}`, "[ ERROR ]");
});

/* ═══════════════════════════════════════
   BOOT
═══════════════════════════════════════ */

(async () => {
  await checkUpdate();
  startWatchdog();
  startBot("Bot is starting...");
})();
