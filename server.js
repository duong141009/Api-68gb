const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');
const Bot68GB = require('./bot_unified');

// ─── CẤU HÌNH ────────────────────────────────────────────────────────────────
const WS_URL = "wss://mpaebq07x.cq.qnwxdhwica.com/";
const TOKEN_FILE = "token_shared.bin";
const PORT = parseInt(process.env.PORT || "8080");

const shared = {
    WS_URL,
    PKT_HANDSHAKE: Buffer.from('010000727b22737973223a7b22706c6174666f726d223a226a732d776562736f636b6574222c22636c69656e744275696c644e756d626572223a22302e302e31222c22636c69656e7456657273696f6e223a223061323134383164373436663932663834323865316236646565623736666561227d7d', 'hex'),
    PKT_HANDSHAKE_ACK: Buffer.from('02000000', 'hex'),
    PKT_HEARTBEAT: Buffer.from('03000000', 'hex'),
    PKT_AUTH: Buffer.from('0400004d01010001080210ca011a406436373738663230343862333434346662333661333535393837363162624036333634653530346431343234626163393738666363616464383839623466654200', 'hex'),
    COOKIES: ""
};

if (fs.existsSync(TOKEN_FILE)) {
    shared.PKT_AUTH = fs.readFileSync(TOKEN_FILE);
    console.log("📖 [CONFIG] Đã nạp Token từ file");
}

const bot = new Bot68GB(shared);

function triggerAutoFetch() {
    console.log("🔄 [SYSTEM] Triggering auto_fetcher...");
    const cmd = `node auto_fetcher.js`;
    const child = exec(cmd, { env: { ...process.env, BOT_SERVER: `http://localhost:${PORT}/api/token` } });
    child.stdout.on('data', data => process.stdout.write(`[FETCHER] ${data}`));
    child.stderr.on('data', data => process.stderr.write(`[FETCHER-ERR] ${data}`));
}

const server = http.createServer((req, res) => {
    const _cors = (code, body = null, type = 'application/json') => {
        res.writeHead(code, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': type + '; charset=utf-8'
        });
        res.end(body ? (typeof body === 'string' ? body : JSON.stringify(body)) : "");
    };

    if (req.method === 'POST' && (req.url === '/api/token')) {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const hex = data.token.replace(/b'|'|\\x| /g, "");
                shared.PKT_AUTH = Buffer.from(hex, 'hex');

                if (data.ws_url) {
                    shared.WS_URL = data.ws_url;
                    console.log(`📡 [TOKEN] New WebSocket URL: ${shared.WS_URL}`);
                }

                if (data.cookies) {
                    shared.COOKIES = data.cookies;
                    console.log(`🍪 [TOKEN] Cookies updated!`);
                }

                fs.writeFileSync(TOKEN_FILE, shared.PKT_AUTH);
                console.log("🔥 [TOKEN] Shared Token Updated!");
                if (bot.ws) bot.ws.close();
                _cors(200, { status: "ok" });
            } catch (e) { _cors(400, { error: e.message }); }
        });
    } else if (req.url === '/api/68gb/txhu') {
        _cors(200, bot.txhu.last_result || { error: "No data" });
    } else if (req.url === '/api/68gb/history/txhu') {
        _cors(200, bot.txhu.history.slice().reverse());
    } else if (req.url === '/api/68gb/txmd5' || req.url === '/api/data') {
        _cors(200, bot.md5.last_result || { error: "No data" });
    } else if (req.url === '/api/68gb/history/txmd5' || req.url === '/api/history') {
        _cors(200, bot.md5.history.slice().reverse());
    } else if (req.url === '/api/refetch') {
        triggerAutoFetch(); _cors(200, { status: "triggered" });
    } else if (req.url === '/' || req.url === '/index.html') {
        _cors(200, getLandingPage(bot.isAlive()), 'text/html');
    } else {
        _cors(404, { error: "Not Found" });
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [SERVER] Unified API on Port ${PORT}`);

    // Nếu chạy trên Render hoặc không có token file, tự động kích hoạt lấy token
    if (!fs.existsSync(TOKEN_FILE) || process.env.RENDER) {
        console.log("🆕 [INIT] Không tìm thấy Token hoặc đang chạy Cloud. Đang tự động lấy mã...");

        if (process.env.RENDER) {
            console.log("⏳ [WAIT] Đang đợi fetcher cung cấp Token/URL lần đầu...");
            let retryCount = 0;
            const checkInitial = setInterval(() => {
                if (shared.COOKIES && shared.COOKIES !== "") {
                    clearInterval(checkInitial);
                    console.log("🚀 [START] Đã có dữ liệu phiên bộ lọc. Khởi động Bot...");
                    bot.run();
                } else {
                    retryCount++;
                    if (retryCount % 15 === 0) { // Thử lại mỗi 30s nếu chưa có token
                        console.log("🔁 [RETRY] Vẫn đang chờ Token... Thử trigger lại fetcher.");
                        triggerAutoFetch();
                    }
                }
            }, 2000);
            setTimeout(triggerAutoFetch, 2000);
        } else {
            setTimeout(triggerAutoFetch, 5000);
            bot.run();
        }
    } else {
        bot.run();
    }
});

function getLandingPage(botStatus) {
    return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>68GB Bot Dashboard - Premium AI</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0a0b10;
            --card: rgba(255, 255, 255, 0.05);
            --accent: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
            --text: #f8fafc;
            --secondary: #94a3b8;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            background: var(--bg); 
            color: var(--text); 
            font-family: 'Outfit', sans-serif;
            overflow-x: hidden;
            background-image: radial-gradient(circle at 50% 50%, #1e1b4b 0%, #0a0b10 100%);
            min-height: 100vh;
        }

        .container { max-width: 1000px; margin: 0 auto; padding: 40px 20px; }

        header { text-align: center; margin-bottom: 60px; animation: fadeInDown 1s ease; }
        h1 { font-size: 3rem; font-weight: 800; margin-bottom: 10px; background: var(--accent); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .status-badge { display: inline-flex; align-items: center; padding: 6px 16px; border-radius: 999px; background: ${botStatus ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; color: ${botStatus ? '#4ade80' : '#f87171'}; font-weight: 600; border: 1px solid ${botStatus ? '#4ade8044' : '#f8717144'}; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; margin-right: 8px; box-shadow: 0 0 10px currentColor; }

        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px; margin-bottom: 50px; }
        .card { background: var(--card); backdrop-filter: blur(12px); border-radius: 24px; padding: 30px; border: 1px solid rgba(255,255,255,0.08); transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .card:hover { transform: translateY(-5px); box-shadow: 0 20px 40px rgba(0,0,0,0.4); border-color: rgba(99, 102, 241, 0.3); }

        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; }
        .card-title { font-size: 1.5rem; font-weight: 700; color: #fff; }
        .result-val { font-size: 2.5rem; font-weight: 800; margin: 15px 0; letter-spacing: -1px; }
        .result-dice { font-size: 1.2rem; color: var(--secondary); letter-spacing: 5px; }
        .phien { color: #6366f1; font-weight: 600; font-family: monospace; }

        .controls { display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; }
        .btn { padding: 14px 28px; border-radius: 16px; border: none; font-weight: 600; cursor: pointer; transition: all 0.2s ease; text-decoration: none; display: inline-flex; align-items: center; font-family: 'Outfit', sans-serif; font-size: 1rem; }
        .btn-primary { background: var(--accent); color: white; box-shadow: 0 10px 20px rgba(168, 85, 247, 0.3); }
        .btn-primary:hover { transform: scale(1.05); box-shadow: 0 15px 25px rgba(168, 85, 247, 0.4); }
        .btn-secondary { background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.1); }
        .btn-secondary:hover { background: rgba(255,255,255,0.1); }

        .api-links { margin-top: 60px; text-align: center; }
        .api-links h2 { margin-bottom: 25px; font-weight: 600; }
        .link-chip { display: inline-block; padding: 10px 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; margin: 5px; color: var(--secondary); text-decoration: none; transition: 0.2s; }
        .link-chip:hover { border-color: #6366f1; color: #fff; }

        @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .loading-bar { height: 2px; width: 100%; background: rgba(255,255,255,0.05); position: fixed; top: 0; left: 0; }
        .loading-progress { height: 100%; width: 0%; background: var(--accent); transition: width 0.3s; }

        footer { text-align: center; margin-top: 80px; color: var(--secondary); font-size: 0.9rem; padding-bottom: 40px; }
        
        .tai { color: #f87171; }
        .xiu { color: #60a5fa; }
    </style>
</head>
<body>
    <div class="loading-bar"><div class="loading-progress" id="progress"></div></div>
    
    <div class="container">
        <header>
            <h1>68GB DASHBOARD</h1>
            <div class="status-badge">
                <div class="status-dot"></div>
                Bot Status: ${botStatus ? 'ACTIVE' : 'DISCONNECTED'}
            </div>
        </header>

        <div class="grid">
            <!-- TÀI XỈU HŨ -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">TÀI XỈU HŨ</span>
                    <span class="phien" id="txhu-s">#000000</span>
                </div>
                <div id="txhu-res" class="result-val">ĐANG TẢI...</div>
                <div id="txhu-dice" class="result-dice">0 - 0 - 0</div>
                <div style="margin-top: 20px;">
                    <a href="/api/68gb/txhu" class="link-chip">API Live</a>
                    <a href="/api/68gb/history/txhu" class="link-chip">Lịch sử</a>
                </div>
            </div>

            <!-- TÀI XỈU MD5 -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">TÀI XỈU MD5</span>
                    <span class="phien" id="md5-s">#00000</span>
                </div>
                <div id="md5-res" class="result-val">ĐANG TẢI...</div>
                <div id="md5-dice" class="result-dice">0 - 0 - 0</div>
                <div style="margin-top: 20px;">
                    <a href="/api/68gb/txmd5" class="link-chip">API Live</a>
                    <a href="/api/68gb/history/txmd5" class="link-chip">Lịch sử</a>
                </div>
            </div>
        </div>

        <div class="controls">
            <button class="btn btn-primary" onclick="refetchToken()">
                <svg style="width:20px;height:20px;margin-right:8px" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                Lấy Lại Token Mới
            </button>
            <a href="/api/68gb/history/txhu" class="btn btn-secondary">Xem Database</a>
        </div>

        <div class="api-links">
            <h2>Hệ Thống API</h2>
            <a href="/api/68gb/txhu" class="link-chip">/api/68gb/txhu</a>
            <a href="/api/68gb/txmd5" class="link-chip">/api/68gb/txmd5</a>
            <a href="/api/68gb/history/txhu" class="link-chip">/api/68gb/history/txhu</a>
            <a href="/api/68gb/history/txmd5" class="link-chip">/api/68gb/history/txmd5</a>
        </div>

        <footer>
            Built by Antigravity AI &bull; Dwong1410 System &bull; 2026
        </footer>
    </div>

    <script>
        async function updateData() {
            const prog = document.getElementById('progress');
            prog.style.width = '30%';
            try {
                const [txhuRes, md5Res] = await Promise.all([
                    fetch('/api/68gb/txhu').then(r => r.json()),
                    fetch('/api/68gb/txmd5').then(r => r.json())
                ]);
                prog.style.width = '70%';

                if (!txhuRes.error) {
                    document.getElementById('txhu-s').innerText = '#' + txhuRes['Phiên trước'];
                    const resEl = document.getElementById('txhu-res');
                    resEl.innerText = txhuRes['kết quả'];
                    resEl.className = 'result-val ' + (txhuRes['kết quả'] === 'TÀI' ? 'tai' : 'xiu');
                    document.getElementById('txhu-dice').innerText = \`\${txhuRes['xúc xắc 1']} - \${txhuRes['xúc xắc 2']} - \${txhuRes['xúc xắc 3']}\`;
                }

                if (!md5Res.error) {
                    document.getElementById('md5-s').innerText = '#' + md5Res['Phiên trước'];
                    const resEl = document.getElementById('md5-res');
                    resEl.innerText = md5Res['kết quả'];
                    resEl.className = 'result-val ' + (md5Res['kết quả'] === 'TÀI' ? 'tai' : 'xiu');
                    document.getElementById('md5-dice').innerText = \`\${md5Res['xúc xắc 1']} - \${md5Res['xúc xắc 2']} - \${md5Res['xúc xắc 3']}\`;
                }
                prog.style.width = '100%';
                setTimeout(() => prog.style.width = '0%', 400);
            } catch (e) { console.error(e); }
        }

        function refetchToken() {
            if(!confirm('Xác nhận chạy script lấy Token tự động?\\n(Quá trình mất 1-2 phút)')) return;
            fetch('/api/refetch').then(() => alert('Đã gửi yêu cầu lấy Token! Vui lòng chờ...'));
        }

        setInterval(updateData, 5000);
        updateData();
    </script>
</body>
</html>
    `;
}
