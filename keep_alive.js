const http  = require("http");
const https = require("https");

const TARGET = process.env.RENDER_EXTERNAL_URL
  || process.env.RAILWAY_STATIC_URL
  || process.env.APP_URL
  || "";

if (!TARGET) {
  console.log("[KEEP_ALIVE] URL not set — skipping keep-alive.");
  module.exports = {};
  return;
}

const url    = TARGET.startsWith("http") ? TARGET : `https://${TARGET}`;
const pingMs = 4 * 60 * 1000; 

function ping() {
  const lib = url.startsWith("https") ? https : http;
  lib.get(`${url}/health`, (res) => {
    let body = "";
    res.on("data", d => body += d);
    res.on("end", () => {
      console.log(`[KEEP_ALIVE] ${new Date().toISOString()} → ${res.statusCode}`);
    });
  }).on("error", (e) => {
    console.error(`[KEEP_ALIVE] ping failed: ${e.message}`);
  });
}

ping();
setInterval(ping, pingMs);
console.log(`[KEEP_ALIVE] Pinging ${url} every ${pingMs / 60000} min`);
    
