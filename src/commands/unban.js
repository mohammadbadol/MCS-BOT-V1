module.exports.config = {
  name: "unban",
  version: "2.0.0",
  hasPermssion: 2,
  credits: "SaGor",
  description: "Unban users banned by spamban or manual ban system",
  commandCategory: "Admin",
  usages: "unban [id | @tag | reply] | unban alluser | unban box | unban allbox",
  cooldowns: 2,
  denpendencies: {}
};

module.exports.run = async ({ event, api, Users, Threads, args }) => {
  const { threadID, messageID, senderID } = event;
  const ADMINBOT = global.config.ADMINBOT || [];
  const NDH = global.config.NDH || [];

  // ── Permission ──
  if (!ADMINBOT.includes(senderID) && !NDH.includes(senderID)) {
    return api.sendMessage("❌ You don't have permission to use this command.", threadID, messageID);
  }

  const threadSetting = global.data.threadData.get(threadID) || {};
  const prefix = threadSetting.PREFIX || global.config.PREFIX;

  // ── Helper: unban a single user ──
  async function unbanUser(uid) {
    uid = String(uid);
    const dataUser = await Users.getData(uid) || {};
    const data = dataUser.data || {};
    data.banned = false;
    data.reason = null;
    data.dateAdded = null;
    await Users.setData(uid, { data });
    global.data.userBanned.delete(uid);

    // Also clear spamProtection in-memory ban if present
    if (global.spamBanned && global.spamBanned.has(uid)) global.spamBanned.delete(uid);
    if (global.spamTracker && global.spamTracker.has(uid)) global.spamTracker.delete(uid);

    // Clear autoban tracker from spamban.js
    if (global.client.autoban && global.client.autoban[uid]) {
      global.client.autoban[uid] = { timeStart: Date.now(), number: 0 };
    }

    return dataUser.name || uid;
  }

  switch (args[0]) {

    // ── Unban by ID directly ──
    case "id": {
      const uid = args[1];
      if (!uid) return api.sendMessage(`❌ Usage: ${prefix}unban id <userID>`, threadID, messageID);
      const name = await unbanUser(uid);
      return api.sendMessage(`✅ Unbanned: ${name} (${uid})`, threadID, messageID);
    }

    // ── Unban by reply or @mention ──
    case "user":
    case "mb":
    case "member": {
      // reply
      if (event.type === "message_reply") {
        const uid = event.messageReply.senderID;
        const name = await unbanUser(uid);
        return api.sendMessage(`✅ Unbanned: ${name} (${uid})`, threadID, messageID);
      }
      // @mention
      if (Object.keys(event.mentions).length > 0) {
        const names = [];
        for (const uid of Object.keys(event.mentions)) {
          const name = await unbanUser(uid);
          names.push(`${name} (${uid})`);
        }
        return api.sendMessage(`✅ Unbanned:\n${names.join("\n")}`, threadID, messageID);
      }
      // ID as second arg
      if (args[1]) {
        const name = await unbanUser(args[1]);
        return api.sendMessage(`✅ Unbanned: ${name} (${args[1]})`, threadID, messageID);
      }
      return api.sendMessage(`❌ Please reply to a message, @mention, or provide a user ID.\nUsage: ${prefix}unban member @tag | ${prefix}unban id <ID>`, threadID, messageID);
    }

    // ── Unban all users server-wide ──
    case "alluser":
    case "allmember": {
      const userBanned = [...global.data.userBanned.keys()];
      if (userBanned.length === 0) return api.sendMessage("✅ No users are currently banned.", threadID, messageID);
      for (const uid of userBanned) await unbanUser(uid);
      return api.sendMessage(`✅ Unbanned all ${userBanned.length} user(s) on the server.`, threadID, messageID);
    }

    // ── Unban current thread ──
    case "box":
    case "thread": {
      const data = (await Threads.getData(threadID)).data || {};
      data.banned = false;
      data.reason = null;
      data.dateAdded = null;
      await Threads.setData(threadID, { data });
      global.data.threadBanned && global.data.threadBanned.delete(threadID);
      return api.sendMessage("✅ This group has been unbanned.", threadID, messageID);
    }

    // ── Unban all threads ──
    case "allbox":
    case "allthread": {
      const threadBanned = global.data.threadBanned ? [...global.data.threadBanned.keys()] : [];
      if (threadBanned.length === 0) return api.sendMessage("✅ No groups are currently banned.", threadID, messageID);
      for (const tid of threadBanned) {
        const data = (await Threads.getData(tid)).data || {};
        data.banned = false; data.reason = null; data.dateAdded = null;
        await Threads.setData(tid, { data });
        global.data.threadBanned.delete(tid);
      }
      return api.sendMessage(`✅ Unbanned all ${threadBanned.length} group(s).`, threadID, messageID);
    }

    // ── Default: show help OR handle reply/mention without subcommand ──
    default: {
      // If replying to a message without subcommand → auto unban
      if (event.type === "message_reply") {
        const uid = event.messageReply.senderID;
        const name = await unbanUser(uid);
        return api.sendMessage(`✅ Unbanned: ${name} (${uid})`, threadID, messageID);
      }
      // If @mention without subcommand → auto unban
      if (Object.keys(event.mentions).length > 0) {
        const names = [];
        for (const uid of Object.keys(event.mentions)) {
          const name = await unbanUser(uid);
          names.push(`${name} (${uid})`);
        }
        return api.sendMessage(`✅ Unbanned:\n${names.join("\n")}`, threadID, messageID);
      }
      // If raw ID without subcommand
      if (args[0] && /^\d+$/.test(args[0])) {
        const name = await unbanUser(args[0]);
        return api.sendMessage(`✅ Unbanned: ${name} (${args[0]})`, threadID, messageID);
      }

      return api.sendMessage(
        `「 𝗨𝗡𝗕𝗔𝗡 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 」\n` +
        `◆━━━━━━━━━━━━━━━━━◆\n\n` +
        `▸ ${prefix}unban <userID>\n  → Unban by ID\n\n` +
        `▸ ${prefix}unban [reply]\n  → Unban the replied user\n\n` +
        `▸ ${prefix}unban member @tag\n  → Unban tagged user\n\n` +
        `▸ ${prefix}unban alluser\n  → Unban all users on server\n\n` +
        `▸ ${prefix}unban box\n  → Unban this group\n\n` +
        `▸ ${prefix}unban allbox\n  → Unban all groups`,
        threadID, messageID
      );
    }
  }
};
