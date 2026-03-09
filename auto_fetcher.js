const puppeteer = require('puppeteer');
const fs = require('fs');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";
const MAX_RETRIES = 10;
const RETRY_DELAY = 15000; // 15 giây giữa các lần retry

let attempt = 0;

async function fetchToken() {
    attempt++;
    console.log(`🚀 [FETCH-JS] Lần thử ${attempt}/${MAX_RETRIES} - Khởi động trình duyệt...`);

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
                '--single-process'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });

        let tokenCaptured = false;

        // Quét toàn bộ các target (bao gồm iframe, cửa sổ ẩn)
        browser.on('targetcreated', async (target) => {
            if (tokenCaptured) return;
            let targetPage;
            try {
                targetPage = await target.page();
            } catch (e) {
                return; // Target đã bị đóng
            }
            if (!targetPage) return;

            console.log(`📡 [TARGET] New target created: ${target.url()}`);

            targetPage.on('websocket', ws => {
                const url = ws.url();
                if (url.includes('google') || url.includes('facebook')) return;

                console.log(`🔗 [WS-OPEN] [${target.type()}] ${url}`);

                ws.on('framesent', async (frame) => {
                    if (tokenCaptured) return;

                    let buffer;
                    try {
                        buffer = Buffer.from(frame.payloadData, 'base64');
                    } catch (e) {
                        // payloadData có thể là binary trực tiếp
                        if (typeof frame.payloadData === 'string') {
                            buffer = Buffer.from(frame.payloadData, 'binary');
                        } else {
                            return;
                        }
                    }

                    if (buffer.length > 50 && buffer[0] === 0x04) {
                        tokenCaptured = true;
                        const hex = buffer.toString('hex');
                        console.log(`✅ [SUCCESS] BẮT ĐƯỢC TOKEN! (${buffer.length} bytes)`);

                        try {
                            const cookies = await targetPage.cookies();
                            const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                            const response = await fetch(BOT_SERVER, {
                                method: 'POST',
                                body: JSON.stringify({
                                    token: hex,
                                    ws_url: url,
                                    cookies: cookieStr
                                }),
                                headers: { 'Content-Type': 'application/json' }
                            });
                            const res = await response.json();
                            console.log("🤖 [BOT-RESPONSE]:", res);

                            if (res.status === "ok") {
                                console.log("🏁 [FINISH] Hoàn tất! Đang tắt browser...");
                                await browser.close();
                                process.exit(0);
                            }
                        } catch (e) {
                            console.error("❌ [ERROR-POST]:", e.message);
                            // Không exit, để timeout xử lý
                            tokenCaptured = false;
                        }
                    }
                });
            });
        });

        // Tạo trang chính và navigate
        const mainPage = await browser.newPage();
        await mainPage.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        console.log("📡 [FETCH-JS] Đang truy cập game...");
        await mainPage.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Đợi tối đa 3 phút
        await new Promise((resolve) => {
            const timeout = setTimeout(async () => {
                if (!tokenCaptured) {
                    console.log("⏰ [TIMEOUT] Không bắt được token sau 3 phút.");
                    resolve();
                }
            }, 180000);

            // Check mỗi 5s xem đã capture chưa
            const check = setInterval(() => {
                if (tokenCaptured) {
                    clearTimeout(timeout);
                    clearInterval(check);
                    // Đợi thêm 2s cho POST hoàn tất
                    setTimeout(resolve, 2000);
                }
            }, 5000);
        });

        // Cleanup
        try {
            if (browser && browser.isConnected()) await browser.close();
        } catch (e) { /* ignore */ }

        if (tokenCaptured) {
            console.log("✅ [DONE] Token đã gửi thành công.");
            process.exit(0);
        }

    } catch (err) {
        console.error("❌ [CRITICAL-ERROR]:", err.message);
        try {
            if (browser && browser.isConnected()) await browser.close();
        } catch (e) { /* ignore */ }
    }

    // Retry logic
    if (attempt < MAX_RETRIES) {
        console.log(`🔁 [RETRY] Thử lại sau ${RETRY_DELAY / 1000}s... (${attempt}/${MAX_RETRIES})`);
        setTimeout(fetchToken, RETRY_DELAY);
    } else {
        console.log(`💀 [GIVE-UP] Đã thử ${MAX_RETRIES} lần nhưng không lấy được token.`);
        process.exit(1);
    }
}

fetchToken();
