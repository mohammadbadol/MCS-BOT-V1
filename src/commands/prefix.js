const fs = require("fs");
module.exports.config = {
  name: "prefix",
  version: "1.0.0",
  hasPermssion: 0,
  credits: "LIKHON AHMED",
  description: "Unknown!",
  commandCategory: "BOT-PREFIX",
  usages: "PREFIX",
  cooldowns: 5,
  usePrefix: true
};
async function sendPrefixInfo(api, threadID, messageID) {
  const threadSetting =
    global.data.threadData.get(parseInt(threadID)) || {};
  const prefix = threadSetting.PREFIX || global.config.PREFIX;
  
  const messageText = `Prefix : ${prefix}`;
  
  return api.sendMessage(messageText, threadID, messageID);
}
module.exports.run = async ({ event, api }) => {
  return sendPrefixInfo(api, event.threadID, event.messageID);
};
