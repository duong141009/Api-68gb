const puppeteer = require('puppeteer');
const fs = require('fs');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";

async function fetchToken() {
    console.log("🚀 [FETCH-JS] Khởi động trình duyệt...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-extensions'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });

        // Ưu tiên Chrome trên hệ thống nếu có
        const paths = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'];
        for (const p of paths) {
            if (fs.existsSync(p)) {
                browser.executablePath = p;
                break;
            }
        }

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        let tokenCaptured = false;

        // API CAO CẤP: Bắt WebSocket frames
        page.on('websocket', ws => {
            console.log(`🔗 [FETCH-JS] WebSocket Created: ${ws.url()}`);

            ws.on('framesent', async (frame) => {
                if (tokenCaptured) return;

                const buffer = Buffer.from(frame.payloadData, 'base64');
                console.log(`📡 [SENT] Type: 0x${buffer[0].toString(16).padStart(2, '0')}, Len: ${buffer.length}`);

                if (buffer.length > 50 && buffer[0] === 0x04) {
                    tokenCaptured = true;
                    const hex = buffer.toString('hex');
                    console.log("✅ [FETCH-JS] Captured Auth Token! Stabilizing cookies...");

                    setTimeout(async () => {
                        try {
                            const cookies = await page.cookies();
                            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                            const response = await fetch(BOT_SERVER, {
                                method: 'POST',
                                body: JSON.stringify({
                                    token: hex,
                                    ws_url: ws.url(),
                                    cookies: cookieStr
                                }),
                                headers: { 'Content-Type': 'application/json' }
                            });
                            const res = await response.json();
                            console.log("🤖 [BOT-RESPONSE]:", res);
                            if (res.status === "ok") {
                                console.log("🏁 [FINISH] Task Complete. Exiting.");
                                await browser.close();
                                process.exit(0);
                            }
                        } catch (e) {
                            console.error("❌ [ERROR] Failed to send token:", e.message);
                        }
                    }, 5000);
                }
            });

            ws.on('framereceived', frame => {
                // Optional: Log incoming patterns if needed for debug
            });
        });

        console.log("📡 [FETCH-JS] Navigating to game...");
        await page.goto(GAME_URL, { waitUntil: 'load', timeout: 90000 });
        console.log("✅ [FETCH-JS] Page Loaded.");

        // Loop tương tác liên tục cho đến khi có token
        const interactionLoop = setInterval(async () => {
            if (tokenCaptured) {
                clearInterval(interactionLoop);
                return;
            }

            const x = Math.floor(Math.random() * 400) + 400;
            const y = Math.floor(Math.random() * 300) + 200;
            try {
                await page.mouse.click(x, y);
                console.log(`🖱️ [FETCH-JS] Click interaction at [${x}, ${y}]`);
            } catch (e) { }
        }, 3000);

        // Safety timeout
        setTimeout(async () => {
            console.log("⏰ [TIMEOUT] Failed to capture token in 5 minutes.");
            if (browser) await browser.close();
            process.exit(1);
        }, 300000);

    } catch (err) {
        console.error("❌ [CRITICAL-ERROR]:", err.message);
        if (browser) await browser.close();
        process.exit(1);
    }
}

fetchToken();
