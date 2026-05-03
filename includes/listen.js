module.exports = function ({ api, models }) {
    const fs = require("fs");
    const Users = require("./controllers/users")({ models, api });
    const Threads = require("./controllers/threads")({ models, api });
    const Currencies = require("./controllers/currencies")({ models });
    const logger = require("../utils/log.js");
    const moment = require("moment-timezone");

    const box = (title, body) =>
`╭─── ${title} ───╮\n\n${body}\n\n╰─────────────────╯`;

    let day = moment.tz("Asia/Dhaka").day();
    const checkttDataPath = __dirname + "/../src/commands/checktuongtac/";

    /* ═══════════════════════════════════════
       SPAM PROTECTION
       config: spamProtection.commandThreshold, timeWindow, banDuration
    ═══════════════════════════════════════ */

    const spamTracker = new Map(); // senderID → { count, firstTime }
    const spamBanned  = new Map(); // senderID → bannedUntil timestamp

    function checkSpam(senderID) {
        const cfg       = global.config.spamProtection || {};
        const threshold = cfg.commandThreshold || 8;
        const windowMs  = (cfg.timeWindow   || 10) * 1000;
        const banMs     = (cfg.banDuration   || 24) * 60 * 60 * 1000;
        const ADMINBOT  = global.config.ADMINBOT || [];
        const NDH       = global.config.NDH      || [];

        if (ADMINBOT.includes(senderID) || NDH.includes(senderID)) return false;

        const now = Date.now();

        if (spamBanned.has(senderID)) {
            if (now < spamBanned.get(senderID)) return true;
            spamBanned.delete(senderID);
        }

        const rec = spamTracker.get(senderID) || { count: 0, firstTime: now };
        if (now - rec.firstTime > windowMs) {
            rec.count     = 1;
            rec.firstTime = now;
        } else {
            rec.count++;
            if (rec.count >= threshold) {
                spamBanned.set(senderID, now + banMs);
                spamTracker.delete(senderID);
                return true;
            }
        }
        spamTracker.set(senderID, rec);
        return false;
    }

    /* ═══════════════════════════════════════
       WHITELIST HELPERS
       config: whiteListMode, whiteListModeThread
    ═══════════════════════════════════════ */

    function isAllowedUser(senderID) {
        const wl = global.config.whiteListMode || {};
        if (!wl.enable) return true;
        const ADMINBOT = global.config.ADMINBOT || [];
        if (ADMINBOT.includes(senderID)) return true;
        const ids = (wl.whiteListIds || []).filter(Boolean);
        return ids.includes(senderID);
    }

    function isAllowedThread(threadID, isGroup) {
        if (!isGroup) return true;
        const wl = global.config.whiteListModeThread || {};
        if (!wl.enable) return true;
        const ids = (wl.whiteListThreadIds || []).filter(Boolean);
        return ids.includes(threadID);
    }

    /* ═══════════════════════════════════════
       LOG EVENTS FILTER
       config: logEvents.*
    ═══════════════════════════════════════ */

    function shouldLogEvent(type) {
        const cfg = global.config.logEvents || {};
        if (cfg.disableAll) return false;
        if (typeof cfg[type] !== "undefined") return cfg[type];
        return true;
    }

    /* ═══════════════════════════════════════
       DAILY / WEEKLY TOP CHAT
    ═══════════════════════════════════════ */

    setInterval(async () => {
        const day_now   = moment.tz("Asia/Dhaka").day();
        const _ADMINIDs = [...(global.config.NDH || []), ...(global.config.ADMINBOT || [])];

        try {
            if (day !== day_now) {
                day = day_now;
                if (!fs.existsSync(checkttDataPath)) return;

                const checkttData = fs.readdirSync(checkttDataPath).filter(file => {
                    const id = file.replace(".json", "");
                    return _ADMINIDs.includes(id) || global.data.allThreadID.includes(id);
                });

                for (const checkttFile of checkttData) {
                    try {
                        const checktt = JSON.parse(fs.readFileSync(checkttDataPath + checkttFile));
                        if (!checktt || !Array.isArray(checktt.day)) continue;

                        let storage = [], count = 1;
                        for (const item of checktt.day) {
                            const name = await Users.getNameUser(item.id).catch(() => "Unknown") || "Unknown";
                            storage.push({ ...item, name });
                        }
                        storage.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

                        const body = storage.slice(0, 10)
                            .map(i => `${count++}. ${i.name} → ${i.count} msgs`)
                            .join("\n");

                        api.sendMessage(box("🔥 DAILY TOP CHAT", body), checkttFile.replace(".json", ""));
                        checktt.day.forEach(e => e.count = 0);
                        checktt.time = day_now;
                        fs.writeFileSync(checkttDataPath + checkttFile, JSON.stringify(checktt, null, 4));
                    } catch (fileErr) {
                        logger(`Daily top error for ${checkttFile}: ${fileErr.message}`, "error");
                    }
                }

                if (day_now === 1) {
                    for (const checkttFile of checkttData) {
                        try {
                            const checktt = JSON.parse(fs.readFileSync(checkttDataPath + checkttFile));
                            if (!checktt || !Array.isArray(checktt.week)) continue;

                            let storage = [], count = 1;
                            for (const item of checktt.week) {
                                const name = await Users.getNameUser(item.id).catch(() => "Unknown") || "Unknown";
                                storage.push({ ...item, name });
                            }
                            storage.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

                            const body = storage.slice(0, 10)
                                .map(i => `${count++}. ${i.name} → ${i.count} msgs`)
                                .join("\n");

                            api.sendMessage(box("👑 WEEKLY TOP CHAT", body), checkttFile.replace(".json", ""));
                            checktt.week.forEach(e => e.count = 0);
                            fs.writeFileSync(checkttDataPath + checkttFile, JSON.stringify(checktt, null, 4));
                        } catch (weekErr) {
                            logger(`Weekly top error for ${checkttFile}: ${weekErr.message}`, "error");
                        }
                    }
                }

                global.client.sending_top = false;
            }
        } catch (e) {
            logger(`Top chat interval error: ${e.message}`, "error");
        }
    }, 1000 * 60);

    /* ═══════════════════════════════════════
       LOAD DATABASE
    ═══════════════════════════════════════ */

    (async function () {
        try {
            logger("Loading environment...", "[ SYSTEM ]");
            const threads    = await Threads.getAll();
            const users      = await Users.getAll(["userID", "name", "data"]);
            const currencies = await Currencies.getAll(["userID"]);

            for (const t of threads) {
                const id = String(t.threadID);
                global.data.allThreadID.push(id);
                global.data.threadData.set(id, t.data || {});
                global.data.threadInfo.set(id, t.threadInfo || {});
            }
            for (const u of users) {
                const id = String(u.userID);
                global.data.allUserID.push(id);
                if (u.name) global.data.userName.set(id, u.name);
            }
            for (const c of currencies)
                global.data.allCurrenciesID.push(String(c.userID));

            logger("Environment loaded successfully", "[ SYSTEM ]");
        } catch (err) {
            logger(`Failed to load environment: ${err.message}`, "ERROR");
        }
    })();

    logger(
        `[ ${global.config.PREFIX} ] • ${global.config.BOTNAME || ""}`,
        "[ BOT ONLINE ]"
    );

    /* ═══════════════════════════════════════
       AUTO RESTART (daily at fixed time)
       config: autoRestart.time  →  "HH:mm"
    ═══════════════════════════════════════ */

    const autoRestartCfg = global.config.autoRestart || {};
    if (autoRestartCfg.time) {
        const parts = String(autoRestartCfg.time).split(":");
        const rstHour = Number(parts[0]);
        const rstMin  = Number(parts[1] || 0);
        if (!isNaN(rstHour) && !isNaN(rstMin)) {
            setInterval(() => {
                const now = moment.tz(global.config.timeZone || "Asia/Dhaka");
                if (Number(now.format("HH")) === rstHour && Number(now.format("mm")) === rstMin) {
                    logger(`Auto restart triggered at ${autoRestartCfg.time}`, "[ RESTART ]");
                    process.exit(0);
                }
            }, 60 * 1000);
            logger(`Auto restart scheduled daily at ${autoRestartCfg.time}`, "[ SYSTEM ]");
        }
    }

    /* ═══════════════════════════════════════
       AUTO UPTIME PING
       config: autoUptime.enable, url, timeInterval (seconds)
    ═══════════════════════════════════════ */

    const autoUptimeCfg = global.config.autoUptime || {};
    if (autoUptimeCfg.enable && autoUptimeCfg.url) {
        const axios = require("axios");
        const pingMs = (autoUptimeCfg.timeInterval || 180) * 1000;
        setInterval(async () => {
            try {
                await axios.get(autoUptimeCfg.url, { timeout: 10000 });
            } catch (e) {
                logger(`autoUptime ping failed: ${e.message}`, "[ WARN ]");
            }
        }, pingMs);
        logger(`autoUptime → pinging ${autoUptimeCfg.url} every ${autoUptimeCfg.timeInterval || 180}s`, "[ SYSTEM ]");
    }

    /* ═══════════════════════════════════════
       RESTART LISTEN MQTT (periodic reconnect)
       config: restartListenMqtt.enable, timeRestart, delayAfterStopListening, logNoti
    ═══════════════════════════════════════ */

    const mqttRestartCfg = global.config.restartListenMqtt || {};
    if (mqttRestartCfg.enable && mqttRestartCfg.timeRestart) {
        setTimeout(function scheduleMqttRestart() {
            try {
                if (mqttRestartCfg.logNoti)
                    logger("Scheduled MQTT listener restart...", "[ MQTT ]");

                if (global.handleListen && typeof global.handleListen.stopListening === "function") {
                    try { global.handleListen.stopListening(); } catch (_) {}
                }

                setTimeout(() => {
                    try {
                        global.handleListen = api.listenMqtt((error, message) => {
                            if (error) return;
                            if (!message) return;
                            if (!["presence", "typ", "read_receipt"].includes(message.type))
                                process.stdout.write("HEARTBEAT\n");
                            if (["presence", "typ", "read_receipt"].some(t => t === message.type)) return;
                            try { listenerFn(message); } catch (_) {}
                        });
                        if (mqttRestartCfg.logNoti)
                            logger("MQTT listener restarted successfully", "[ MQTT ]");
                    } catch (e) {
                        logger(`MQTT restart failed: ${e.message}`, "error");
                    }
                    // Schedule next restart
                    setTimeout(scheduleMqttRestart, mqttRestartCfg.timeRestart);
                }, mqttRestartCfg.delayAfterStopListening || 2000);
            } catch (e) {
                logger(`MQTT restart error: ${e.message}`, "error");
                setTimeout(scheduleMqttRestart, mqttRestartCfg.timeRestart);
            }
        }, mqttRestartCfg.timeRestart);
        logger(`MQTT auto-restart every ${mqttRestartCfg.timeRestart / 60000} min`, "[ SYSTEM ]");
    }

    /* ═══════════════════════════════════════
       AUTO SEND (scheduled broadcast)
       config: autosend.enabled, checkIntervalMinutes, allowInbox, allowGroup, maxMessagesPerDay
       Reads messages from src/commands/cache/autosend.json (array of strings)
    ═══════════════════════════════════════ */

    const autosendCfg = global.config.autosend || {};
    if (autosendCfg.enabled) {
        const autosendCountToday = new Map();
        let   autosendLastDay    = moment.tz(global.config.timeZone || "Asia/Dhaka").date();

        setInterval(async () => {
            try {
                const now       = moment.tz(global.config.timeZone || "Asia/Dhaka");
                const todayDate = now.date();

                if (todayDate !== autosendLastDay) {
                    autosendCountToday.clear();
                    autosendLastDay = todayDate;
                }

                const autosendPath = global.client.mainPath + "/src/commands/cache/autosend.json";
                if (!fs.existsSync(autosendPath)) return;

                let messages;
                try { messages = JSON.parse(fs.readFileSync(autosendPath)); } catch (_) { return; }
                if (!Array.isArray(messages) || messages.length === 0) return;

                const maxPerDay = autosendCfg.maxMessagesPerDay || 24;
                const targets   = [];

                if (autosendCfg.allowGroup) {
                    for (const tid of global.data.allThreadID) targets.push(tid);
                }
                if (autosendCfg.allowInbox) {
                    for (const uid of global.data.allUserID) {
                        if (!targets.includes(uid)) targets.push(uid);
                    }
                }

                for (const target of targets) {
                    const sent = autosendCountToday.get(target) || 0;
                    if (sent >= maxPerDay) continue;
                    const msg = messages[Math.floor(Math.random() * messages.length)];
                    try {
                        await api.sendMessage(msg, target);
                        autosendCountToday.set(target, sent + 1);
                        await new Promise(r => setTimeout(r, 1000)); // rate limit
                    } catch (_) {}
                }
            } catch (e) {
                logger(`autosend error: ${e.message}`, "error");
            }
        }, (autosendCfg.checkIntervalMinutes || 60) * 60 * 1000);

        logger(`autosend enabled — interval: ${autosendCfg.checkIntervalMinutes || 60}min, max/day: ${autosendCfg.maxMessagesPerDay || 24}`, "[ SYSTEM ]");
    }

    /* ═══════════════════════════════════════
       HANDLERS
    ═══════════════════════════════════════ */

    const handleCommand      = require("./handle/handleCommand")({ api, models, Users, Threads, Currencies });
    const handleCommandEvent = require("./handle/handleCommandEvent")({ api, models, Users, Threads, Currencies });
    const handleReply        = require("./handle/handleReply")({ api, models, Users, Threads, Currencies });
    const handleReaction     = require("./handle/handleReaction")({ api, models, Users, Threads, Currencies });
    const handleEvent        = require("./handle/handleEvent")({ api, models, Users, Threads, Currencies });
    const handleCreateDatabase = require("./handle/handleCreateDatabase")({ api, Threads, Users, Currencies, models });

    /* ═══════════════════════════════════════
       EVENT ROUTER
    ═══════════════════════════════════════ */

    const listenerFn = (event) => {
        if (!event || !event.type) return;

        const senderID = String(event.senderID || "");
        const threadID = String(event.threadID || "");
        const isGroup  = event.isGroup !== undefined ? event.isGroup : (threadID !== senderID);

        switch (event.type) {
            case "message":
            case "message_reply":
            case "message_unsend": {

                // ── logEvents filter ──────────────────────────
                if (!shouldLogEvent(event.type)) return;

                // ── whiteListMode (user) ──────────────────────
                if (!isAllowedUser(senderID)) return;

                // ── whiteListModeThread (group) ───────────────
                if (!isAllowedThread(threadID, isGroup)) return;

                // ── spamProtection ────────────────────────────
                if (event.type !== "message_unsend" && checkSpam(senderID)) {
                    try {
                        api.sendMessage(
                            "⚠️ You are sending commands too fast! Please slow down.",
                            threadID
                        );
                    } catch (_) {}
                    return;
                }

                // ── typingIndicator ───────────────────────────
                if (event.type === "message") {
                    const typCfg = global.config.typingIndicator || {};
                    if (typCfg.enable) {
                        try {
                            api.sendTypingIndicator(threadID);
                            setTimeout(() => {
                                try { api.sendTypingIndicator(threadID, false); } catch (_) {}
                            }, typCfg.duration || 2000);
                        } catch (_) {}
                    }
                }

                Promise.resolve(handleCreateDatabase({ event })).catch(e => logger(`handleCreateDatabase error: ${e && e.message || e}`, "error"));
                Promise.resolve(handleCommand({ event })).catch(e => logger(`handleCommand error: ${e && e.message || e}`, "error"));
                Promise.resolve(handleReply({ event })).catch(e => logger(`handleReply error: ${e && e.message || e}`, "error"));
                Promise.resolve(handleCommandEvent({ event })).catch(e => logger(`handleCommandEvent error: ${e && e.message || e}`, "error"));
                break;
            }

            case "event":
                if (!shouldLogEvent("event")) return;
                try { handleEvent({ event }); } catch (e) { logger(`handleEvent error: ${e.message}`, "error"); }
                break;

            case "message_reaction": {
                if (!shouldLogEvent("message_reaction")) return;
                try {
                    const BOT_ID    = api.getCurrentUserID();
                    const ADMIN_IDS = [
                        ...(global.config.ADMINBOT || []),
                        ...(global.config.NDH || [])
                    ];
                    const reactConfig  = global.config.reactBy || {};
                    const deleteReacts = reactConfig.delete || [];
                    const kickReacts   = reactConfig.kick   || [];

                    if (!event.messageID || !event.reaction || !ADMIN_IDS.includes(event.userID)) {
                        handleReaction({ event });
                        break;
                    }

                    const reaction = event.reaction;

                    if (deleteReacts.includes(reaction)) {
                        if (event.senderID && event.senderID !== BOT_ID) break;
                        api.unsendMessage(event.messageID);
                        break;
                    }

                    if (kickReacts.includes(reaction)) {
                        const targetID = event.senderID;
                        if (!targetID || targetID === BOT_ID) break;
                        api.removeUserFromGroup(targetID, event.threadID);
                        break;
                    }

                    handleReaction({ event });
                } catch (err) {
                    logger(`Reaction error: ${err.message}`, "error");
                    try { handleReaction({ event }); } catch (_) {}
                }
                break;
            }

            case "read_receipt":
                if (!shouldLogEvent("read_receipt")) return;
                break;

            case "typ":
                if (!shouldLogEvent("typ")) return;
                break;

            case "presence":
                if (!shouldLogEvent("presence")) return;
                break;
        }
    };

    return listenerFn;
};
