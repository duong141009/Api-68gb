const puppeteer = require('puppeteer'); // Dùng puppeteer (không phải core) để tự tải chromium
const fs = require('fs');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";

async function fetchToken() {
    console.log("🚀 [FETCH-JS] Khởi động trình duyệt...");

    let browser;
    try {
        const isRender = process.env.RENDER || false;

        const launchOptions = {
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process' // Tiết kiệm RAM trên Render
            ]
        };

        // Nếu ở local Linux của bác thì mới ép path Chrome
        if (fs.existsSync('/usr/bin/google-chrome')) {
            launchOptions.executablePath = '/usr/bin/google-chrome';
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        // Bắt sự kiện WebSocket qua CDP
        const client = await page.target().createCDPSession();
        await client.send('Network.enable');

        let captured_ws_url = null;
        client.on('Network.webSocketCreated', (params) => {
            console.log(`🔗 [FETCH-JS] Phát hiện WebSocket: ${params.url}`);
            captured_ws_url = params.url;
        });

        client.on('Network.webSocketFrameSent', async (params) => {
            const payload = params.response.payloadData;
            const buffer = Buffer.from(payload, 'base64');

            if (buffer.length > 50 && buffer[0] === 0x04) {
                const hex = buffer.toString('hex');
                console.log("✅ [FETCH-JS] Bắt được Token! Đang gửi về Bot...");

                try {
                    const cookies = await page.cookies();
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                    const response = await fetch(BOT_SERVER, {
                        method: 'POST',
                        body: JSON.stringify({
                            token: hex,
                            ws_url: captured_ws_url,
                            cookies: cookieStr
                        }),
                        headers: { 'Content-Type': 'application/json' }
                    });
                    const res = await response.json();
                    console.log("🤖 [BOT] Phản hồi:", res);
                    if (res.status === "ok") {
                        console.log("🏁 [FINISH] Hoàn tất!");
                        process.exit(0);
                    }
                } catch (e) {
                    console.error("❌ [ERROR] Lỗi gửi token:", e.message);
                }
            }
        });

        console.log("📡 [FETCH-JS] Đang tải game...");
        await page.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 90000 });

        // Safety EXIT after 2 minutes if still stuck
        const safetyFinal = setTimeout(() => {
            console.log("💀 [CRITICAL] Token fetcher stuck too long. Exiting.");
            process.exit(1);
        }, 120000);

        // Click phá popup
        await page.mouse.click(600, 500);
        console.log("🖱️ [FETCH-JS] Đã click giả lập...");

        // Timeout 4 phút
        setTimeout(() => {
            console.log("⏰ [TIMEOUT] Không bắt được token sau 4 phút.");
            process.exit(1);
        }, 240000);

    } catch (err) {
        console.error("❌ [FETCH-JS] Lỗi:", err.message);
        process.exit(1);
    }
}

fetchToken();
