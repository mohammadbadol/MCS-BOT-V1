const fs = require("fs-extra");
const BANS_PATH = __dirname + "/cache/bans.json";

function loadBans() {
  if (!fs.existsSync(BANS_PATH)) {
    fs.writeFileSync(BANS_PATH, JSON.stringify({ banned: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(BANS_PATH));
}

function saveBans(data) {
  fs.writeFileSync(BANS_PATH, JSON.stringify(data, null, 2));
}

module.exports.config = {
  name: "ban",
  version: "3.2.0",
  hasPermssion: 1,
  credits: "SaGor",
  description: "Ban members from group by tag, reply, or UID",
  commandCategory: "group",
  usages: "ban [@tag/reply/uid] [reason] | ban list",
  cooldowns: 5
};

module.exports.run = async function ({ api, args, Users, event }) {
  const { messageID, threadID, senderID } = event;
  const ADMINBOT = global.config.ADMINBOT || [];

  // ── Permission: group admin OR bot admin ──
  const threadInfo   = await api.getThreadInfo(threadID);
  const isGroupAdmin = threadInfo.adminIDs.some(a => a.id == senderID);
  const isBotAdmin   = ADMINBOT.includes(senderID);

  if (!isGroupAdmin && !isBotAdmin)
    return api.sendMessage("❌ Only group admins or bot admins can use this command.", threadID, messageID);

  const bans = loadBans();
  if (!bans.banned[threadID]) bans.banned[threadID] = [];

  // ════════════════════════════════
  //  ban list
  // ════════════════════════════════
  if (args[0] === "list") {
    const list = bans.banned[threadID];
    if (!list.length)
      return api.sendMessage("✅ No members are banned in this group.", threadID, messageID);

    let msg = `「 BAN LIST 」\n◆━━━━━━━━━━━━━━━━━◆\n`;
    for (const entry of list) {
      const name = ((await api.getUserInfo(entry.uid))[entry.uid] || {}).name || entry.uid;
      msg += `\n👤 ${name}\n🆔 ${entry.uid}\n📌 ${entry.reason}\n`;
    }
    return api.sendMessage(msg, threadID, messageID);
  }

  // ════════════════════════════════
  //  ban [@tag / reply / uid]
  // ════════════════════════════════
  let targets = [];
  const mentionIDs = Object.keys(event.mentions || {});

  if (event.type === "message_reply") {
    targets = [String(event.messageReply.senderID)];
  } else if (mentionIDs.length > 0) {
    targets = mentionIDs.map(String);
  } else if (args[0] && /^\d+$/.test(args[0])) {
    targets = [args[0]];
  } else {
    return api.sendMessage(
      `「 BAN COMMAND 」\n◆━━━━━━━━━━━━━━━━━◆\n\n` +
      `▸ ban @tag [reason]\n▸ ban [reply] [reason]\n▸ ban [uid] [reason]\n▸ ban list`,
      threadID, messageID
    );
  }

  // Extract reason
  let reason = args.join(" ");
  for (const name of Object.values(event.mentions || {})) {
    reason = reason.replace(name, "");
  }
  if (/^\d+$/.test(args[0])) reason = args.slice(1).join(" ");
  reason = reason.replace(/\s+/g, " ").trim() || "No reason provided";

  const banned  = [];
  const skipped = [];

  for (const uid of targets) {
    // ── Never ban bot admins ──
    if (ADMINBOT.includes(uid)) {
      const name = ((await api.getUserInfo(uid))[uid] || {}).name || uid;
      skipped.push(name);
      continue;
    }

    const name = ((await api.getUserInfo(uid))[uid] || {}).name || uid;

    // ── Add to bans.json (group-level) ──
    const already = bans.banned[threadID].some(e => String(e.uid) === uid);
    if (!already) {
      bans.banned[threadID].push({ uid: String(uid), reason, date: Date.now() });
    }

    // ── Add to global userBanned so bot ignores their commands ──
    if (!global.data.userBanned.has(uid)) {
      global.data.userBanned.set(uid, { reason, dateAdded: new Date().toLocaleString() });
    }
    // ── Also persist to Users DB ──
    try {
      const dataUser = await Users.getData(uid) || {};
      const data = dataUser.data || {};
      data.banned    = true;
      data.reason    = reason;
      data.dateAdded = new Date().toLocaleString();
      await Users.setData(uid, { data });
    } catch (_) {}

    // ── Kick from group ──
    try { await api.removeUserFromGroup(parseInt(uid), threadID); } catch (_) {}

    banned.push(name);
  }

  saveBans(bans);

  let body = "";
  if (banned.length)  body += `🚫 Banned: ${banned.join(", ")}\n📌 Reason: ${reason}`;
  if (skipped.length) body += `${body ? "\n\n" : ""}⚠️ Skipped (bot admin): ${skipped.join(", ")}`;

  return api.sendMessage(body.trim(), threadID, messageID);
};
