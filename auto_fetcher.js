const puppeteer = require('puppeteer');
const fs = require('fs');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";

async function fetchToken() {
    console.log("🚀 [FETCH-JS] Khởi động trình duyệt (Chế độ SIÊU TỐC)...");

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

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        let tokenCaptured = false;

        // Bắt WebSocket frames ngay lập tức
        page.on('websocket', ws => {
            console.log(`🔗 [FETCH-JS] WebSocket Open: ${ws.url()}`);

            ws.on('framesent', async (frame) => {
                if (tokenCaptured) return;

                const buffer = Buffer.from(frame.payloadData, 'base64');
                // Log để debug nhan con mẹ m luôn
                console.log(`📡 [SENT] Hex: ${buffer.slice(0, 5).toString('hex')}... (${buffer.length}b)`);

                if (buffer.length > 50 && buffer[0] === 0x04) {
                    tokenCaptured = true;
                    const hex = buffer.toString('hex');
                    console.log("✅ [FETCH-JS] Captured TOKEN! Exiting immediately...");

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
                            console.log("🏁 [FINISH] Done. Powering down.");
                            await browser.close();
                            process.exit(0);
                        }
                    } catch (e) {
                        console.error("❌ [ERROR]:", e.message);
                        process.exit(1);
                    }
                }
            });
        });

        console.log("📡 [FETCH-JS] Navigating... (Instant capture mode)");
        // Không đợi load, chỉ cần trang bắt đầu tải là bắt đầu bắt WS
        await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Safety timeout rút ngắn xuống 2 phút cho tốc độ cao
        setTimeout(async () => {
            if (!tokenCaptured) {
                console.log("⏰ [TIMEOUT] Token not found in 2m.");
                if (browser) await browser.close();
                process.exit(1);
            }
        }, 120000);

    } catch (err) {
        console.error("❌ [CRITICAL-ERROR]:", err.message);
        if (browser) await browser.close();
        process.exit(1);
    }
}

fetchToken();
