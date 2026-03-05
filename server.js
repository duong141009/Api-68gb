const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');

// Import logic files
const gb_hu = require('./68gb_hu_logic');
const gb_md5 = require('./68gb_md5_logic');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// Firebase configuration placeholder
const dbUrl = "https://bcrapi-default-rtdb.firebaseio.com";

const custom_script = `
(function () {
  var OriginalWebSocket = window.WebSocket;

  console.log("🚀 WebSocket hook initialized inside browser");

  window.WebSocket = function (url, protocols) {
    var ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    ws.addEventListener("message", async function (event) {
      try {
        var text;
        if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder("utf-8").decode(event.data);
        } else if (typeof event.data === "string") {
          text = event.data;
        } else {
          return;
        }

        // DEBUG: Log a snippet of every message to see what's flowing
        if (text.length > 5) {
            console.log("🕵️ WS Msg (first 50 chars):", text.substring(0, 50));
        }

        // Detect game result packets
        let tableType = "";
        if (text.includes("newmdsbgameend") || text.includes("new_tai_xiu_result")) {
          tableType = "normal";
        } else if (text.includes("mnmdsbgameend") || text.includes("md5_tai_xiu_result")) {
          tableType = "md5";
        }

        if (tableType) {
          console.log("🎯 MATCH FOUND! Table: " + tableType.toUpperCase() + " | Content: " + text);
          
          const sessionMatch = text.match(/#(\\d+)[_\\-]/);
          const sessionNumber = sessionMatch ? parseInt(sessionMatch[1], 10) : null;

          const dicesMatch = text.match(/\\{(\\d+)\\s*-\\s*(\\d+)\\s*-\\s*(\\d+)\\}/);
          if (!sessionNumber || !dicesMatch) {
            console.log("⚠️ Could not parse session or dices from matched packet.");
            return;
          }

          const d1 = parseInt(dicesMatch[1], 10);
          const d2 = parseInt(dicesMatch[2], 10);
          const d3 = parseInt(dicesMatch[3], 10);

          if (window.handleGameResult) {
            window.handleGameResult(tableType, d1, d2, d3, sessionNumber);
          }
        }
      } catch (err) {
        console.error("❌ WebSocket message handler error:", err);
      }
    });

return ws;
  };

window.WebSocket.prototype = OriginalWebSocket.prototype;
}) ();
`;

async function startPoller() {
  console.log("Starting Puppeteer...");
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      // Specific path for the Puppeteer Docker image on Render
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-features=IsolateOrigins,site-per-process',
        '--force-color-profile=srgb',
        '--disable-background-networking',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-dev-shm-usage',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
      ]
    });
    console.log("✅ Browser launched successfully");
  } catch (err) {
    console.error("❌ Failed to launch browser:", err.message);
    return;
  }

  const page = await browser.newPage();

  // Expose function to process game results in Node.js context
  await page.exposeFunction('handleGameResult', async (tableType, d1, d2, d3, sid) => {
    const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }).replace(',', '');
    const total = d1 + d2 + d3;

    // 1. Update modular logic modules
    if (tableType === "normal") {
      gb_hu.updateData(d1, d2, d3, sid);
    } else {
      gb_md5.updateData(d1, d2, d3, sid);
    }

    // 2. Prepare payload for Firebase (Legacy support)
    const payload = {
      "Phien": sid,
      "xuc_xac_1": d1,
      "xuc_xac_2": d2,
      "xuc_xac_3": d3,
      "tong": total,
      "ket_qua": total > 10 ? "Tài" : "Xỉu",
      "timestamp": new Date().toISOString()
    };

    // 3. Push to Firebase
    try {
      const path = tableType === "normal" ? "taixiu_normal" : "taixiu_md5";
      await axios.put(`${dbUrl}/${path}.json`, payload);
      console.log(`[✅ FIREBASE] [${tableType.toUpperCase()}] Updated Session ${sid}`);
    } catch (err) {
      console.error(`[❌ FIREBASE] Error pushing data:`, err.message);
    }
  });

  // Redirect browser console logs to Node.js console
  page.on('console', msg => console.log('BROWSER:', msg.text()));

  try {
    console.log("Navigating to game site...");
    await page.goto('https://68gbvn25.biz', { waitUntil: 'networkidle2', timeout: 90000 });

    console.log("Waiting 15s for game hall to load...");
    await new Promise(r => setTimeout(r, 15000));

    console.log("Injecting WebSocket hook...");
    await page.evaluate(custom_script);

    console.log("Poller is live. Monitoring logs for '🎯 MATCH FOUND'...");
  } catch (err) {
    console.error("Error during navigation or injection:", err);
  }

  // Keep the browser running
}

// --- API ENDPOINTS ---
app.get('/api/68gbhu/taixiu', (req, res) => res.json(gb_hu.getCurrentData()));
app.get('/api/68gbhu/history', (req, res) => res.json(gb_hu.getHistory(req.query.limit)));
app.get('/api/68gbmd5/taixiu', (req, res) => res.json(gb_md5.getCurrentData()));
app.get('/api/68gbmd5/history', (req, res) => res.json(gb_md5.getHistory(req.query.limit)));

const landingPage = `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>68GB API Premium</title>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Rajdhani:wght@300;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #00f2ff;
            --secondary: #7000ff;
            --bg: #050505;
            --card-bg: rgba(20, 20, 20, 0.8);
        }
        body {
            margin: 0;
            background: var(--bg);
            color: #fff;
            font-family: 'Rajdhani', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            overflow: hidden;
        }
        .container {
            position: relative;
            z-index: 10;
            width: 90%;
            max-width: 800px;
            text-align: center;
        }
        h1 {
            font-family: 'Orbitron', sans-serif;
            font-size: 3rem;
            margin-bottom: 2rem;
            text-transform: uppercase;
            background: linear-gradient(90deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            filter: drop-shadow(0 0 10px rgba(0, 242, 255, 0.5));
            animation: glow 2s ease-in-out infinite alternate;
        }
        @keyframes glow {
            from { filter: drop-shadow(0 0 5px rgba(0, 242, 255, 0.3)); }
            to { filter: drop-shadow(0 0 20px rgba(0, 242, 255, 0.8)); }
        }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 30px;
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .card:hover {
            transform: translateY(-5px);
            border-color: var(--primary);
            box-shadow: 0 10px 30px rgba(0, 242, 255, 0.2);
        }
        .card h2 {
            margin-top: 0;
            color: var(--primary);
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .links {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin-top: 20px;
        }
        .btn {
            display: block;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #fff;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.2s;
        }
        .btn:hover {
            background: var(--primary);
            color: #000;
        }
        .bg-anim {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            z-index: 1;
            background: radial-gradient(circle at center, #1a1a1a 0%, #050505 100%);
        }
        .status {
            margin-top: 30px;
            font-size: 0.9rem;
            color: rgba(255, 255, 255, 0.5);
        }
        .status span { color: #0f0; }
    </style>
</head>
<body>
    <div class="bg-anim"></div>
    <div class="container">
        <h1>68GB API CONSOLIDATED</h1>
        <div class="grid">
            <div class="card">
                <h2>🟢 Bàn Thường</h2>
                <div class="links">
                    <a href="/api/68gbhu/taixiu" class="btn">Dữ liệu hiện tại</a>
                    <a href="/api/68gbhu/history?limit=100" class="btn">Lịch sử (100 phiên)</a>
                </div>
            </div>
            <div class="card">
                <h2>🔴 Bàn MD5</h2>
                <div class="links">
                    <a href="/api/68gbmd5/taixiu" class="btn">Dữ liệu hiện tại</a>
                    <a href="/api/68gbmd5/history?limit=100" class="btn">Lịch sử (100 phiên)</a>
                </div>
            </div>
        </div>
        <div class="status">System Status: <span>ONLINE</span> | Client: Dwong1410</div>
    </div>
</body>
</html>
`;

app.get('/', (req, res) => res.send(landingPage));

app.listen(PORT, () => {
  console.log(`[🚀] 68GB API Server is running on port ${PORT}`);
  startPoller();

  // Anti-sleep self-ping
  const URL = process.env.RENDER_EXTERNAL_URL;
  if (URL) {
    setInterval(() => {
      axios.get(URL).then(r => console.log(`[📡] Keep-alive ping: \${r.status}`)).catch(e => { });
    }, 5 * 60 * 1000);
  }
});
