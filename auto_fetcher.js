const puppeteer = require('puppeteer');

const GAME_URL = "https://68gbvn88.bar/";
const BOT_SERVER = process.env.BOT_SERVER || "http://localhost:8080/api/token";
const MAX_RETRIES = 5;
const RETRY_DELAY = 20000; // 20 giây giữa các lần retry

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
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });

        console.log("✅ [FETCH] Browser đã mở OK.");

        let tokenCaptured = false;
        let wsCount = 0;

        // ========== GLOBAL: Bắt WS trên TẤT CẢ targets ==========
        browser.on('targetcreated', async (target) => {
            if (tokenCaptured) return;
            const type = target.type();
            const url = target.url();
            console.log(`📡 [TARGET] type=${type} url=${url.substring(0, 80)}`);

            let targetPage;
            try {
                targetPage = await target.page();
            } catch (e) {
                return;
            }
            if (!targetPage) return;

            // Bắt WebSocket trên target này
            targetPage.on('websocket', ws => {
                const wsUrl = ws.url();
                if (wsUrl.includes('google') || wsUrl.includes('facebook') || wsUrl.includes('analytic')) return;

                wsCount++;
                console.log(`🔗 [WS-${wsCount}] OPENED: ${wsUrl}`);

                ws.on('framesent', async (frame) => {
                    if (tokenCaptured) return;

                    let buffer;
                    try {
                        if (frame.payloadData instanceof ArrayBuffer || Buffer.isBuffer(frame.payloadData)) {
                            buffer = Buffer.from(frame.payloadData);
                        } else if (typeof frame.payloadData === 'string') {
                            // Thử base64 trước
                            const b64 = Buffer.from(frame.payloadData, 'base64');
                            if (b64.length > 10) {
                                buffer = b64;
                            } else {
                                buffer = Buffer.from(frame.payloadData, 'binary');
                            }
                        } else {
                            return;
                        }
                    } catch (e) {
                        return;
                    }

                    // Log mọi packet gửi đi
                    const preview = buffer.slice(0, 8).toString('hex');
                    console.log(`📤 [SENT] ${preview}... (${buffer.length} bytes, ws=${wsUrl.substring(0, 50)})`);

                    // Token auth packet: bắt đầu bằng 0x04 và dài > 50 bytes
                    if (buffer.length > 50 && buffer[0] === 0x04) {
                        tokenCaptured = true;
                        const hex = buffer.toString('hex');
                        console.log(`🎉 [SUCCESS] BẮT ĐƯỢC TOKEN! (${buffer.length} bytes)`);

                        try {
                            let cookieStr = "";
                            try {
                                const cookies = await targetPage.cookies();
                                cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                            } catch (e) {
                                console.log("⚠️ [WARN] Không lấy được cookies:", e.message);
                            }

                            const response = await fetch(BOT_SERVER, {
                                method: 'POST',
                                body: JSON.stringify({
                                    token: hex,
                                    ws_url: wsUrl,
                                    cookies: cookieStr
                                }),
                                headers: { 'Content-Type': 'application/json' }
                            });
                            const res = await response.json();
                            console.log("🤖 [BOT-RESPONSE]:", JSON.stringify(res));

                            if (res.status === "ok") {
                                console.log("🏁 [DONE] Token đã gửi thành công!");
                                try { await browser.close(); } catch (e) { }
                                process.exit(0);
                            }
                        } catch (e) {
                            console.error("❌ [ERROR-POST]:", e.message);
                            tokenCaptured = false; // Reset để thử lại
                        }
                    }
                });

                ws.on('framereceived', (frame) => {
                    // Log gói nhận để debug
                    if (!tokenCaptured && wsCount <= 3) {
                        let buffer;
                        try {
                            if (typeof frame.payloadData === 'string') {
                                buffer = Buffer.from(frame.payloadData, 'base64');
                            } else {
                                buffer = Buffer.from(frame.payloadData);
                            }
                            const preview = buffer.slice(0, 8).toString('hex');
                            console.log(`📥 [RECV] ${preview}... (${buffer.length} bytes)`);
                        } catch (e) { }
                    }
                });

                ws.on('close', () => {
                    console.log(`🔌 [WS-CLOSE] ${wsUrl.substring(0, 50)}`);
                });
            });

            // Log console messages từ page
            targetPage.on('console', msg => {
                if (msg.type() === 'error') {
                    console.log(`🔴 [PAGE-ERR] ${msg.text().substring(0, 200)}`);
                }
            });
        });

        // ========== Tạo trang và navigate ==========
        const mainPage = await browser.newPage();
        await mainPage.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36");

        // Bắt WS trên main page trực tiếp (phòng trường hợp targetcreated miss)
        mainPage.on('websocket', ws => {
            const wsUrl = ws.url();
            if (wsUrl.includes('google') || wsUrl.includes('facebook')) return;
            wsCount++;
            console.log(`🔗 [MAIN-WS-${wsCount}] OPENED: ${wsUrl}`);
        });

        console.log(`📡 [FETCH] Đang truy cập ${GAME_URL} ...`);

        try {
            await mainPage.goto(GAME_URL, { waitUntil: 'networkidle2', timeout: 90000 });
        } catch (e) {
            console.log(`⚠️ [FETCH] Navigation timeout/error: ${e.message}. Tiếp tục chờ...`);
        }

        // Log thông tin page sau khi load
        const pageTitle = await mainPage.title().catch(() => '(unknown)');
        const pageUrl = mainPage.url();
        console.log(`📄 [PAGE] Title: "${pageTitle}" | URL: ${pageUrl}`);

        // Log tất cả iframes
        const frames = mainPage.frames();
        console.log(`📄 [PAGE] Frames: ${frames.length}`);
        frames.forEach((f, i) => {
            console.log(`  └─ Frame ${i}: ${f.url().substring(0, 100)}`);
        });

        // Thử chờ thêm nếu chưa có WebSocket
        if (wsCount === 0) {
            console.log("⏳ [FETCH] Chưa thấy WS. Đợi thêm 30s cho page load động...");
            await new Promise(r => setTimeout(r, 30000));

            // Check lại frames
            const frames2 = mainPage.frames();
            console.log(`📄 [PAGE] Frames sau 30s: ${frames2.length}`);
            frames2.forEach((f, i) => {
                if (f.url() && f.url() !== 'about:blank') {
                    console.log(`  └─ Frame ${i}: ${f.url().substring(0, 100)}`);
                }
            });
        }

        // Đợi tối đa 4 phút cho token
        console.log(`⏳ [FETCH] Đang chờ token (tối đa 4 phút)... WS count: ${wsCount}`);

        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!tokenCaptured) {
                    console.log(`⏰ [TIMEOUT] Không bắt được token. WS đã mở: ${wsCount}`);
                    resolve();
                }
            }, 240000); // 4 phút

            const check = setInterval(() => {
                if (tokenCaptured) {
                    clearTimeout(timeout);
                    clearInterval(check);
                    setTimeout(resolve, 2000);
                }
            }, 3000);
        });

        // Cleanup
        try {
            if (browser && browser.isConnected()) await browser.close();
        } catch (e) { }

        if (tokenCaptured) {
            process.exit(0);
        }

    } catch (err) {
        console.error("❌ [CRITICAL]:", err.message);
        try {
            if (browser && browser.isConnected()) await browser.close();
        } catch (e) { }
    }

    // Retry
    if (attempt < MAX_RETRIES) {
        console.log(`🔁 [RETRY] Thử lại sau ${RETRY_DELAY / 1000}s... (${attempt}/${MAX_RETRIES})`);
        setTimeout(fetchToken, RETRY_DELAY);
    } else {
        console.log(`💀 [GIVE-UP] Đã thử ${MAX_RETRIES} lần. Dừng.`);
        process.exit(1);
    }
}

fetchToken();
