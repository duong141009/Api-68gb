const puppeteer = require('puppeteer');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 giây giữa các lần retry

let attempt = 0;

async function fetchToken() {
    attempt++;
    console.log(`🚀 [FETCH] === Lần thử ${attempt}/${MAX_RETRIES} ===`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-extensions',
                '--single-process',
                '--disable-web-security'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });

        console.log("✅ [FETCH] Browser OK.");

        let tokenCaptured = false;
        let handshakeHex = null; // Lưu lại packet handshake (0x01)
        const wsMap = {}; // requestId -> url

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        // ========== CDP: Bắt WebSocket qua DevTools Protocol ==========
        const client = await page.createCDPSession();
        await client.send('Network.enable');

        client.on('Network.webSocketCreated', (params) => {
            wsMap[params.requestId] = params.url;
            console.log(`🔗 [WS-OPEN] ${params.url}`);
        });

        client.on('Network.webSocketClosed', (params) => {
            const url = wsMap[params.requestId] || 'unknown';
            console.log(`🔌 [WS-CLOSE] ${url}`);
            delete wsMap[params.requestId];
        });

        client.on('Network.webSocketFrameSent', async (params) => {
            if (tokenCaptured) return;

            const url = wsMap[params.requestId] || 'unknown';
            const payloadData = params.response?.payloadData;
            const opcode = params.response?.opcode; // 1 = text, 2 = binary
            if (!payloadData) return;

            let buffer;
            try {
                if (opcode === 2) {
                    buffer = Buffer.from(payloadData, 'base64');
                } else {
                    buffer = Buffer.from(payloadData, 'utf8');
                }
            } catch (e) {
                return;
            }

            const preview = buffer.slice(0, 10).toString('hex');
            console.log(`📤 [SENT] ${preview}... (${buffer.length}B)`);

            // Bắt gói Handshake (bắt đầu bằng 0x01 và dài > 40 bytes)
            if (!handshakeHex && buffer.length > 40 && buffer[0] === 0x01) {
                handshakeHex = buffer.toString('hex');
                console.log(`🤝 [HANDSHAKE] Bắt được: ${buffer.length} bytes`);
            }

            // Token: bắt đầu 0x04 và > 50 bytes
            if (buffer.length > 50 && buffer[0] === 0x04) {
                tokenCaptured = true;
                const hex = buffer.toString('hex');
                console.log(`🎉 [TOKEN] Bắt được! (${buffer.length} bytes) từ ${url}`);

                try {
                    let cookieStr = "";
                    try {
                        const cookies = await page.cookies();
                        cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                    } catch (e) { }

                    const response = await fetch(BOT_SERVER, {
                        method: 'POST',
                        body: JSON.stringify({
                            token: hex,
                            ws_url: url,
                            cookies: cookieStr,
                            handshake: handshakeHex || "" // Gửi kèm handshake chuẩn
                        }),
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const res = await response.json();
                    console.log("🤖 [RESPONSE]:", JSON.stringify(res));

                    if (res.status === "ok") {
                        console.log("🏁 [DONE] Thành công!");
                        try { await browser.close(); } catch (e) { }
                        process.exit(0);
                    }
                } catch (e) {
                    console.error("❌ [POST-ERR]:", e.message);
                    tokenCaptured = false;
                }
            }
        });

        client.on('Network.webSocketFrameReceived', (params) => {
            // Log vài gói nhận đầu tiên để debug
            if (tokenCaptured) return;
            const payloadData = params.response?.payloadData;
            if (!payloadData) return;
            try {
                const buffer = Buffer.from(payloadData, 'base64');
                if (buffer.length > 3) {
                    const preview = buffer.slice(0, 10).toString('hex');
                    console.log(`📥 [RECV] ${preview}... (${buffer.length}B)`);
                }
            } catch (e) { }
        });

        // ========== Navigate ==========
        console.log(`📡 [FETCH] Đang truy cập ${GAME_URL} ...`);

        try {
            // waitUntil: domcontentloaded thay vì networkidle2 để nhanh hơn
            await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.log(`⚠️ [NAV] ${e.message.substring(0, 100)}. Tiếp tục chờ...`);
        }

        const pageUrl = page.url();
        const pageTitle = await page.title().catch(() => '');
        console.log(`📄 [PAGE] URL=${pageUrl} Title="${pageTitle}"`);

        // Đợi tối đa 30 giây cho token
        console.log(`⏳ [WAIT] Chờ token (max 30s)... WS: ${Object.keys(wsMap).length}`);

        await new Promise((resolve) => {
            const timeout = setTimeout(async () => {
                if (!tokenCaptured) {
                    console.log(`⏰ [TIMEOUT] Hết 30s. WS mở: ${Object.keys(wsMap).length}`);
                    try {
                        const content = await page.content();
                        console.log(`[PAGE HTML] ${content.substring(0, 500)}...`);
                    } catch (e) { }
                    resolve();
                }
            }, 30000); // 30s timeout

            const check = setInterval(() => {
                if (tokenCaptured) {
                    clearTimeout(timeout);
                    clearInterval(check);
                    setTimeout(resolve, 1000); // 1s chờ sau khi bắt được
                }
            }, 500); // check nhanh hơn (0.5s)
        });

        try {
            if (browser && browser.isConnected()) await browser.close();
        } catch (e) { }

        if (tokenCaptured) process.exit(0);

    } catch (err) {
        console.error("❌ [CRITICAL]:", err.message);
        try {
            if (browser && browser.isConnected()) await browser.close();
        } catch (e) { }
    }

    if (attempt < MAX_RETRIES) {
        console.log(`🔁 [RETRY] Sau ${RETRY_DELAY / 1000}s... (${attempt}/${MAX_RETRIES})`);
        setTimeout(fetchToken, RETRY_DELAY);
    } else {
        console.log(`💀 [GIVE-UP] Hết ${MAX_RETRIES} lần.`);
        process.exit(1);
    }
}

fetchToken();
